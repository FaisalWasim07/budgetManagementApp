// A description on an entry and on a move between accounts.
//
// Stored as written, minus the edges: trimmed, capped at a line's worth, and
// blank kept as nothing rather than as an empty string every reader then has to
// treat as missing. A transfer is two rows, and both carry it.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();
const M = '2026-10';

(async () => {
  const me = client();
  await me.post('/api/auth/signup', { username: `desc_${u}`, password: 'descpass1234' });
  const hh = await me.post('/api/households', { name: 'Desc Home', people: ['Faisal'] });
  me.use(hh.data.id);
  const main = (await me.get('/api/accounts')).data[0];
  const savings = (await me.post('/api/accounts', {
    person_id: main.person_id, name: 'Savings', currency: 'AED', type: 'savings',
  })).data;

  const entry = (await me.post('/api/transactions', {
    account_id: main.id, month: M, kind: 'expense', amount: 214.5, category: 'Groceries',
    description: '  Weekly shop at Carrefour  ',
  })).data;
  check('an entry keeps its description', entry.description === 'Weekly shop at Carrefour', JSON.stringify(entry.description));
  check('alongside its category, not instead of it', entry.category === 'Groceries', entry.category);

  const blank = (await me.post('/api/transactions', {
    account_id: main.id, month: M, kind: 'income', amount: 9000, description: '   ',
  })).data;
  check('a blank description is stored as nothing', blank.description === null, JSON.stringify(blank.description));

  const long = (await me.post('/api/transactions', {
    account_id: main.id, month: M, kind: 'expense', amount: 1, description: 'x'.repeat(500),
  })).data;
  check('a description is capped at a line’s worth', long.description.length === 200, String(long.description.length));

  // --- moving money -------------------------------------------------------
  const moved = (await me.post('/api/transactions/transfer', {
    from_account_id: main.id, to_account_id: savings.id, month: M, amount: 2500,
    description: 'November savings',
  })).data;
  const legs = Array.isArray(moved) ? moved : moved.rows ?? [];
  check('a transfer carries its description on both sides',
    legs.length === 2 && legs.every((leg) => leg.description === 'November savings'),
    JSON.stringify(legs.map((leg) => leg.description)));

  const split = (await me.post('/api/transactions/transfer', {
    from_account_id: main.id, month: M, description: 'Pay day split',
    to: [{ account_id: savings.id, amount: 100 }],
  })).data;
  const splitLegs = Array.isArray(split) ? split : split.rows ?? [];
  check('and so does a move split across accounts',
    splitLegs.length === 2 && splitLegs.every((leg) => leg.description === 'Pay day split'),
    JSON.stringify(splitLegs.map((leg) => leg.description)));

  // --- it is what Activity reads ------------------------------------------
  const listed = (await me.get(`/api/transactions?month=${M}`)).data;
  check('the activity list returns the description with each entry',
    listed.some((row) => row.description === 'Weekly shop at Carrefour') &&
      listed.filter((row) => row.description === 'November savings').length === 2,
    JSON.stringify(listed.map((row) => row.description)));

  // --- editing ------------------------------------------------------------
  const edited = (await me.patch(`/api/transactions/${entry.id}`, { description: ' Carrefour, big shop ' })).data;
  check('editing a description trims it the same way', edited.description === 'Carrefour, big shop',
    JSON.stringify(edited.description));
  const cleared = (await me.patch(`/api/transactions/${entry.id}`, { description: '' })).data;
  check('and clearing it leaves nothing, not an empty string', cleared.description === null,
    JSON.stringify(cleared.description));
  const untouched = (await me.patch(`/api/transactions/${entry.id}`, { amount: 220 })).data;
  check('an edit that does not mention it leaves it alone', untouched.description === null && untouched.amount === 220,
    JSON.stringify(untouched));

  const leg = legs[0];
  const legEdit = (await me.patch(`/api/transactions/${leg.id}`, { description: 'Rainy day fund' })).data;
  const bothLegs = Array.isArray(legEdit) ? legEdit : [legEdit];
  check('editing one side of a transfer changes both',
    bothLegs.length === 2 && bothLegs.every((row) => row.description === 'Rainy day fund'),
    JSON.stringify(bothLegs.map((row) => row.description)));

  report('Descriptions');
})();
