// Password reset by an owner, the optional email, and who is allowed to reset
// whom — the last being the part that matters.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();

(async () => {
  const owner = client();
  await owner.post('/api/auth/signup', { username: `own_${u}`, password: 'ownerpass123', email: `own_${u}@example.com` });
  const hh = await owner.post('/api/households', { name: 'Reset Home', people: ['Owner'] });
  owner.use(hh.data.id);

  const me = await owner.get('/api/auth/me');
  check('email is stored at signup', me.data.user.email === `own_${u}@example.com`, JSON.stringify(me.data.user));

  const dupEmail = await client().post('/api/auth/signup', { username: `dup_${u}`, password: 'duppass12345', email: `own_${u}@example.com` });
  check('the same email cannot be used twice', dupEmail.status === 409, String(dupEmail.status));

  const badEmail = await client().post('/api/auth/signup', { username: `bad_${u}`, password: 'badpass12345', email: 'not-an-email' });
  check('a malformed email is refused', badEmail.status === 400, String(badEmail.status));

  // --- signing in with either name ----------------------------------------
  const byEmail = await client().post('/api/auth/login', {
    username: `own_${u}@example.com`,
    password: 'ownerpass123',
  });
  check('the email signs you in as well as the username', byEmail.data.user?.username === `own_${u}`, JSON.stringify(byEmail.data));

  const byShouty = await client().post('/api/auth/login', {
    username: `OWN_${u}@EXAMPLE.COM`.toUpperCase(),
    password: 'ownerpass123',
  });
  check('and case does not matter', byShouty.data.user?.username === `own_${u}`, String(byShouty.status));

  const byUsername = await client().post('/api/auth/login', {
    username: `own_${u}`,
    password: 'ownerpass123',
  });
  check('the username still works', byUsername.data.user?.username === `own_${u}`, String(byUsername.status));

  const strangerEmail = await client().post('/api/auth/login', {
    username: `nobody_${u}@example.com`,
    password: 'ownerpass123',
  });
  check('an address with no account is refused', strangerEmail.status === 401, String(strangerEmail.status));
  check(
    'and is refused in the same words as a wrong password, so it cannot be used to find out who has an account',
    strangerEmail.data.error === 'Wrong username or password.',
    strangerEmail.data.error
  );

  const changed = await owner.post('/api/auth/email', { email: `new_${u}@example.com` });
  check('email can be changed later', changed.data.email === `new_${u}@example.com`, JSON.stringify(changed.data));

  const byOldEmail = await client().post('/api/auth/login', {
    username: `own_${u}@example.com`,
    password: 'ownerpass123',
  });
  check('the old address stops working once it is changed', byOldEmail.status === 401, String(byOldEmail.status));

  const cleared = await owner.post('/api/auth/email', { email: '' });
  check('and cleared', cleared.data.email === null, JSON.stringify(cleared.data));

  // An account with no address at all must not be reachable by an empty one.
  const emptyLogin = await client().post('/api/auth/login', { username: '', password: 'ownerpass123' });
  check('an empty name signs nobody in', emptyLogin.status === 401, String(emptyLogin.status));

  // --- owner resets a member ---------------------------------------------
  const added = await owner.post(`/api/households/${hh.data.id}/members`, {
    username: `mem_${u}`, password: 'memberpass1', role: 'editor',
  });
  check('a member is added', added.status === 201, JSON.stringify(added.data));

  const member = client();
  check('the member can sign in with their original password',
    (await member.post('/api/auth/login', { username: `mem_${u}`, password: 'memberpass1' })).status === 200);

  const reset = await owner.post(`/api/households/${hh.data.id}/members/${added.data.user_id}/password`, {
    new_password: 'brandnewpass9',
  });
  check('the owner can reset their password', reset.status === 200, JSON.stringify(reset.data));

  member.use(hh.data.id);
  const afterReset = await member.get('/api/accounts');
  check('the reset signed the member out everywhere', afterReset.status === 401, String(afterReset.status));

  const oldPassword = await client().post('/api/auth/login', { username: `mem_${u}`, password: 'memberpass1' });
  check('the old password no longer works', oldPassword.status === 401, String(oldPassword.status));
  const newPassword = await client().post('/api/auth/login', { username: `mem_${u}`, password: 'brandnewpass9' });
  check('the new one does', newPassword.status === 200, String(newPassword.status));

  const tooShort = await owner.post(`/api/households/${hh.data.id}/members/${added.data.user_id}/password`, { new_password: 'short' });
  check('a short password is refused', tooShort.status === 400, String(tooShort.status));

  // --- who may not reset whom --------------------------------------------
  const self = await owner.post(`/api/households/${hh.data.id}/members/${me.data.user.id}/password`, { new_password: 'somethingelse1' });
  check('an owner cannot reset their own this way', self.status === 400, String(self.status));

  await owner.patch(`/api/households/${hh.data.id}/members/${added.data.user_id}`, { role: 'owner' });
  const coOwner = await owner.post(`/api/households/${hh.data.id}/members/${added.data.user_id}/password`, { new_password: 'takeover12345' });
  check('an owner cannot reset another owner', coOwner.status === 403, String(coOwner.status));

  // A member of another household is invisible, not merely forbidden.
  const stranger = client();
  const s = await stranger.post('/api/auth/signup', { username: `str_${u}`, password: 'strangerpass1' });
  const sh = await stranger.post('/api/households', { name: 'Stranger Home', people: ['S'] });
  const across = await stranger.post(`/api/households/${hh.data.id}/members/${added.data.user_id}/password`, { new_password: 'nicetry12345' });
  check("a non-member cannot reset anyone in someone else's household", across.status === 404, String(across.status));

  const nonOwner = client();
  await nonOwner.post('/api/auth/login', { username: `mem_${u}`, password: 'brandnewpass9' });
  await owner.patch(`/api/households/${hh.data.id}/members/${added.data.user_id}`, { role: 'editor' });
  const editorTries = await nonOwner.post(`/api/households/${hh.data.id}/members/${me.data.user.id}/password`, { new_password: 'nope12345678' });
  check('an editor cannot reset anyone', editorTries.status === 403, String(editorTries.status));

  const { failed } = report('Password reset and email');
  process.exit(failed ? 1 : 0);
})();
