const crypto = require('crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const db = require('./../db/pool');
const authService = require('./authService');

// Passkeys: the second factor after a password.
//
// The browser holds a private key it will only use after a fingerprint, a face
// or a device PIN, and it will only offer it to the site that created it. That
// last part is why this beats a six-digit code — a code can be typed into a
// convincing copy of the login page, and a passkey cannot be given to one.
//
// Nothing secret is stored here. The public key is public, and someone who
// walked off with the whole database still could not sign a single assertion
// with it.

// The relying party is the domain, and it has to match the address in the bar
// exactly — a passkey made on one hostname is worthless on another. Both fall
// back to localhost so `npm run dev` works without any configuration.
const rpID = () => process.env.RP_ID || 'localhost';
const rpOrigin = () => process.env.RP_ORIGIN || 'http://localhost:5173';

// Both localhost ports are accepted in development: the app is served from
// 5173 by Vite and from 5000 by Express, and it is the same machine either way.
function expectedOrigins() {
  const configured = rpOrigin();
  if (rpID() !== 'localhost') return configured;
  return [...new Set([configured, 'http://localhost:5173', 'http://localhost:5000'])];
}

const CHALLENGE_MINUTES = 5;
// Per challenge, not per address. A fresh challenge means a fresh password,
// so this bounds guesses against one sign-in rather than against the account.
const MAX_CHALLENGE_ATTEMPTS = 5;

const RECOVERY_CODE_COUNT = 10;
// Crockford-ish: no I, O, U or L, so a code read off a screen and typed back in
// cannot be got wrong in the ways those letters invite.
const CODE_ALPHABET = '234679ACDEFGHJKMNPQRTVWXYZ';

const listCredentials = (userId) =>
  db.all(
    `SELECT id, credential_id, public_key, counter, transports, label, created_at, last_used_at
     FROM credentials WHERE user_id = ? ORDER BY id`,
    [userId]
  );

const countCredentials = async (userId) =>
  (await db.get('SELECT COUNT(*) AS count FROM credentials WHERE user_id = ?', [userId])).count;

// Whether this account is protected. One passkey is enough to mean the
// password alone will not get you in.
const hasPasskeys = async (userId) => (await countCredentials(userId)) > 0;

const purgeExpiredChallenges = () => db.run('DELETE FROM login_challenges WHERE expires_at < now()');

async function openChallenge(userId, kind, challenge) {
  const id = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + CHALLENGE_MINUTES * 60_000).toISOString();
  await db.run(
    'INSERT INTO login_challenges (id, user_id, kind, challenge, expires_at) VALUES (?, ?, ?, ?, ?)',
    [id, userId, kind, challenge, expiresAt]
  );
  return id;
}

// Returns the row and burns an attempt, or null when the challenge is unknown,
// stale, or has been guessed at too often. Deleting on the last attempt means a
// caller cannot keep hammering the same one.
async function claimChallenge(id, kind) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM login_challenges WHERE id = ? AND kind = ?', [id, kind]);
  if (!row) return null;

  if (new Date(row.expires_at) < new Date() || row.attempts >= MAX_CHALLENGE_ATTEMPTS) {
    await db.run('DELETE FROM login_challenges WHERE id = ?', [id]);
    return null;
  }

  await db.run('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?', [id]);
  return row;
}

const closeChallenge = (id) => db.run('DELETE FROM login_challenges WHERE id = ?', [id]);

const toTransports = (value) => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length ? parsed : undefined;
  } catch {
    return undefined;
  }
};

// ── Adding a passkey ───────────────────────────────────────────────────

async function startRegistration(user) {
  const existing = await listCredentials(user.id);
  const options = await generateRegistrationOptions({
    rpName: 'Bayt',
    rpID: rpID(),
    userName: user.username,
    userDisplayName: user.username,
    attestationType: 'none',
    // Offering a device that is already registered lets the browser say "you
    // have one of these already" instead of silently making a second.
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: toTransports(c.transports),
    })),
    authenticatorSelection: {
      // Discoverable, so signing in can start from the passkey itself rather
      // than needing the username first.
      residentKey: 'preferred',
      // The whole point: a passkey that unlocks without a face, a finger or a
      // PIN is a second factor in name only.
      userVerification: 'required',
    },
  });

  const challengeId = await openChallenge(user.id, 'register', options.challenge);
  return { challengeId, options };
}

async function finishRegistration(user, challengeId, response, label) {
  const row = await claimChallenge(challengeId, 'register');
  if (!row || row.user_id !== user.id) return { ok: false, error: 'That request expired. Try again.' };

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: row.challenge,
      expectedOrigin: expectedOrigins(),
      expectedRPID: rpID(),
      requireUserVerification: true,
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (!verification.verified) return { ok: false, error: 'That passkey could not be verified.' };

  const { credential } = verification.registrationInfo;
  await closeChallenge(challengeId);

  const saved = await db.get(
    `INSERT INTO credentials (user_id, credential_id, public_key, counter, transports, label)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id, label, created_at`,
    [
      user.id,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64'),
      credential.counter ?? 0,
      credential.transports ? JSON.stringify(credential.transports) : null,
      String(label || '').trim() || 'This device',
    ]
  );

  return { ok: true, credential: saved };
}

// ── Signing in with one ────────────────────────────────────────────────

async function startLogin(user) {
  const credentials = await listCredentials(user.id);
  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: 'required',
    allowCredentials: credentials.map((c) => ({
      id: c.credential_id,
      transports: toTransports(c.transports),
    })),
  });

  const challengeId = await openChallenge(user.id, 'login', options.challenge);
  return { challengeId, options };
}

async function finishLogin(challengeId, response) {
  const row = await claimChallenge(challengeId, 'login');
  if (!row) return { ok: false, error: 'That sign-in expired. Start again.' };

  const stored = await db.get(
    'SELECT * FROM credentials WHERE user_id = ? AND credential_id = ?',
    [row.user_id, response?.id]
  );
  if (!stored) return { ok: false, error: 'That passkey is not registered here.' };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: row.challenge,
      expectedOrigin: expectedOrigins(),
      expectedRPID: rpID(),
      requireUserVerification: true,
      credential: {
        id: stored.credential_id,
        publicKey: Buffer.from(stored.public_key, 'base64'),
        counter: Number(stored.counter),
        transports: toTransports(stored.transports),
      },
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (!verification.verified) return { ok: false, error: 'That passkey could not be verified.' };

  // A counter that has not moved forward is how a cloned authenticator gives
  // itself away. Devices that always report zero are exempt: they never
  // claimed to be counting.
  const { newCounter } = verification.authenticationInfo;
  if (newCounter > 0 && newCounter <= Number(stored.counter)) {
    return { ok: false, error: 'That passkey looks like a copy. Use another way in.' };
  }

  await closeChallenge(challengeId);
  await db.run('UPDATE credentials SET counter = ?, last_used_at = now() WHERE id = ?', [
    newCounter,
    stored.id,
  ]);

  return { ok: true, userId: row.user_id };
}

async function removeCredential(userId, id) {
  const row = await db.get('SELECT id FROM credentials WHERE id = ? AND user_id = ?', [id, userId]);
  if (!row) return false;
  await db.run('DELETE FROM credentials WHERE id = ?', [row.id]);

  // The last passkey taking the recovery codes with it is deliberate. Codes
  // that let you past a door nobody is guarding are just a weaker password
  // lying around, and leaving them would quietly outlive the feature.
  if ((await countCredentials(userId)) === 0) {
    await db.run('DELETE FROM recovery_codes WHERE user_id = ?', [userId]);
  }
  return true;
}

// ── Recovery codes ─────────────────────────────────────────────────────

function newCode() {
  const pick = () =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  return `${pick()}-${pick()}`;
}

const normalise = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Returned in the clear exactly once, then only ever held hashed. Generating a
// new set voids the old one, so a list you are unsure about can be replaced.
async function issueRecoveryCodes(userId) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newCode);
  await db.run('DELETE FROM recovery_codes WHERE user_id = ?', [userId]);
  for (const code of codes) {
    await db.run('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', [
      userId,
      authService.hashPassword(normalise(code)),
    ]);
  }
  return codes;
}

const countRecoveryCodes = async (userId) =>
  (await db.get('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', [
    userId,
  ])).count;

// Every unused code is checked rather than looked up, because a hash with its
// own salt cannot be searched for. Ten scrypt comparisons is the cost of not
// storing them in a way that could be reversed.
async function useRecoveryCode(userId, code) {
  const cleaned = normalise(code);
  if (!cleaned) return false;

  const rows = await db.all(
    'SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL',
    [userId]
  );
  for (const row of rows) {
    if (authService.verifyPassword(cleaned, row.code_hash)) {
      await db.run('UPDATE recovery_codes SET used_at = now() WHERE id = ?', [row.id]);
      return true;
    }
  }
  return false;
}

module.exports = {
  rpID,
  rpOrigin,
  listCredentials,
  countCredentials,
  hasPasskeys,
  purgeExpiredChallenges,
  startRegistration,
  finishRegistration,
  startLogin,
  finishLogin,
  removeCredential,
  issueRecoveryCodes,
  countRecoveryCodes,
  useRecoveryCode,
  MAX_CHALLENGE_ATTEMPTS,
  RECOVERY_CODE_COUNT,
};
