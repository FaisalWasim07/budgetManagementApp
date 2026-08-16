// Sending to several accounts in one go.
//
// The reason this is one request rather than the front end firing a few is the
// overdraft rule: four calls each pass their own "is there enough?" against the
// same starting balance, so four times five thousand out of six thousand is
// allowed four times over. The sum has to fit, and if it doesn't, none of it
// may land.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();
const M = '2026-08';

(async () => {
  const me = client();
  await me.post('/api/auth/signup', { username: `split_${u}`, password: 'splitpass123' });
  const household = await me.post('/api/households', { name: 'Split Home', people: ['Faisal'] });
  me.use(household.data.id);

  const main = (await me.get('/api/accounts')).data[0];
  const personId = main.person_id;

  const account = async (name, extra = {}) =>
    (
      await me.post('/api/accounts', {
        person_id: personId,
        name,
        currency: 'AED',
        type: 'savings',
        ...extra,
      })
    ).data;

  const savings = await account('Savings');
  const rainyDay = await account('Rainy day');
  const investments = await account('Investments');
  const pkr = await account('PKR Savings', { currency: 'PKR' });
  const card = await account('Visa', { type: 'credit' });

  const balances = async () => {
    const summary = (await me.get(`/api/summary/${M}`)).data;
    return Object.fromEntries(summary.persons.flatMap((p) => p.accounts).map((a) => [a.id, a.balance]));
  };
  const rowsFor = async () => (await me.get(`/api/transactions?month=${M}`)).data;

  await me.post('/api/transactions', {
    account_id: main.id, month: M, kind: 'income', amount: 30000, description: 'Salary',
  });

  // --- one source, three destinations, one request ------------------------
  const split = await me.post('/api/transactions/transfer', {
    from_account_id: main.id,
    month: M,
    to: [
      { account_id: savings.id, amount: 5000 },
      { account_id: rainyDay.id, amount: 3000 },
      { account_id: investments.id, amount: 2000 },
    ],
  });
  check('a split transfer is accepted', split.status === 201, String(split.status));
  check('and writes two rows per destination', split.data.length === 6, String(split.data.length));

  const after = await balances();
  check('the source is down by the total', after[main.id] === 20000, String(after[main.id]));
  check('savings got its share', after[savings.id] === 5000, String(after[savings.id]));
  check('rainy day got its share', after[rainyDay.id] === 3000, String(after[rainyDay.id]));
  check('investments got its share', after[investments.id] === 2000, String(after[investments.id]));

  // Each destination is an ordinary transfer with an id of its own, exactly as
  // making them one at a time would have produced — so they edit, and delete,
  // one at a time too.
  const ids = new Set(split.data.map((r) => r.transfer_id));
  check('each destination is its own transfer', ids.size === 3, `${ids.size} ids`);
  const pairs = {};
  for (const row of split.data) (pairs[row.transfer_id] ??= []).push(row.kind);
  check(
    'and every one of them is a proper two-legged pair',
    Object.values(pairs).every((legs) => legs.length === 2 && new Set(legs).size === 2),
    JSON.stringify(Object.values(pairs))
  );

  // --- the total is what has to fit ---------------------------------------
  // Individually each of these is affordable out of 20,000. Together they are
  // not, and that is the whole point of doing it in one request.
  const before = await rowsFor();
  const tooMuch = await me.post('/api/transactions/transfer', {
    from_account_id: main.id,
    month: M,
    to: [
      { account_id: savings.id, amount: 15000 },
      { account_id: rainyDay.id, amount: 15000 },
    ],
  });
  check('a split that only overdraws in total is refused', tooMuch.status === 400, String(tooMuch.status));
  check(
    'and the refusal says what the total came to',
    /30000\.00/.test(tooMuch.data.error) && tooMuch.data.total === 30000,
    tooMuch.data.error
  );
  check(
    'nothing at all was written — not even the affordable leg',
    (await rowsFor()).length === before.length,
    `${(await rowsFor()).length} vs ${before.length}`
  );
  check('and the balance did not move', (await balances())[main.id] === 20000);

  // --- the rules that only make sense once there are several --------------
  const sameTwice = await me.post('/api/transactions/transfer', {
    from_account_id: main.id,
    month: M,
    to: [
      { account_id: savings.id, amount: 100 },
      { account_id: savings.id, amount: 200 },
    ],
  });
  check('the same account twice is refused', sameTwice.status === 400, String(sameTwice.status));

  const intoItself = await me.post('/api/transactions/transfer', {
    from_account_id: main.id,
    month: M,
    to: [
      { account_id: savings.id, amount: 100 },
      { account_id: main.id, amount: 100 },
    ],
  });
  check('a destination that is the source is refused', intoItself.status === 400, String(intoItself.status));

  const empty = await me.post('/api/transactions/transfer', {
    from_account_id: main.id, month: M, to: [],
  });
  check('sending to nobody is refused', empty.status === 400, String(empty.status));

  const zero = await me.post('/api/transactions/transfer', {
    from_account_id: main.id, month: M, to: [{ account_id: savings.id, amount: 0 }],
  });
  check('a zero amount is refused', zero.status === 400, String(zero.status));

  // --- currencies are per destination -------------------------------------
  const mixedMissing = await me.post('/api/transactions/transfer', {
    from_account_id: main.id,
    month: M,
    to: [
      { account_id: savings.id, amount: 500 },
      { account_id: pkr.id, amount: 500 },
    ],
  });
  check(
    'a destination in another currency still needs its arriving amount',
    mixedMissing.status === 400,
    String(mixedMissing.status)
  );
  check('and that refusal writes nothing either', (await balances())[main.id] === 20000);

  const mixed = await me.post('/api/transactions/transfer', {
    from_account_id: main.id,
    month: M,
    to: [
      { account_id: savings.id, amount: 500 },
      { account_id: pkr.id, amount: 500, to_amount: 38000 },
    ],
  });
  check('with it, a mixed-currency split goes through', mixed.status === 201, String(mixed.status));
  const mixedBalances = await balances();
  check('the near side left in its own currency', mixedBalances[main.id] === 19000, String(mixedBalances[main.id]));
  check('and the far side arrived in its own', mixedBalances[pkr.id] === 38000, String(mixedBalances[pkr.id]));

  // --- a card is still allowed to go under --------------------------------
  const fromCard = await me.post('/api/transactions/transfer', {
    from_account_id: card.id,
    month: M,
    to: [
      { account_id: savings.id, amount: 4000 },
      { account_id: rainyDay.id, amount: 4000 },
    ],
  });
  check('a credit card may still go negative in a split', fromCard.status === 201, String(fromCard.status));

  // --- the old shape has to keep working ----------------------------------
  const single = await me.post('/api/transactions/transfer', {
    from_account_id: main.id, to_account_id: savings.id, month: M, amount: 1000,
  });
  check('a plain one-to-one transfer still works', single.status === 201, String(single.status));
  check('and is still two rows', single.data.length === 2, String(single.data.length));

  const { failed } = report('Split transfers');
  process.exit(failed ? 1 : 0);
})();
