// Being told things when the app is closed.
//
// A push subscription is a capability: anyone holding the endpoint can send a
// notification to that device. So the rules worth proving are mostly about who
// can read one and who can write one — the sending itself is somebody else's
// server, and these tests deliberately do not reach it.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();

// Shaped like a real subscription. The endpoint is a plausible URL that goes
// nowhere, which is the point: nothing here should ever contact a push service.
const subscription = (n) => ({
  endpoint: `https://push.example.test/send/${u}-${n}`,
  keys: {
    p256dh: 'BJ1F5G8vQ0hZ9y4XcVn8bT2wKqLpRsMdEfGhIjKlMnOpQrStUvWxYz0123456789ab',
    auth: 'aBcDeFgHiJkLmNoPqRsTuV',
  },
});

(async () => {
  const me = client();
  const password = 'pushpass12345';
  await me.post('/api/auth/signup', { username: `pu_${u}`, password });
  // A household, because previewing asks what this household's month looks
  // like. Notifications themselves belong to the person, not to it.
  const home = await me.post('/api/households', { name: 'Push Home', people: ['Faisal'] });
  me.use(home.data.id);

  // --- it needs a session at all -------------------------------------------
  const stranger = client();
  for (const [name, call] of [
    ['the key', () => stranger.get('/api/push/key')],
    ['the device list', () => stranger.get('/api/push/devices')],
    ['subscribing', () => stranger.post('/api/push/subscribe', subscription(1))],
    ['a preview', () => stranger.post('/api/push/preview', {})],
  ]) {
    const res = await call();
    check(`a signed-out caller is refused ${name}`, res.status === 401, String(res.status));
  }

  // --- the public key is public --------------------------------------------
  const key = await me.get('/api/push/key');
  check('a signed-in caller is given the key to subscribe with', key.status === 200);
  check('and it says the server is set up', key.data.configured === true);
  check('and the key is there', typeof key.data.key === 'string' && key.data.key.length > 20);

  // --- subscribing ---------------------------------------------------------
  const partial = await me.post('/api/push/subscribe', { endpoint: 'https://x.test/1' });
  check(
    'half a subscription is refused, since it could never be sent to',
    partial.status === 400,
    `${partial.status} ${partial.data.error}`
  );

  const first = await me.post('/api/push/subscribe', subscription(1));
  check('a complete one is accepted', first.status === 201, String(first.status));

  const listed = await me.get('/api/push/devices');
  check('and the device appears', listed.data.devices.length === 1, JSON.stringify(listed.data));

  // The endpoint is the capability. Handing it back out would mean anyone who
  // could read one response could push to that phone forever.
  check(
    'but its endpoint is never handed back',
    !JSON.stringify(listed.data).includes('push.example.test'),
    JSON.stringify(listed.data)
  );

  // --- the same browser twice is one device --------------------------------
  const again = await me.post('/api/push/subscribe', subscription(1));
  const afterAgain = await me.get('/api/push/devices');
  check(
    're-subscribing the same browser updates rather than duplicating',
    again.status === 201 && afterAgain.data.devices.length === 1,
    `${afterAgain.data.devices.length} devices`
  );

  const second = await me.post('/api/push/subscribe', subscription(2));
  const both = await me.get('/api/push/devices');
  check(
    'a second browser is a second device',
    second.status === 201 && both.data.devices.length === 2,
    `${both.data.devices.length} devices`
  );

  // --- one account cannot touch another's ----------------------------------
  const other = client();
  await other.post('/api/auth/signup', { username: `pu2_${u}`, password });
  const theirs = await other.get('/api/push/devices');
  check(
    'somebody else sees none of them',
    theirs.data.devices.length === 0,
    JSON.stringify(theirs.data)
  );

  // Knowing the endpoint is not enough to unregister it from another account.
  await other.post('/api/push/unsubscribe', { endpoint: subscription(1).endpoint });
  const survived = await me.get('/api/push/devices');
  check(
    'and cannot unsubscribe one by guessing its endpoint',
    survived.data.devices.length === 2,
    `${survived.data.devices.length} left`
  );

  // --- unsubscribing your own ----------------------------------------------
  const off = await me.post('/api/push/unsubscribe', { endpoint: subscription(1).endpoint });
  const left = await me.get('/api/push/devices');
  check('you can unsubscribe your own', off.status === 200 && left.data.devices.length === 1);

  const noEndpoint = await me.post('/api/push/unsubscribe', {});
  check('unsubscribing nothing is refused', noEndpoint.status === 400, String(noEndpoint.status));

  // --- previewing what today would send ------------------------------------
  // The endpoint goes nowhere, so the push fails — and the route must say so
  // rather than reporting a success nobody received.
  const nowhere = await me.post('/api/push/preview', {});
  check(
    'a preview to a dead endpoint reports nothing was accepted',
    nowhere.status === 200 && nowhere.data.sent === 0,
    `${nowhere.status} ${JSON.stringify(nowhere.data)}`
  );
  check(
    'and still hands back the words, which is the other half of its job',
    Array.isArray(nowhere.data.messages) && Boolean(nowhere.data.messages[0]?.title),
    JSON.stringify(nowhere.data.messages)
  );
  check(
    'saying honestly whether today had anything scheduled',
    typeof nowhere.data.scheduled === 'boolean',
    JSON.stringify(nowhere.data.scheduled)
  );

  // And a device the push service rejected outright is not kept forever.
  const afterTest = await me.get('/api/push/devices');
  check(
    'a device that could not be reached is either dropped or marked',
    afterTest.data.devices.length === 0 || Boolean(afterTest.data.devices[0].failed_at),
    JSON.stringify(afterTest.data)
  );

  // A preview must never reach into a household the caller is not in. Asking
  // for somebody else's by id falls back to your own rather than obliging.
  const outsider = client();
  await outsider.post('/api/auth/signup', { username: `pu3_${u}`, password });
  const noHome = await outsider.post('/api/push/preview', {});
  check(
    'somebody with no household is told to make one rather than shown nothing',
    noHome.status === 400,
    `${noHome.status} ${JSON.stringify(noHome.data)}`
  );

  const { failed } = report('Push notifications');
  process.exit(failed ? 1 : 0);
})();
