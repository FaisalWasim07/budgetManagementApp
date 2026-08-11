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
      const person = await t.get(
        'INSERT INTO persons (household_id, name) VALUES (?, ?) RETURNING id',
        [household.id, String(personName).trim()]
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

    return { householdId: invite.household_id, name: invite.household_name, role: invite.role };
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
