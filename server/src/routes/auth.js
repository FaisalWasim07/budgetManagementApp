const express = require('express');
const db = require('../db/pool');
const authService = require('../services/authService');
const {
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
  readSessionToken,
} = require('../middleware/auth');
const { h } = require('../util/route');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 8;
const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

// Signing up counts every account created, not just failures, so the ceiling
// is about how many accounts one address may make rather than how many guesses
// it may take. Ten in fifteen minutes is generous for a household and useless
// for anyone filling the database; SIGNUP_MAX raises it where a test suite
// legitimately creates many in a row.
const SIGNUP_MAX = Number(process.env.SIGNUP_MAX) || 10;

// A guess-rate limit, kept in memory: a couple of household users don't justify
// a table, and a restart clearing it is an acceptable trade.
const attempts = new Map();

function tooManyAttempts(key, limit = MAX_ATTEMPTS) {
  const record = attempts.get(key);
  if (!record) return false;
  if (Date.now() > record.until) {
    attempts.delete(key);
    return false;
  }
  return record.count >= limit;
}

function recordFailure(key) {
  const record = attempts.get(key) ?? { count: 0, until: Date.now() + LOCKOUT_MS };
  record.count += 1;
  record.until = Date.now() + LOCKOUT_MS;
  attempts.set(key, record);
}

const clearFailures = (key) => attempts.delete(key);

function validPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

// Tells the client whether anyone has signed up yet, so it can show either the
// first-run setup form or the ordinary login form.
router.get(
  '/status',
  h(async (req, res) => {
    res.json({
      needsSetup: (await authService.userCount()) === 0,
      signupOpen: true,
      signupNeedsCode: Boolean(process.env.SIGNUP_CODE),
      user: req.user ?? null,
    });
  })
);

// Now that one deployment can hold several households, other people have to be
// able to make their own account — the first user can no longer be the only
// one. That does mean anyone who finds the address can register, so
// SIGNUP_CODE gates it: set it and only people you give the code to can sign
// up. Leave it unset and registration is open.
async function register(req, res) {
  const { username, password, email, code } = req.body;
  const required = process.env.SIGNUP_CODE;

  // Registration is open to anyone who finds the address, so it gets the same
  // per-address limit as signing in. Without this an account can be created in
  // a loop until the database is someone else's problem.
  const key = `signup:${req.ip || 'unknown'}`;
  if (tooManyAttempts(key, SIGNUP_MAX)) {
    return res.status(429).json({ error: 'Too many accounts created. Try again in 15 minutes.' });
  }
  recordFailure(key);

  if (required && String(code || '').trim() !== required) {
    return res.status(403).json({ error: 'That signup code is not right.', code: 'BAD_SIGNUP_CODE' });
  }
  if (!username || !String(username).trim()) {
    return res.status(400).json({ error: 'Choose a username.' });
  }
  const problem = validPassword(password);
  if (problem) return res.status(400).json({ error: problem });
  if (await authService.findUser(username)) {
    return res.status(409).json({ error: 'That username is taken.' });
  }

  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) {
    return res.status(400).json({ error: "That doesn't look like an email address." });
  }
  if (email && (await authService.findByEmail(email))) {
    return res.status(409).json({ error: 'That email is already on another account.' });
  }

  const user = await authService.createUser(username, password, email);
  const { token, expiresAt } = await authService.createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  res.status(201).json({ user: { id: user.id, username: user.username, email: user.email } });
}

router.post('/signup', h(register));

// Kept because the first-run screen still posts here, and because it reads
// better than "signup" for the person setting the app up.
router.post('/setup', h(register));

router.post(
  '/login',
  h(async (req, res) => {
    const key = req.ip || 'unknown';
    if (tooManyAttempts(key)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }

    const { username, password } = req.body;
    const user = username ? await authService.findUser(username) : null;

    // Same message and same code path whether the username or the password was
    // wrong, so neither can be probed for independently.
    if (!user || !authService.verifyPassword(String(password ?? ''), user.password_hash)) {
      recordFailure(key);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }

    clearFailures(key);
    await authService.purgeExpiredSessions();
    const { token, expiresAt } = await authService.createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    res.json({ user: { id: user.id, username: user.username } });
  })
);

router.post(
  '/logout',
  h(async (req, res) => {
    const token = readSessionToken(req);
    if (token) await authService.destroySession(token);
    clearSessionCookie(res);
    res.status(204).end();
  })
);

router.get(
  '/me',
  requireAuth,
  h(async (req, res) => {
    const row = await db.get('SELECT id, username, email FROM users WHERE id = ?', [req.user.id]);
    res.json({ user: row });
  })
);

// Everything below needs an existing session — these are for managing logins
// once you're already in, not for getting in.
router.get(
  '/users',
  requireAuth,
  h(async (req, res) => {
    res.json(await db.all('SELECT id, username, email, created_at FROM users ORDER BY id'));
  })
);

router.post(
  '/users',
  requireAuth,
  h(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: 'Choose a username.' });
    }
    const problem = validPassword(password);
    if (problem) return res.status(400).json({ error: problem });
    if (await authService.findUser(username)) {
      return res.status(409).json({ error: 'That username is taken.' });
    }
    const user = await authService.createUser(username, password);
    res.status(201).json({ id: user.id, username: user.username });
  })
);

router.post(
  '/email',
  requireAuth,
  h(async (req, res) => {
    const { email } = req.body;
    const value = email == null || String(email).trim() === '' ? null : String(email).trim();

    if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      return res.status(400).json({ error: "That doesn't look like an email address." });
    }
    if (value) {
      const owner = await authService.findByEmail(value);
      if (owner && owner.id !== req.user.id) {
        return res.status(409).json({ error: 'That email is already on another account.' });
      }
    }

    res.json(await authService.setEmail(req.user.id, value));
  })
);

router.post(
  '/password',
  requireAuth,
  h(async (req, res) => {
    const { current_password: currentPassword, new_password: newPassword } = req.body;
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);

    if (!authService.verifyPassword(String(currentPassword ?? ''), user.password_hash)) {
      return res.status(401).json({ error: 'Current password is wrong.' });
    }
    const problem = validPassword(newPassword);
    if (problem) return res.status(400).json({ error: problem });

    // This drops every session for the user, including this one, so the client
    // has to sign in again with the new password.
    await authService.setPassword(user.id, newPassword);
    clearSessionCookie(res);
    res.json({ ok: true, signedOut: true });
  })
);

module.exports = router;
