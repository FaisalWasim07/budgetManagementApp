// Which person is which login.
//
// The point of the link is not the label — it is that your own money leads your
// dashboard, and that every entry form starts on your account rather than on
// whoever happened to be added first. Both of those come from the order the
// summary returns people in, so that order is what these check.
const { Client } = require('pg');
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();

const now = new Date();
const MONTH = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

async function withDatabase(run) {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

(async () => {
  // --- a household where the app can work it out ---------------------------
  const owner = client();
  await owner.post('/api/auth/signup', { username: `faisal_${u}`, password: 'ownerpass123' });
  const home = await owner.post('/api/households', {
    name: 'Link Home',
    people: [`faisal_${u}`, 'Sara'],
  });
  owner.use(home.data.id);

  // The household was created with a person named after the owner, so the
  // name pass has something to find. The migration only runs at boot, so the
  // link is made here the way the app makes it from now on.
  const people = (await owner.get('/api/persons')).data;
  const mine = people.find((p) => p.name === `faisal_${u}`);
  const hers = people.find((p) => p.name === 'Sara');

  await owner.put(`/api/persons/${mine.id}/user`, { user_id: null });
  const nonsense = await owner.put(`/api/persons/${mine.id}/user`, { user_id: 'me' });
  check('a login id that is not a number is refused', nonsense.status === 400, String(nonsense.status));
  const absent = await owner.put(`/api/persons/${mine.id}/user`, { user_id: 999999 });
  check('a login that is not in this household is refused', absent.status === 404, String(absent.status));

  const meRow = (await owner.get('/api/auth/me')).data.user;
  await owner.put(`/api/persons/${mine.id}/user`, { user_id: meRow.id });

  const summary = (await owner.get(`/api/summary/${MONTH}`)).data;
  check('your own person leads your dashboard', summary.persons[0].name === `faisal_${u}`, summary.persons.map((p) => p.name).join(', '));
  check('and is marked as being you', summary.persons[0].userId === meRow.id, String(summary.persons[0].userId));

  // --- the other member sees it the other way round ------------------------
  const wife = client();
  await wife.post('/api/auth/signup', { username: `az_${u}`, password: 'wifepass123' });
  const wifeMe = (await wife.get('/api/auth/me')).data.user;
  await owner.post(`/api/households/${home.data.id}/members`, {
    username: `az_${u}`,
    role: 'editor',
    add_person: false,
  });
  wife.use(home.data.id);

  const beforeLink = (await wife.get(`/api/summary/${MONTH}`)).data;
  check(
    'before linking she still sees the household in creation order',
    beforeLink.persons[0].name === `faisal_${u}`,
    beforeLink.persons.map((p) => p.name).join(', ')
  );

  await owner.put(`/api/persons/${hers.id}/user`, { user_id: wifeMe.id });

  const afterLink = (await wife.get(`/api/summary/${MONTH}`)).data;
  check('once linked, her own person leads hers', afterLink.persons[0].name === 'Sara', afterLink.persons.map((p) => p.name).join(', '));

  const ownerView = (await owner.get(`/api/summary/${MONTH}`)).data;
  check(
    'and his own still leads his — the same data, two orders',
    ownerView.persons[0].name === `faisal_${u}`,
    ownerView.persons.map((p) => p.name).join(', ')
  );

  // The account an entry form starts on is the first account of the first
  // person, so this is the part that stops her spending being filed against
  // his account by default.
  check(
    'so the first account offered to her is hers',
    afterLink.persons[0].accounts[0].personId === hers.id,
    JSON.stringify(afterLink.persons[0].accounts[0]?.name)
  );

  // --- one login is one person --------------------------------------------
  await owner.put(`/api/persons/${hers.id}/user`, { user_id: meRow.id });
  const stolen = (await owner.get('/api/persons')).data;
  check(
    'claiming a login takes it off whoever held it',
    stolen.find((p) => p.id === hers.id).user_id === meRow.id &&
      stolen.find((p) => p.id === mine.id).user_id === null,
    JSON.stringify(stolen.map((p) => [p.name, p.user_id]))
  );
  await owner.put(`/api/persons/${mine.id}/user`, { user_id: meRow.id });

  // --- who may set it ------------------------------------------------------
  // A member may say which person they are, but not at someone else's
  // expense: taking a person who is already spoken for would unlink whoever
  // held it, quietly changing their dashboard.
  const stealing = await wife.put(`/api/persons/${mine.id}/user`, { user_id: wifeMe.id });
  check(
    'a member cannot take a person who is already someone',
    stealing.status === 409,
    String(stealing.status)
  );

  const meddling = await wife.put(`/api/persons/${hers.id}/user`, { user_id: meRow.id });
  check(
    'and cannot assign a person to anybody but themselves',
    meddling.status === 403,
    String(meddling.status)
  );

  // The one she may do: claim a person nobody has claimed.
  const spare = (await owner.post('/api/persons', { name: `Spare_${u}`, with_account: false })).data;
  const claimed = await wife.put(`/api/persons/${spare.id}/user`, { user_id: wifeMe.id });
  check('but may claim a person nobody holds', claimed.status === 200, String(claimed.status));
  await owner.put(`/api/persons/${hers.id}/user`, { user_id: wifeMe.id });

  const stranger = client();
  await stranger.post('/api/auth/signup', { username: `out_${u}`, password: 'strangerpass1' });
  await stranger.post('/api/households', { name: 'Other Home', people: ['Nobody'] });
  const trespass = await stranger.put(`/api/persons/${mine.id}/user`, { user_id: meRow.id });
  check('another household cannot touch this one', trespass.status === 404, String(trespass.status));

  // --- the migration's two passes -----------------------------------------
  // Run against rows put in directly, because the passes only ever run at
  // boot against data that predates the column.
  await withDatabase(async (db) => {
    const { rows: [household] } = await db.query(
      "INSERT INTO households (name) VALUES ('Elimination Home') RETURNING id"
    );
    const user = async (username) => {
      const { rows } = await db.query(
        "INSERT INTO users (username, password_hash) VALUES ($1, 'x:y') RETURNING id",
        [username]
      );
      await db.query(
        "INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'editor')",
        [household.id, rows[0].id]
      );
      return rows[0].id;
    };
    const person = async (name) => {
      const { rows } = await db.query(
        'INSERT INTO persons (household_id, name) VALUES ($1, $2) RETURNING id',
        [household.id, name]
      );
      return rows[0].id;
    };

    // One pair matches by name; the other pair matches by nothing at all, and
    // is what elimination is for.
    const named = await user(`Mig_${u}`);
    const opaque = await user(`opaque_${u}`);
    const namedPerson = await person(`mig_${u}`);
    const otherPerson = await person('Sara');

    // Called directly rather than through `run`: the linking pass only fires
    // when the column is first added, which has already happened by now.
    const pool = require('../../server/src/db/pool');
    const { linkPeopleToTheirLogins } = require('../../server/src/db/migrations');
    await pool.tx(linkPeopleToTheirLogins);

    const { rows } = await db.query('SELECT id, user_id FROM persons WHERE household_id = $1', [
      household.id,
    ]);
    const link = (id) => rows.find((r) => r.id === id)?.user_id;

    check('a name match is found whatever the case', link(namedPerson) === named, String(link(namedPerson)));
    check(
      'and the last pair is settled by elimination',
      link(otherPerson) === opaque,
      String(link(otherPerson))
    );

    // A household holding someone with no login — a child's savings — has more
    // people than members, so there is a spare person and elimination must not
    // guess which one the login belongs to.
    const { rows: [second] } = await db.query(
      "INSERT INTO households (name) VALUES ('Child Home') RETURNING id"
    );
    const { rows: [lonely] } = await db.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, 'x:y') RETURNING id",
      [`solo_${u}`]
    );
    await db.query(
      "INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')",
      [second.id, lonely.id]
    );
    await db.query('INSERT INTO persons (household_id, name) VALUES ($1, $2), ($1, $3)', [
      second.id,
      'Mum',
      'Child',
    ]);

    await pool.tx(linkPeopleToTheirLogins);
    const { rows: untouched } = await db.query(
      'SELECT user_id FROM persons WHERE household_id = $1',
      [second.id]
    );
    check(
      'a household with a person who has no login is left alone',
      untouched.every((r) => r.user_id === null),
      JSON.stringify(untouched)
    );
  });

  const { failed } = report('Who is who');
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
