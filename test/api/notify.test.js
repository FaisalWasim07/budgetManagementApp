// What Bayt says when nobody is looking at it.
//
// The rule worth a test more than any other: no message may contain money. A
// notification lands on a lock screen, and the app spent a whole feature
// putting amounts behind a passkey — a summary that spells a balance onto the
// lock screen would undo that quietly and nobody would notice for months.
const { client, results, unique } = require('../support/client');
const notifyService = require('../../server/src/services/notifyService');

const { check, report } = results();
const u = unique();

// Anything that looks like an amount: a decimal, a thousands-separated number,
// or a currency code next to digits. Deliberately broad — a false alarm here
// costs a rewording, a miss costs a balance on a lock screen.
const MONEY = /(\d[\d,]*\.\d{2})|(\b\d{1,3}(,\d{3})+\b)|(\b(AED|USD|GBP|EUR|INR|PKR)\s?\d)|(\d\s?(AED|USD|GBP|EUR|INR|PKR)\b)/i;

(async () => {
  const me = client();
  const password = 'notifypass123';
  await me.post('/api/auth/signup', { username: `nt_${u}`, password });
  const household = await me.post('/api/households', { name: 'Notify Home', people: ['Faisal'] });
  const householdId = household.data.id;
  me.use(householdId);

  const people = await me.get('/api/persons');
  const account = await me.post('/api/accounts', {
    person_id: people.data[0].id,
    name: 'Main Account',
    currency: 'AED',
    opening_balance: 9000,
  });

  // Enough recurring items that the message has to summarise rather than list.
  const month = new Date().toISOString().slice(0, 7);
  for (const name of ['Netflix', 'DEWA', 'du', 'Salik', 'Gym']) {
    await me.post('/api/subscriptions', {
      account_id: account.data.id,
      name,
      amount: 1234.56,
      cycle: 'monthly',
      start_month: month,
      direction: 'expense',
    });
  }
  await me.post('/api/subscriptions', {
    account_id: account.data.id,
    name: 'Insurance',
    amount: 4800,
    cycle: 'yearly',
    billing_month: Number(month.split('-')[1]),
    start_month: month,
    direction: 'expense',
  });

  // --- the month opener ----------------------------------------------------
  const opener = await notifyService.monthOpener(householdId, month);
  check('the month opener has a title and a body', Boolean(opener.title && opener.body));
  check('it names the month', opener.title.includes(new Date().toLocaleString('en', { month: 'long' })), opener.title);
  check('and carries an emoji, as asked', /\p{Extended_Pictographic}/u.test(opener.title), opener.title);

  check(
    'it says how many items charge, which is not money',
    /\b6\b/.test(opener.body),
    opener.body
  );
  check('and calls out the yearly one, which is the forgettable kind', /yearly/i.test(opener.body), opener.body);

  // The one that matters.
  check(
    'NO AMOUNT appears anywhere in it',
    !MONEY.test(`${opener.title} ${opener.body}`),
    opener.body
  );

  // --- the quiet nudge -----------------------------------------------------
  const fresh = await notifyService.quietNudge(householdId, new Date());
  check(
    'nothing is said when something was recorded recently',
    fresh === null,
    JSON.stringify(fresh)
  );

  const later = new Date(Date.now() + 30 * 86400000);
  const stale = await notifyService.quietNudge(householdId, later);
  check('but a long silence is worth one message', Boolean(stale?.title), JSON.stringify(stale));
  check('with an emoji too', /\p{Extended_Pictographic}/u.test(stale.title), stale.title);
  check(
    'and no amount in that one either',
    !MONEY.test(`${stale.title} ${stale.body}`),
    stale.body
  );

  // --- the list reads as a sentence ---------------------------------------
  check('one name is just the name', notifyService.nameList(['A']) === 'A');
  check('two are joined with and', notifyService.nameList(['A', 'B']) === 'A and B');
  check('three are a list', notifyService.nameList(['A', 'B', 'C']) === 'A, B and C');
  check(
    'more than three are summarised rather than recited',
    notifyService.nameList(['A', 'B', 'C', 'D', 'E']) === 'A, B and 3 more',
    notifyService.nameList(['A', 'B', 'C', 'D', 'E'])
  );

  // --- the cron endpoint is not open to the world -------------------------
  // It cannot require a session, so the secret is the whole of its security.
  const anyone = client();
  const noAuth = await anyone.post('/api/cron/daily', {});
  check(
    'the scheduled job refuses a caller with no secret',
    noAuth.status === 401 || noAuth.status === 503,
    `${noAuth.status} ${JSON.stringify(noAuth.data)}`
  );

  const wrong = await anyone.post('/api/cron/daily', {}, { Authorization: 'Bearer not-the-secret' });
  check(
    'and one with the wrong secret',
    wrong.status === 401 || wrong.status === 503,
    `${wrong.status} ${JSON.stringify(wrong.data)}`
  );

  const right = await anyone.post('/api/cron/daily', {}, {
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
  });
  check(
    'and runs for the scheduler that has it',
    right.status === 200 && typeof right.data.considered === 'number',
    `${right.status} ${JSON.stringify(right.data)}`
  );

  // Nobody has a push subscription in this suite, so it should have decided
  // there was nothing to send rather than failing to send.
  check(
    'sending nothing is a normal outcome, not an error',
    Array.isArray(right.data.sent) && right.data.sent.length === 0,
    JSON.stringify(right.data.sent)
  );

  const { failed } = report('Scheduled notifications');
  process.exit(failed ? 1 : 0);
})();
