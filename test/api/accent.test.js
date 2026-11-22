// Each person's colour for the app.
//
// The things that matter: it is per person and not per household, it rides on
// the session so the first frame is already right, only the known colours are
// accepted, and the three places the list is written down agree.
const fs = require('fs');
const path = require('path');
const { client, results, unique } = require('../support/client');
const { ACCENTS } = require('../../server/src/services/accents');

const { check, report } = results();
const u = unique();

(async () => {
  const me = client();
  const signup = await me.post('/api/auth/signup', { username: `acc_${u}`, password: 'accentpass1' });
  check('a new account has not chosen a colour', signup.data.user.accent === null,
    JSON.stringify(signup.data.user));
  const hh = await me.post('/api/households', { name: 'Accent', people: ['Me', 'You'] });

  const fresh = await me.get('/api/auth/me');
  check('and says so as null rather than as mint, so "never chose" stays distinguishable',
    fresh.data.user.accent === null, JSON.stringify(fresh.data.user.accent));

  // --- choosing one -------------------------------------------------------
  const set = await me.post('/api/auth/accent', { accent: 'plum' });
  check('a colour can be chosen', set.status === 200 && set.data.accent === 'plum', JSON.stringify(set.data));
  const after = await me.get('/api/auth/me');
  check('and is stored on the account', after.data.user.accent === 'plum', after.data.user.accent);
  const status = await me.get('/api/auth/status');
  check('and carried on the session, so the first frame is already in it',
    status.data.user.accent === 'plum', JSON.stringify(status.data.user));

  // --- what is refused ----------------------------------------------------
  for (const [label, body] of [
    ['a name that is not one of the colours', { accent: 'neon' }],
    ['markup', { accent: '"><script>' }],
    ['a number', { accent: 3 }],
    ['nothing at all', {}],
    ['null, which would be a back door to "never chose"', { accent: null }],
  ]) {
    const res = await me.post('/api/auth/accent', body);
    check(`${label} is refused`, res.status === 400, `${res.status} ${JSON.stringify(res.data)}`);
  }
  const unchanged = await me.get('/api/auth/me');
  check('and a refusal leaves the saved colour alone', unchanged.data.user.accent === 'plum',
    unchanged.data.user.accent);

  const anon = client();
  const noSession = await anon.post('/api/auth/accent', { accent: 'moss' });
  check('nobody signed in can set one', noSession.status === 401, String(noSession.status));

  // --- it is per person ---------------------------------------------------
  // The reason it lives on users and not households: two people sharing a
  // budget should each see their own colour.
  const invite = await me.post(`/api/households/${hh.data.id}/invites`, { role: 'viewer' });
  const them = client();
  await them.post('/api/auth/signup', { username: `acc2_${u}`, password: 'accentpass1' });
  await them.post('/api/households/accept', { code: invite.data.code });
  them.use(hh.data.id);

  const theirs = await them.post('/api/auth/accent', { accent: 'ocean' });
  check('someone else in the same household can choose their own',
    theirs.status === 200, `${theirs.status} ${JSON.stringify(theirs.data)}`);
  check('even as a viewer, because it changes nothing in the household',
    theirs.data.accent === 'ocean', JSON.stringify(theirs.data));
  const mineStill = await me.get('/api/auth/me');
  check('and it does not change mine', mineStill.data.user.accent === 'plum', mineStill.data.user.accent);

  // --- signing in again ---------------------------------------------------
  await me.post('/api/auth/logout');
  const back = await me.post('/api/auth/login', { username: `acc_${u}`, password: 'accentpass1' });
  check('signing back in returns the colour with the user',
    back.status === 200 && back.data.user?.accent === 'plum', JSON.stringify(back.data));

  const mint = await me.post('/api/auth/accent', { accent: 'mint' });
  check('choosing mint is stored as mint, not cleared to nothing',
    mint.data.accent === 'mint' && (await me.get('/api/auth/me')).data.user.accent === 'mint',
    JSON.stringify(mint.data));

  // --- the three lists agree ----------------------------------------------
  // The server checks names against its list, the client draws swatches from
  // its own, and the stylesheet holds the colours. A name in one and not the
  // others is either a swatch the server refuses or a saved colour with no CSS.
  const root = path.join(__dirname, '../..');
  const clientSrc = fs.readFileSync(path.join(root, 'client/src/utils/accent.js'), 'utf8');
  const clientKeys = [...clientSrc.matchAll(/key: '([a-z]+)'/g)].map((m) => m[1]);
  check('the client offers exactly the colours the server accepts, in the same order',
    clientKeys.join(',') === ACCENTS.join(','), `${clientKeys.join(',')} vs ${ACCENTS.join(',')}`);

  const css = fs.readFileSync(path.join(root, 'client/src/index.css'), 'utf8');
  const missing = ACCENTS.filter((name) => !css.includes(`[data-accent='${name}']`));
  check('and every one of them has colours in the stylesheet', missing.length === 0, missing.join(','));

  report('Accent colours');
})();
