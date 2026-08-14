// Passkeys as a second factor: the password stops being enough the moment one
// is registered, and the ways back in are a recovery code or the database.
//
// The authenticator here is real — a P-256 keypair signing the same bytes a
// phone signs — so these checks exercise the verification path rather than a
// stub of it.
const { client, results, unique } = require('../support/client');
const { authenticator } = require('../support/authenticator');

const { check, report } = results();
const u = unique();

const ORIGIN = process.env.RP_ORIGIN || 'http://localhost:5099';
const RP_ID = process.env.RP_ID || 'localhost';

(async () => {
  const me = client();
  const username = `pk_${u}`;
  const password = 'passkeypass123';

  await me.post('/api/auth/signup', { username, password });

  // --- before any passkey exists ------------------------------------------
  const plain = client();
  const first = await plain.post('/api/auth/login', { username, password });
  check('a password alone signs you in while no passkey exists', first.data.user?.username === username);

  const empty = await me.get('/api/auth/passkeys');
  check('and the account reports none', empty.data.passkeys.length === 0, JSON.stringify(empty.data));

  // --- registering one -----------------------------------------------------
  const device = authenticator(RP_ID);
  const start = await me.post('/api/auth/passkeys/start');
  check('registration hands back a challenge', Boolean(start.data.challengeId && start.data.options.challenge));
  check(
    'and asks for a verified user, not just a present one',
    start.data.options.authenticatorSelection?.userVerification === 'required',
    JSON.stringify(start.data.options.authenticatorSelection)
  );

  const registered = await me.post('/api/auth/passkeys/finish', {
    challengeId: start.data.challengeId,
    response: device.register(start.data.options.challenge, ORIGIN),
    label: 'Test phone',
  });
  check('a passkey registers', registered.status === 201, JSON.stringify(registered.data).slice(0, 120));
  check(
    'the first one comes with ten recovery codes',
    registered.data.recoveryCodes?.length === 10,
    String(registered.data.recoveryCodes?.length)
  );
  const codes = registered.data.recoveryCodes ?? [];

  const replayed = await me.post('/api/auth/passkeys/finish', {
    challengeId: start.data.challengeId,
    response: device.register(start.data.options.challenge, ORIGIN),
  });
  check('the same challenge cannot be used twice', replayed.status === 400, String(replayed.status));

  // --- signing in now takes two steps -------------------------------------
  const second = client();
  const step1 = await second.post('/api/auth/login', { username, password });
  check('the right password no longer signs you in on its own', step1.data.needs === 'passkey', JSON.stringify(step1.data).slice(0, 90));
  check('it hands back a challenge instead', Boolean(step1.data.challengeId && step1.data.options?.challenge));
  check('and no user', !step1.data.user);

  // The half-authenticated state really is half: the cookie it might have set
  // has to be worth nothing.
  const peek = await second.get('/api/auth/me');
  check('the challenge does not let you read anything', peek.status === 401, String(peek.status));

  const step2 = await second.post('/api/auth/login/passkey', {
    challengeId: step1.data.challengeId,
    response: device.authenticate(step1.data.options.challenge, ORIGIN),
  });
  check('the passkey completes the sign-in', step2.data.user?.username === username, JSON.stringify(step2.data).slice(0, 90));
  check('and the session works', (await second.get('/api/auth/me')).status === 200);

  // --- the things that must not work --------------------------------------
  const wrongPassword = await client().post('/api/auth/login', { username, password: 'nope12345' });
  check('a wrong password never reaches the second step', wrongPassword.status === 401, String(wrongPassword.status));

  const stranger = client();
  const strangerStep1 = await stranger.post('/api/auth/login', { username, password });
  const otherDevice = authenticator(RP_ID);
  const impostor = await stranger.post('/api/auth/login/passkey', {
    challengeId: strangerStep1.data.challengeId,
    response: otherDevice.authenticate(strangerStep1.data.options.challenge, ORIGIN),
  });
  check('someone else’s passkey is refused', impostor.status === 401, JSON.stringify(impostor.data));

  const staleChallenge = client();
  const stale = await staleChallenge.post('/api/auth/login', { username, password });
  const wrongOrigin = await staleChallenge.post('/api/auth/login/passkey', {
    challengeId: stale.data.challengeId,
    response: device.authenticate(stale.data.options.challenge, 'https://phishing.example'),
  });
  check('a signature made for another site is refused', wrongOrigin.status === 401, JSON.stringify(wrongOrigin.data).slice(0, 100));

  // Five wrong answers burn the challenge, so a password that leaked cannot be
  // paired with unlimited guessing at the second factor.
  const limited = client();
  const attempt = await limited.post('/api/auth/login', { username, password });
  let refusals = 0;
  for (let i = 0; i < 6; i += 1) {
    const res = await limited.post('/api/auth/login/recovery', {
      challengeId: attempt.data.challengeId,
      code: 'ZZZZ-ZZZZ',
    });
    if (res.status === 401 || res.status === 429) refusals += 1;
    if (res.status === 429) break;
  }
  check('a challenge stops accepting guesses', refusals > 0);
  const afterLimit = await limited.post('/api/auth/login/recovery', {
    challengeId: attempt.data.challengeId,
    code: codes[0],
  });
  check(
    'and a real code will not save a burnt challenge',
    afterLimit.status !== 200,
    String(afterLimit.status)
  );

  // --- recovery codes ------------------------------------------------------
  const lost = client();
  const lostStep1 = await lost.post('/api/auth/login', { username, password });
  check('the second step says how many codes are left', lostStep1.data.recoveryCodesLeft === 10, String(lostStep1.data.recoveryCodesLeft));

  const recovered = await lost.post('/api/auth/login/recovery', {
    challengeId: lostStep1.data.challengeId,
    code: codes[0],
  });
  check('a recovery code gets you in without the device', recovered.data.user?.username === username, JSON.stringify(recovered.data).slice(0, 90));

  const reuse = client();
  const reuseStep1 = await reuse.post('/api/auth/login', { username, password });
  check('using one leaves nine', reuseStep1.data.recoveryCodesLeft === 9, String(reuseStep1.data.recoveryCodesLeft));
  const reused = await reuse.post('/api/auth/login/recovery', {
    challengeId: reuseStep1.data.challengeId,
    code: codes[0],
  });
  check('the same code cannot be used twice', reused.status === 401, String(reused.status));

  // Case and dashes are cosmetic — a code read off a screen should work
  // however it gets typed back in.
  const sloppy = client();
  const sloppyStep1 = await sloppy.post('/api/auth/login', { username, password });
  const sloppyIn = await sloppy.post('/api/auth/login/recovery', {
    challengeId: sloppyStep1.data.challengeId,
    code: codes[1].toLowerCase().replace('-', ' '),
  });
  check('a code typed in lower case with a space still works', sloppyIn.data.user?.username === username, JSON.stringify(sloppyIn.data).slice(0, 80));

  // --- a cloned authenticator ---------------------------------------------
  const cloned = client();
  const cloneStep1 = await cloned.post('/api/auth/login', { username, password });
  device.rewind(0);
  const clone = await cloned.post('/api/auth/login/passkey', {
    challengeId: cloneStep1.data.challengeId,
    response: device.authenticate(cloneStep1.data.options.challenge, ORIGIN),
  });
  check('a counter that goes backwards is refused', clone.status === 401, JSON.stringify(clone.data));

  // --- managing them -------------------------------------------------------
  const listed = await me.get('/api/auth/passkeys');
  check('the passkey is listed with its label', listed.data.passkeys[0]?.label === 'Test phone', JSON.stringify(listed.data.passkeys));
  check('and with when it was last used', Boolean(listed.data.passkeys[0]?.last_used_at));

  const noPassword = await me.del(`/api/auth/passkeys/${listed.data.passkeys[0].id}`, {
    password: 'wrongpass123',
  });
  check('removing one needs the password', noPassword.status === 401, String(noPassword.status));

  const fresh = await me.post('/api/auth/recovery-codes', { password });
  check('new codes can be issued', fresh.data.recoveryCodes?.length === 10);
  const voided = client();
  const voidedStep1 = await voided.post('/api/auth/login', { username, password });
  const oldCode = await voided.post('/api/auth/login/recovery', {
    challengeId: voidedStep1.data.challengeId,
    code: codes[2],
  });
  check('and the old ones stop working', oldCode.status === 401, String(oldCode.status));

  const removed = await me.del(`/api/auth/passkeys/${listed.data.passkeys[0].id}`, { password });
  check('the passkey can be removed', removed.status === 200, JSON.stringify(removed.data));
  check('and the account says it is unprotected again', removed.data.passkeysLeft === 0);

  const back = client();
  const afterRemoval = await back.post('/api/auth/login', { username, password });
  check('the password signs you in again once none are left', afterRemoval.data.user?.username === username, JSON.stringify(afterRemoval.data).slice(0, 90));

  const leftovers = await me.get('/api/auth/passkeys');
  check(
    'and the recovery codes went with the last passkey',
    leftovers.data.recoveryCodesLeft === 0,
    String(leftovers.data.recoveryCodesLeft)
  );

  const { failed } = report('Passkeys');
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
