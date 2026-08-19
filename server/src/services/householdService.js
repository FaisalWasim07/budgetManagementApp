const crypto = require('crypto');
const db = require('../db/pool');

const ROLES = ['owner', 'editor', 'viewer'];
const INVITE_DAYS = 14;

const listForUser = (userId) =>
  db.all(
    `SELECT h.id, h.name, hm.role, h.created_at
     FROM households h
     JOIN household_members hm ON hm.household_id = h.id
     WHERE hm.user_id = ?
     ORDER BY h.id`,
    [userId]
  );

// The single place membership is decided. Returns the role, or null for
// "not a member" — which callers must treat as not found, never as read-only.
async function roleOf(userId, householdId) {
  const row = await db.get(
    'SELECT role FROM household_members WHERE user_id = ? AND household_id = ?',
    [userId, householdId]
  );
  return row ? row.role : null;
}

// A new household starts with the people it was told about, each with one
// current account, so it is immediately usable rather than an empty screen
// with nothing to press.
async function create(userId, name, personNames = []) {
  return db.tx(async (t) => {
    const household = await t.get('INSERT INTO households (name) VALUES (?) RETURNING *', [
      String(name).trim(),
    ]);
    await t.run('INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)', [
      household.id,
      userId,
      'owner',
    ]);
    await t.run('INSERT INTO settings (household_id, key, value) VALUES (?, ?, ?)', [
      household.id,
      'primary_currency',
      'AED',
    ]);

    for (const [index, personName] of personNames.entries()) {
      // The first person is whoever is setting this up — the form asks for
      // their own name first and says so. Linking it here is the difference
      // between the app knowing who you are and having to ask you later.
      //
      // Everyone else is left unlinked on purpose: a household can hold people
      // who never sign in at all, and inventing logins for them would be
      // wrong. They are linked when they accept an invite.
      const person = await t.get(
        'INSERT INTO persons (household_id, name, user_id) VALUES (?, ?, ?) RETURNING id',
        [household.id, String(personName).trim(), index === 0 ? userId : null]
      );
      await t.run(
        `INSERT INTO accounts (household_id, person_id, name, currency, type, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [household.id, person.id, 'Main Account', 'AED', 'current', index]
      );
    }

    return household;
  });
}

const members = (householdId) =>
  db.all(
    `SELECT u.id AS user_id, u.username, hm.role, hm.created_at
     FROM household_members hm
     JOIN users u ON u.id = hm.user_id
     WHERE hm.household_id = ?
     ORDER BY hm.created_at, u.id`,
    [householdId]
  );

const ownerCount = async (householdId) =>
  (
    await db.get(
      "SELECT COUNT(*) AS count FROM household_members WHERE household_id = ? AND role = 'owner'",
      [householdId]
    )
  ).count;

async function createInvite(householdId, createdBy, role) {
  // A URL-safe code, long enough that guessing one is not a strategy.
  const code = crypto.randomBytes(12).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString();
  return db.get(
    `INSERT INTO household_invites (code, household_id, role, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
    [code, householdId, role, createdBy, expiresAt]
  );
}

const openInvites = (householdId) =>
  db.all(
    `SELECT code, role, created_at, expires_at
     FROM household_invites
     WHERE household_id = ? AND accepted_by IS NULL AND expires_at > now()
     ORDER BY created_at DESC`,
    [householdId]
  );

// Accepting is deliberately fussy: an invite is single-use, expires, and grants
// exactly the role it was created with. Someone already in the household keeps
// the role they have rather than being silently promoted or demoted.
// Which unlinked person is this newly joined member?
//
// 1. A name that matches their username, which is as close to a statement as
//    the data gets.
// 2. Otherwise, the only unlinked person left — not a guess but a deduction,
//    because there is no other candidate for it to be wrong about.
//
// Anything more ambiguous is left alone. The app can ask once; it cannot take
// back a notification sent to the wrong person.
async function linkAccepterToPerson(t, householdId, userId) {
  const already = await t.get(
    'SELECT id FROM persons WHERE household_id = ? AND user_id = ?',
    [householdId, userId]
  );
  if (already) return already.id;

  const user = await t.get('SELECT username FROM users WHERE id = ?', [userId]);
  const free = await t.all(
    'SELECT id, name FROM persons WHERE household_id = ? AND user_id IS NULL ORDER BY id',
    [householdId]
  );
  if (free.length === 0) return null;

  const byName = free.filter(
    (person) => person.name.trim().toLowerCase() === String(user?.username ?? '').trim().toLowerCase()
  );
  const chosen = byName.length === 1 ? byName[0] : free.length === 1 ? free[0] : null;
  if (!chosen) return null;

  await t.run('UPDATE persons SET user_id = ? WHERE id = ?', [userId, chosen.id]);
  return chosen.id;
}

async function acceptInvite(code, userId) {
  return db.tx(async (t) => {
    const invite = await t.get(
      `SELECT i.*, h.name AS household_name
       FROM household_invites i JOIN households h ON h.id = i.household_id
       WHERE i.code = ?`,
      [code]
    );
    if (!invite) return { error: 'That invite code is not valid.' };
    if (invite.accepted_by) return { error: 'That invite has already been used.' };
    if (new Date(invite.expires_at) < new Date()) return { error: 'That invite has expired.' };

    const existing = await t.get(
      'SELECT role FROM household_members WHERE household_id = ? AND user_id = ?',
      [invite.household_id, userId]
    );
    if (existing) {
      return {
        error: `You are already a member of ${invite.household_name}.`,
        householdId: invite.household_id,
      };
    }

    await t.run('INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)', [
      invite.household_id,
      userId,
      invite.role,
    ]);
    await t.run(
      'UPDATE household_invites SET accepted_by = ?, accepted_at = now() WHERE code = ?',
      [userId, code]
    );

    // Work out which person in this household the new member is, so nobody has
    // to be asked. Accounts belong to people, not to logins, so a member with
    // no person is a member the app cannot address — no arrival notification,
    // and their own accounts do not lead their dashboard.
    //
    // Two ways, in order of confidence, and neither guesses when it is not
    // sure. An unresolved link is recoverable; the wrong one silently sends
    // somebody else's money notices to the wrong phone.
    const linked = await linkAccepterToPerson(t, invite.household_id, userId);

    return {
      householdId: invite.household_id,
      name: invite.household_name,
      role: invite.role,
      personId: linked,
    };
  });
}

const revokeInvite = (householdId, code) =>
  db.run('DELETE FROM household_invites WHERE household_id = ? AND code = ?', [householdId, code]);

module.exports = {
  ROLES,
  listForUser,
  roleOf,
  create,
  members,
  ownerCount,
  createInvite,
  openInvites,
  acceptInvite,
  revokeInvite,
};
