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

// A guess-rate limit, kept in memory: a couple of household users don't justify
// a table, and a restart clearing it is an acceptable trade.
const attempts = new Map();

function tooManyAttempts(key) {
  const record = attempts.get(key);
  if (!record) return false;
  if (Date.now() > record.until) {
    attempts.delete(key);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
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
      user: req.user ?? null,
    });
  })
);

// Open only while no user exists. Once the first account is created this
// returns 403, so it can't be used to add accounts from outside.
router.post(
  '/setup',
  h(async (req, res) => {
    if ((await authService.userCount()) > 0) {
      return res.status(403).json({ error: 'Already set up — sign in instead.' });
    }
    const { username, password } = req.body;
    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: 'Choose a username.' });
    }
    const problem = validPassword(password);
    if (problem) return res.status(400).json({ error: problem });

    const user = await authService.createUser(username, password);
    const { token, expiresAt } = await authService.createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    res.status(201).json({ user: { id: user.id, username: user.username } });
  })
);

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

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Everything below needs an existing session — these are for managing logins
// once you're already in, not for getting in.
router.get(
  '/users',
  requireAuth,
  h(async (req, res) => {
    res.json(await db.all('SELECT id, username, created_at FROM users ORDER BY id'));
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
