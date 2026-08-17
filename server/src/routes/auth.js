const express = require('express');
const db = require('../db/pool');
const authService = require('../services/authService');
const webauthnService = require('../services/webauthnService');
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

// The one place a session is minted. Three routes can end in one — password
// alone, password then passkey, password then recovery code — and they must
// not drift apart in what they set.
async function signIn(res, user) {
  await authService.purgeExpiredSessions();
  const { token, expiresAt } = await authService.createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  // Read here rather than taken from the caller's row. Three routes sign people
  // in and they select different columns; one of them selecting id and username
  // alone is exactly how a freshly signed-in client was told the amounts were
  // not locked when they were.
  const prefs = await db.get('SELECT lock_amounts FROM users WHERE id = ?', [user.id]);
  res.json({
    user: {
      id: user.id,
      username: user.username,
      lock_amounts: Boolean(prefs?.lock_amounts),
    },
  });
}

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

    // Either name for the same person. `username` is still what the field is
    // called on the wire, because that is what older clients send.
    const { username, password } = req.body;
    const user = await authService.findByLogin(username);

    // Same message and same code path whether the name or the password was
    // wrong, so neither can be probed for independently — and the message says
    // nothing about which of the two you typed, so it cannot be used to find
    // out whether an address has an account here.
    if (!user || !authService.verifyPassword(String(password ?? ''), user.password_hash)) {
      recordFailure(key);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }

    clearFailures(key);

    // The password was right, but it is only the first half. No session is
    // issued until the passkey answers — the challenge is the only thing that
    // crosses the wire, and it is worth nothing without the device.
    if (await webauthnService.hasPasskeys(user.id)) {
      await webauthnService.purgeExpiredChallenges();
      const { challengeId, options } = await webauthnService.startLogin(user);
      return res.json({
        needs: 'passkey',
        challengeId,
        options,
        recoveryCodesLeft: await webauthnService.countRecoveryCodes(user.id),
      });
    }

    await signIn(res, user);
  })
);

// The second half. The challenge carries who is signing in, so this takes no
// username and cannot be used to go fishing for one.
router.post(
  '/login/passkey',
  h(async (req, res) => {
    const { challengeId, response } = req.body;
    const result = await webauthnService.finishLogin(challengeId, response);
    if (!result.ok) return res.status(401).json({ error: result.error });

    const user = await db.get('SELECT id, username FROM users WHERE id = ?', [result.userId]);
    await signIn(res, user);
  })
);

// The way back in when the device is gone. Each code works once, and the
// attempt limit on the challenge covers this route too — the codes are long
// enough that five guesses is nowhere near enough to matter.
router.post(
  '/login/recovery',
  h(async (req, res) => {
    const { challengeId, code } = req.body;
    const row = await db.get(`SELECT * FROM login_challenges WHERE id = ? AND kind = 'login'`, [
      challengeId ?? '',
    ]);
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'That sign-in expired. Start again.' });
    }
    if (row.attempts >= webauthnService.MAX_CHALLENGE_ATTEMPTS) {
      await db.run('DELETE FROM login_challenges WHERE id = ?', [row.id]);
      return res.status(429).json({ error: 'Too many tries. Start again.' });
    }
    await db.run('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?', [row.id]);

    if (!(await webauthnService.useRecoveryCode(row.user_id, code))) {
      return res.status(401).json({ error: 'That code is not right, or has been used already.' });
    }

    await db.run('DELETE FROM login_challenges WHERE id = ?', [row.id]);
    const user = await db.get('SELECT id, username FROM users WHERE id = ?', [row.user_id]);
    await signIn(res, user);
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
    const row = await db.get(
      'SELECT id, username, email, lock_amounts FROM users WHERE id = ?',
      [req.user.id]
    );
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

// Whether this account keeps its amounts behind a passkey. Held here rather
// than on each device, so signing in anywhere brings the choice with you.
//
// It can only be turned on when there is a passkey to turn it off with. A lock
// whose key does not exist is not a lock, it is a locked-out person.
router.post(
  '/lock-amounts',
  requireAuth,
  h(async (req, res) => {
    const on = Boolean(req.body?.on);
    if (on && !(await webauthnService.hasPasskeys(req.user.id))) {
      return res.status(400).json({
        error: 'Add a passkey first — otherwise there would be no way to show your amounts again.',
      });
    }
    await db.run('UPDATE users SET lock_amounts = ? WHERE id = ?', [on, req.user.id]);
    res.json({ lock_amounts: on });
  })
);

// ── Proving it is still you ──────────────────────────────────────────────
// Not a sign-in. The session is already good; this answers a narrower
// question — is the person holding the device the one the session belongs to —
// which is what the app asks before it puts figures on screen.
//
// It deliberately does not reuse /login/passkey. That issues a fresh session,
// and silently re-signing someone in every time they glance at a balance is a
// side effect nobody asked for.

router.post(
  '/verify/start',
  requireAuth,
  h(async (req, res) => {
    if (!(await webauthnService.hasPasskeys(req.user.id))) {
      return res.status(400).json({ error: 'There is no passkey on this account to check against.' });
    }
    await webauthnService.purgeExpiredChallenges();
    res.json(await webauthnService.startLogin(req.user));
  })
);

router.post(
  '/verify/finish',
  requireAuth,
  h(async (req, res) => {
    const { challengeId, response } = req.body;
    const result = await webauthnService.finishLogin(challengeId, response);
    if (!result.ok) return res.status(401).json({ error: result.error });
    // An assertion proves something about the account that owns the passkey,
    // and nothing about anyone else's. Someone signed in as one user must not
    // be able to unlock with another user's device.
    if (result.userId !== req.user.id) {
      return res.status(401).json({ error: 'That passkey belongs to a different account.' });
    }
    res.json({ ok: true });
  })
);

// ── Passkeys ─────────────────────────────────────────────────────────────
// All of these need a session already: this is managing how you get in, not
// getting in.

router.get(
  '/passkeys',
  requireAuth,
  h(async (req, res) => {
    const credentials = await webauthnService.listCredentials(req.user.id);
    res.json({
      passkeys: credentials.map((c) => ({
        id: c.id,
        label: c.label,
        created_at: c.created_at,
        last_used_at: c.last_used_at,
      })),
      recoveryCodesLeft: await webauthnService.countRecoveryCodes(req.user.id),
    });
  })
);

router.post(
  '/passkeys/start',
  requireAuth,
  h(async (req, res) => {
    await webauthnService.purgeExpiredChallenges();
    res.json(await webauthnService.startRegistration(req.user));
  })
);

router.post(
  '/passkeys/finish',
  requireAuth,
  h(async (req, res) => {
    const { challengeId, response, label } = req.body;
    const first = (await webauthnService.countCredentials(req.user.id)) === 0;

    const result = await webauthnService.finishRegistration(
      req.user,
      challengeId,
      response,
      label
    );
    if (!result.ok) return res.status(400).json({ error: result.error });

    // The codes come with the first passkey and only with the first: this is
    // the moment the account stops being openable by password alone, so it is
    // the moment there has to be a way back from a lost phone. Shown once.
    const recoveryCodes = first ? await webauthnService.issueRecoveryCodes(req.user.id) : null;
    res.status(201).json({ passkey: result.credential, recoveryCodes });
  })
);

// Removing one asks for the password, because an unlocked laptop left on a
// desk should not be able to quietly take the second factor off the account.
router.delete(
  '/passkeys/:id',
  requireAuth,
  h(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!authService.verifyPassword(String(req.body?.password ?? ''), user.password_hash)) {
      return res.status(401).json({ error: 'Password is wrong.' });
    }

    if (!(await webauthnService.removeCredential(req.user.id, Number(req.params.id)))) {
      return res.status(404).json({ error: 'No such passkey.' });
    }

    res.json({
      ok: true,
      // Zero left means the password is the whole lock again, and the client
      // says so rather than letting it happen quietly.
      passkeysLeft: await webauthnService.countCredentials(req.user.id),
    });
  })
);

router.post(
  '/recovery-codes',
  requireAuth,
  h(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!authService.verifyPassword(String(req.body?.password ?? ''), user.password_hash)) {
      return res.status(401).json({ error: 'Password is wrong.' });
    }
    if (!(await webauthnService.hasPasskeys(req.user.id))) {
      return res.status(400).json({ error: 'Add a passkey first — there is nothing to recover.' });
    }
    res.json({ recoveryCodes: await webauthnService.issueRecoveryCodes(req.user.id) });
  })
);

module.exports = router;
