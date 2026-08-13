// What a month was worth, and the rule that keeps it that way: the month you
// are living in follows the live rate, and every month before it uses what was
// recorded at the time. Without this, a currency moving in November silently
// rewrites what September was worth, and a net worth chart redraws its own past.
//
// Rates are the one thing these suites cannot get from the API — snapshots are
// only ever written for the current month, so proving a *past* month is frozen
// means putting a past month's rate in directly. The Client below is the same
// database the server under test is using.
const { Client } = require('pg');
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();

const now = new Date();
const THIS_MONTH = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const shift = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const LAST_MONTH = shift(THIS_MONTH, -1);
const TWO_BACK = shift(THIS_MONTH, -2);

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
  const me = client();
  await me.post('/api/auth/signup', { username: `rates_${u}`, password: 'ratespass123' });
  const household = await me.post('/api/households', { name: 'Rates Home', people: ['Faisal'] });
  const householdId = household.data.id;
  me.use(householdId);

  const main = (await me.get('/api/accounts')).data[0];
  const pkr = (
    await me.post('/api/accounts', {
      person_id: main.person_id,
      name: 'Meezan Savings',
      currency: 'PKR',
      type: 'savings',
      opening_balance: 150000,
    })
  ).data;

  // No internet in a test run, so the manual override stands in for the rate
  // the app would otherwise fetch. 150,000 PKR at 0.0133 is about 2,000 AED.
  await me.put('/api/settings', { manualRates: { PKR: 0.0133 } });

  const worth = async (month) => {
    const summary = (await me.get(`/api/summary/${month}`)).data;
    const account = summary.persons[0].accounts.find((a) => a.id === pkr.id);
    return { primary: Math.round(account.balancePrimary), rate: account.rate };
  };

  // --- this month follows the live rate ------------------------------------
  const before = await worth(THIS_MONTH);
  check('the current month converts at the live rate', before.primary === 1995, String(before.primary));
  check('and says so', before.rate.source === 'manual', before.rate.source);

  // Looking at it is what records it.
  const recorded = await withDatabase((db) =>
    db.query(
      `SELECT month, rate FROM exchange_rate_history
       WHERE household_id = $1 AND base_currency = 'PKR' ORDER BY month`,
      [householdId]
    )
  );
  check('opening the app records this month’s rate', recorded.rows.length === 1, JSON.stringify(recorded.rows));
  check('against the month being viewed', recorded.rows[0]?.month === THIS_MONTH, recorded.rows[0]?.month);
  check('at the rate it used', Number(recorded.rows[0]?.rate) === 0.0133, String(recorded.rows[0]?.rate));

  // --- the rate halves ------------------------------------------------------
  await me.put('/api/settings', { manualRates: { PKR: 0.00665 } });

  const after = await worth(THIS_MONTH);
  check('the current month follows it down', after.primary === 998, String(after.primary));
  check(
    'and the recorded rate for this month follows too, while the month is still running',
    Number(
      (
        await withDatabase((db) =>
          db.query(
            `SELECT rate FROM exchange_rate_history
             WHERE household_id = $1 AND month = $2 AND base_currency = 'PKR'`,
            [householdId, THIS_MONTH]
          )
        )
      ).rows[0]?.rate
    ) === 0.00665
  );

  // --- a month that has ended does not move --------------------------------
  // Standing in for having used the app last month, when the rupee was worth
  // more. This is the whole feature.
  await withDatabase((db) =>
    db.query(
      `INSERT INTO exchange_rate_history (household_id, month, base_currency, target_currency, rate)
       VALUES ($1, $2, 'PKR', 'AED', 0.0133)`,
      [householdId, LAST_MONTH]
    )
  );

  const past = await worth(LAST_MONTH);
  check('last month still says what it was worth then', past.primary === 1995, String(past.primary));
  check('and reports that it is a recorded rate', past.rate.source === 'historical', past.rate.source);
  check('naming the month it came from', past.rate.rateMonth === LAST_MONTH, past.rate.rateMonth);

  const stillNow = await worth(THIS_MONTH);
  check('while this month is unchanged by any of it', stillNow.primary === 998, String(stillNow.primary));

  // --- a month with no record borrows the last one before it ---------------
  const older = await worth(TWO_BACK);
  check(
    'a month you never opened the app in falls back to today’s rate',
    older.rate.source === 'estimated',
    older.rate.source
  );
  check('and says it is an estimate rather than passing it off', older.primary === 998, String(older.primary));

  // --- the trend uses each month's own rate --------------------------------
  const trend = (await me.get('/api/summary/trend?months=3')).data;
  const byMonth = Object.fromEntries(trend.map((t) => [t.month, Math.round(t.netWorth)]));
  check(
    'the chart shows last month at last month’s rate',
    byMonth[LAST_MONTH] === 1995,
    JSON.stringify(byMonth)
  );
  check(
    'and this month at today’s — a real drop, not a flat line',
    byMonth[THIS_MONTH] === 998,
    JSON.stringify(byMonth)
  );

  // --- and none of it leaks between households ------------------------------
  const other = client();
  await other.post('/api/auth/signup', { username: `rates_b_${u}`, password: 'ratespass123' });
  const theirs = await other.post('/api/households', { name: 'Theirs', people: ['Someone'] });
  other.use(theirs.data.id);
  await other.post('/api/accounts', {
    person_id: (await other.get('/api/accounts')).data[0].person_id,
    name: 'Their PKR',
    currency: 'PKR',
    type: 'savings',
    opening_balance: 150000,
  });

  const theirPast = (await other.get(`/api/summary/${LAST_MONTH}`)).data.persons[0].accounts.find(
    (a) => a.currency === 'PKR'
  );
  check(
    'another household does not inherit your recorded rates',
    theirPast.rate.source !== 'historical',
    theirPast.rate.source
  );

  module.exports.result = report('Exchange rates over time');
})();
