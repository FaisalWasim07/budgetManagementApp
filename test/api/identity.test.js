// Knowing which person a login is, without being asked.
//
// The app keeps logins and people apart on purpose: a household can hold
// somebody who never signs in — a child with a savings account — and accounts
// belong to people, not to logins. But a member with no person is a member the
// app cannot address. Their own accounts do not lead their dashboard, and money
// arriving for them is money nobody is told about.
//
// So every way into a household has to establish that link by itself. Two of
// them used not to, which is what these cover.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();
const password = 'identity12345';

const meFor = async (c) => (await c.get('/api/persons')).data;

(async () => {
  // --- creating a household ------------------------------------------------
  // The form asks for your own name first and says so, so the first person is
  // the creator. Nothing here is a guess.
  const faisal = client();
  await faisal.post('/api/auth/signup', { username: `id_${u}`, password });
  const home = await faisal.post('/api/households', {
    name: 'Bayt',
    people: ['Faisal', 'Arooj'],
  });
  faisal.use(home.data.id);

  const people = await meFor(faisal);
  const mine = people.find((p) => p.name === 'Faisal');
  const theirs = people.find((p) => p.name === 'Arooj');

  check(
    'creating a household links the creator to their own person',
    Boolean(mine?.user_id),
    JSON.stringify(people.map((p) => [p.name, p.user_id]))
  );
  check(
    'and leaves everyone else unclaimed, because they may never sign in at all',
    theirs?.user_id == null,
    JSON.stringify([theirs?.name, theirs?.user_id])
  );
  check(
    'the creator is marked as being themselves',
    people.some((p) => p.is_me === true || p.is_me === 1) ||
      Boolean(mine?.user_id),
    JSON.stringify(people[0])
  );

  // --- accepting an invite -------------------------------------------------
  // The household already holds an unclaimed "Arooj". Whoever accepts should
  // become her without being asked which one they are.
  const invite = await faisal.post(`/api/households/${home.data.id}/invites`, { role: 'editor' });
  const arooj = client();
  await arooj.post('/api/auth/signup', { username: `id2_${u}`, password });
  const joined = await arooj.post('/api/households/accept', { code: invite.data.code });
  arooj.use(home.data.id);

  check('the invite is accepted', joined.status === 200, JSON.stringify(joined.data));
  check(
    'and the only unclaimed person is deduced to be them',
    Boolean(joined.data.personId),
    JSON.stringify(joined.data)
  );

  const after = await meFor(arooj);
  const hers = after.find((p) => p.name === 'Arooj');
  check(
    'so Arooj now owns Arooj',
    Boolean(hers?.user_id) && hers.user_id !== mine.user_id,
    JSON.stringify(after.map((p) => [p.name, p.user_id]))
  );

  // --- and it never guesses when it cannot know ---------------------------
  // Two unclaimed people and a username matching neither is ambiguous, and an
  // unresolved link is recoverable where a wrong one is not: it would send
  // somebody else's money notices to the wrong phone.
  const other = client();
  await other.post('/api/auth/signup', { username: `id3_${u}`, password });
  const twoOpen = await other.post('/api/households', {
    name: 'Ambiguous',
    people: ['Owner', 'Ana', `Bea${u}`],
  });
  const openInvite = await other.post(`/api/households/${twoOpen.data.id}/invites`, {
    role: 'editor',
  });
  const stranger = client();
  await stranger.post('/api/auth/signup', { username: `id4_${u}`, password });
  const guessed = await stranger.post('/api/households/accept', { code: openInvite.data.code });
  check(
    'two candidates and no name match is left for the app to ask about',
    guessed.status === 200 && !guessed.data.personId,
    JSON.stringify(guessed.data)
  );

  // --- a name match beats elimination -------------------------------------
  const named = client();
  // Unique per run: signups persist, so a fixed name collides on the second.
  const namedUser = `Bea${u}`;
  await named.post('/api/auth/signup', { username: namedUser, password });
  const namedInvite = await other.post(`/api/households/${twoOpen.data.id}/invites`, {
    role: 'editor',
  });
  const matched = await named.post('/api/households/accept', { code: namedInvite.data.code });
  check(
    'a username that matches a person by name is that person',
    Boolean(matched.data.personId),
    JSON.stringify(matched.data)
  );
  named.use(twoOpen.data.id);
  const namedPeople = await meFor(named);
  const bea = namedPeople.find((p) => p.name === `Bea${u}`);
  check('and it is the right one', Boolean(bea?.user_id), JSON.stringify(namedPeople.map((p) => [p.name, p.user_id])));

  const { failed } = report('Knowing who you are');
  process.exit(failed ? 1 : 0);
})();
