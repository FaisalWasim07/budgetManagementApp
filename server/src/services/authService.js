const crypto = require('crypto');
const db = require('../db/pool');

// scrypt comes with Node, so adding logins costs no new dependency — and in
// particular nothing that has to compile, which is what made installing hard
// on Windows before.
const SCRYPT_KEYLEN = 64;
const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

// Compared in constant time so the answer can't be inferred from how long it took.
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expectedBuf = Buffer.from(expected, 'hex');
  if (expectedBuf.length !== actual.length) return false;
  return crypto.timingSafeEqual(actual, expectedBuf);
}

const userCount = async () => (await db.get('SELECT COUNT(*) AS count FROM users')).count;

async function createUser(username, password, email = null) {
  const hash = hashPassword(password);
  const cleaned = email && String(email).trim() ? String(email).trim() : null;
  return db.get(
    `INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)
     RETURNING id, username, email, created_at`,
    [username.trim(), cleaned, hash]
  );
}

const findByEmail = (email) =>
  db.get('SELECT * FROM users WHERE lower(email) = lower(?)', [String(email).trim()]);

const setEmail = (userId, email) =>
  db.get('UPDATE users SET email = ? WHERE id = ? RETURNING id, username, email', [
    email && String(email).trim() ? String(email).trim() : null,
    userId,
  ]);

// Matched on the lowered value to line up with the unique index, so usernames
// are case-insensitive the way they were under SQLite's NOCASE collation.
function findUser(username) {
  return db.get('SELECT * FROM users WHERE lower(username) = lower(?)', [String(username).trim()]);
}

// Signing in accepts either. Which one you typed is a detail — you are trying
// to say who you are, and the app knows both names for that.
//
// Username is tried first so that a username can never be shadowed by someone
// else putting it in their email field. Both are already unique, so at most one
// row can match either way.
async function findByLogin(value) {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) return null;
  return (await findUser(cleaned)) ?? (cleaned.includes('@') ? findByEmail(cleaned) : null);
}

async function setPassword(userId, password) {
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), userId]);
  // Changing a password ends every other session for that user.
  await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [
    token,
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

async function getSessionUser(token) {
  if (!token) return null;
  const row = await db.get(
    `SELECT s.token, s.expires_at, u.id, u.username, u.lock_amounts,
            EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = u.id) AS has_passkeys
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    [token]
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await destroySession(token);
    return null;
  }
  // Carried on the session so the very first render already knows whether to
  // ask, rather than flashing the figures and then deciding. Both halves are
  // needed for that: the setting is on by default, and only a registered
  // passkey makes it mean anything.
  return {
    id: row.id,
    username: row.username,
    lock_amounts: row.lock_amounts,
    has_passkeys: Boolean(row.has_passkeys),
  };
}

const destroySession = (token) => db.run('DELETE FROM sessions WHERE token = ?', [token]);

const purgeExpiredSessions = () => db.run('DELETE FROM sessions WHERE expires_at < now()');

module.exports = {
  findByEmail,
  findByLogin,
  setEmail,
  hashPassword,
  verifyPassword,
  userCount,
  createUser,
  findUser,
  setPassword,
  createSession,
  getSessionUser,
  destroySession,
  purgeExpiredSessions,
  SESSION_DAYS,
};
