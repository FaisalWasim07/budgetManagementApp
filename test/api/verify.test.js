// Proving it is still you, without signing in again.
//
// The app asks for this before it puts any figure on screen, on a device set
// to want it. It is a narrower question than signing in — the session is
// already good — and it must stay narrower: it may not mint a session, and an
// assertion from one account's device may not answer for another's.
//
// The authenticator here is real, a P-256 keypair signing the same bytes a
// phone signs, so this exercises the verification path rather than a stub.
const { client, results, unique } = require('../support/client');
const { authenticator } = require('../support/authenticator');

const { check, report } = results();
const u = unique();

const ORIGIN = process.env.RP_ORIGIN || 'http://localhost:5099';
const RP_ID = process.env.RP_ID || 'localhost';

(async () => {
  const me = client();
  const username = `vf_${u}`;
  const password = 'verifypass123';
  await me.post('/api/auth/signup', { username, password });

  // --- with no passkey there is nothing to check against -------------------
  const tooEarly = await me.post('/api/auth/verify/start');
  check(
    'asking to be verified with no passkey is refused, and says why',
    tooEarly.status === 400 && /no passkey/i.test(tooEarly.data.error),
    `${tooEarly.status} ${tooEarly.data.error}`
  );

  // --- register one --------------------------------------------------------
  const device = authenticator(RP_ID);
  const reg = await me.post('/api/auth/passkeys/start');
  await me.post('/api/auth/passkeys/finish', {
    challengeId: reg.data.challengeId,
    response: device.register(reg.data.options.challenge, ORIGIN),
    label: 'Test phone',
  });

  // --- the ordinary path ---------------------------------------------------
  const start = await me.post('/api/auth/verify/start');
  check('a challenge is handed back', Boolean(start.data.challengeId && start.data.options?.challenge));
  check(
    'and it insists the person was actually verified, not merely present',
    start.data.options.userVerification === 'required',
    String(start.data.options.userVerification)
  );

  const done = await me.post('/api/auth/verify/finish', {
    challengeId: start.data.challengeId,
    response: device.authenticate(start.data.options.challenge, ORIGIN),
  });
  check('the passkey answers for you', done.status === 200 && done.data.ok === true, JSON.stringify(done.data));

  // The point of a separate route: this is not a sign-in, and must not behave
  // like one. Re-issuing a session every time somebody glances at a balance is
  // a side effect nobody asked for.
  check(
    'and it does not hand out a new session',
    !('set-cookie' in (done.headers ?? {})) && !done.data.user,
    JSON.stringify(Object.keys(done.headers ?? {}))
  );

  // --- a challenge is good once -------------------------------------------
  const replay = await me.post('/api/auth/verify/finish', {
    challengeId: start.data.challengeId,
    response: device.authenticate(start.data.options.challenge, ORIGIN),
  });
  check('the same challenge cannot be answered twice', replay.status === 401, String(replay.status));

  // --- somebody else's device --------------------------------------------
  const otherDevice = authenticator(RP_ID);
  const second = await me.post('/api/auth/verify/start');
  const impostor = await me.post('/api/auth/verify/finish', {
    challengeId: second.data.challengeId,
    response: otherDevice.authenticate(second.data.options.challenge, ORIGIN),
  });
  check('an unregistered device is refused', impostor.status === 401, JSON.stringify(impostor.data));

  // --- and it needs a session in the first place ---------------------------
  const stranger = client();
  const noSession = await stranger.post('/api/auth/verify/start');
  check('a signed-out caller cannot even start', noSession.status === 401, String(noSession.status));

  const strangerFinish = await stranger.post('/api/auth/verify/finish', {
    challengeId: 'made-up',
    response: {},
  });
  check('nor finish', strangerFinish.status === 401, String(strangerFinish.status));

  // --- one account's passkey does not answer for another -------------------
  // The assertion is real and valid; it just belongs to somebody else. Without
  // the owner check it would verify against whoever happened to be signed in.
  const other = client();
  const otherName = `vf2_${u}`;
  await other.post('/api/auth/signup', { username: otherName, password });
  const otherReg = await other.post('/api/auth/passkeys/start');
  const otherOwn = authenticator(RP_ID);
  await other.post('/api/auth/passkeys/finish', {
    challengeId: otherReg.data.challengeId,
    response: otherOwn.register(otherReg.data.options.challenge, ORIGIN),
    label: 'Their phone',
  });

  const mine = await me.post('/api/auth/verify/start');
  const wrongOwner = await me.post('/api/auth/verify/finish', {
    challengeId: mine.data.challengeId,
    response: otherOwn.authenticate(mine.data.options.challenge, ORIGIN),
  });
  check(
    'another account’s passkey cannot answer for yours',
    wrongOwner.status === 401,
    JSON.stringify(wrongOwner.data)
  );

  // --- and the real one still works afterwards -----------------------------
  const again = await me.post('/api/auth/verify/start');
  const good = await me.post('/api/auth/verify/finish', {
    challengeId: again.data.challengeId,
    response: device.authenticate(again.data.options.challenge, ORIGIN),
  });
  check('your own still works after all that', good.status === 200 && good.data.ok === true);

  // --- the setting lives on the account -----------------------------------
  // It follows you between devices, which is the point of it not being a flag
  // in one browser's storage.
  const fresh = client();
  const soloName = `vf3_${u}`;
  await fresh.post('/api/auth/signup', { username: soloName, password });
  const noKey = await fresh.post('/api/auth/lock-amounts', { on: true });
  check(
    'it cannot be switched on without a passkey to switch it back off',
    noKey.status === 400 && /add a passkey/i.test(noKey.data.error),
    `${noKey.status} ${noKey.data.error}`
  );
  check(
    'and the account still reports it off',
    (await fresh.get('/api/auth/me')).data.user.lock_amounts === false,
    JSON.stringify((await fresh.get('/api/auth/me')).data.user)
  );

  const turnedOn = await me.post('/api/auth/lock-amounts', { on: true });
  check('with one, it can be switched on', turnedOn.status === 200 && turnedOn.data.lock_amounts === true);
  check(
    'and every session of that account is told',
    (await me.get('/api/auth/me')).data.user.lock_amounts === true
  );

  // Signing in somewhere else brings the setting with it — the whole reason it
  // is on the account rather than in one device's storage.
  const elsewhere = client();
  const there = await elsewhere.post('/api/auth/login', { username, password });
  const finished = await elsewhere.post('/api/auth/login/passkey', {
    challengeId: there.data.challengeId,
    response: device.authenticate(there.data.options.challenge, ORIGIN),
  });
  check(
    'a new sign-in on another device already knows to ask',
    finished.data.user?.lock_amounts === true,
    JSON.stringify(finished.data.user)
  );

  const off = await me.post('/api/auth/lock-amounts', { on: false });
  check('and it can always be switched off again', off.status === 200 && off.data.lock_amounts === false);
  check(
    'switching off never needs a passkey — that is the way out',
    (await me.get('/api/auth/me')).data.user.lock_amounts === false
  );

  const { failed } = report('Verifying it is you');
  process.exit(failed ? 1 : 0);
})();
