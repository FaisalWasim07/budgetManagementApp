// The statement findings, tested directly rather than through HTTP.
//
// Every other suite here drives the API, because every other thing in this app
// is only true through it. This one is arithmetic: what the scanner tells you
// about a statement is worked out in code precisely so a model cannot get it
// wrong, and testing it through a route would mean paying for a model call to
// check a subtraction.
const findings = require('../../server/src/services/statementFindings');
const { results } = require('../support/client');

const { check, report } = results();

const row = (date, merchant, amount, extra = {}) => ({
  date,
  raw: merchant.toUpperCase(),
  merchant,
  what: 'a shop',
  amount,
  direction: 'out',
  kind: 'purchase',
  category: 'Eating out',
  confidence: 'high',
  ...extra,
});

(async () => {
  // --- the shape of it ----------------------------------------------------
  const mixed = [
    row('2026-08-03', 'Tap Coffee', 28),
    row('2026-08-04', 'Carrefour', 412.75, { category: 'Groceries' }),
    row('2026-08-14', 'Acme FZE', 20000, { direction: 'in', kind: 'income', category: 'Salary' }),
  ];
  const shape = findings.overview(mixed);
  check('what left the account is totalled on its own', shape.spent === 440.75, String(shape.spent));
  check('and what arrived is kept separate', shape.credited === 20000, String(shape.credited));
  check('the period runs from the first date to the last',
    shape.from === '2026-08-03' && shape.to === '2026-08-14', `${shape.from}..${shape.to}`);
  check('money arriving is not counted as spending',
    findings.byCategory(mixed).every((c) => c.category !== 'Salary'),
    JSON.stringify(findings.byCategory(mixed).map((c) => c.category)));

  // --- categories ---------------------------------------------------------
  const groups = findings.byCategory(mixed);
  check('categories come back largest first', groups[0].category === 'Groceries', groups[0].category);
  check('shares are of what was spent, not of everything that moved',
    Math.abs(groups[0].share - 93.6) < 0.2, String(groups[0].share));
  check('and shares add up to a hundred',
    Math.abs(groups.reduce((t, g) => t + g.share, 0) - 100) < 0.2,
    String(groups.reduce((t, g) => t + g.share, 0)));

  // --- duplicates ---------------------------------------------------------
  const twice = [
    row('2026-08-07', 'Talabat', 96.5),
    row('2026-08-07', 'Talabat', 96.5),
    row('2026-08-09', 'Talabat', 96.5),
  ];
  const dupes = findings.duplicates(twice);
  check('the same amount to the same place on one day is found once',
    dupes.length === 1 && dupes[0].times === 2, JSON.stringify(dupes));
  check('and the same charge on another day is not a duplicate',
    dupes[0].total === 193, String(dupes[0].total));

  // --- repeats, and whether they are known --------------------------------
  const monthly = [
    row('2026-08-09', 'NETFLIX.COM AMSTERDAM', 56),
    row('2026-09-09', 'NETFLIX.COM AMSTERDAM', 56),
    row('2026-08-21', 'Spotify', 39),
    row('2026-09-21', 'Spotify', 39),
  ];
  const known = [{ name: 'Netflix', amount: 56, direction: 'expense', cycle: 'monthly' }];
  const repeated = findings.repeats(monthly, known);
  check('a charge that came back a month later is a repeat', repeated.length === 2, String(repeated.length));
  // The bank writes NETFLIX.COM AMSTERDAM where the household wrote Netflix.
  // An exact match would find nothing, which is the whole reason for matching
  // loosely.
  check('one the household already budgets for is marked as known',
    repeated.find((r) => r.merchant.includes('NETFLIX')).listed === true);
  check('and named as they have it',
    repeated.find((r) => r.merchant.includes('NETFLIX')).listedAs === 'Netflix');
  check('one it does not know about is marked unlisted',
    repeated.find((r) => r.merchant === 'Spotify').listed === false);

  const sameDayOnly = findings.repeats(
    [row('2026-08-07', 'Talabat', 96.5), row('2026-08-07', 'Talabat', 96.5)],
    []
  );
  check('two charges on one day are a duplicate, not a repeat', sameDayOnly.length === 0);

  // --- subscriptions with no charge ---------------------------------------
  const missing = findings.missingSubscriptions(
    [row('2026-08-09', 'NETFLIX.COM AMSTERDAM', 56)],
    [
      { name: 'Netflix', amount: 56, direction: 'expense', cycle: 'monthly' },
      { name: 'Gym', amount: 250, direction: 'expense', cycle: 'monthly' },
      { name: 'Salary', amount: 20000, direction: 'income', cycle: 'monthly' },
      { name: 'Insurance', amount: 900, direction: 'expense', cycle: 'yearly' },
    ]
  );
  check('a monthly subscription with no charge on the statement is reported',
    missing.length === 1 && missing[0].name === 'Gym', JSON.stringify(missing));
  check('one that did charge is not', !missing.some((m) => m.name === 'Netflix'));
  check('and neither is money coming in, or something billed yearly',
    !missing.some((m) => m.name === 'Salary' || m.name === 'Insurance'));

  // --- outliers -----------------------------------------------------------
  const coffees = [
    row('2026-08-01', 'Tap Coffee', 28),
    row('2026-08-05', 'Tap Coffee', 31),
    row('2026-08-09', 'Tap Coffee', 26),
    row('2026-08-14', 'Tap Coffee', 30),
    row('2026-08-20', 'Long Lunch', 480),
  ];
  const odd = findings.outliers(findings.byCategory(coffees));
  check('a line far above its own category is called out',
    odd.length === 1 && odd[0].amount === 480, JSON.stringify(odd));
  // 30, not 29: the median is taken over the whole category including the
  // large line itself. That is the point of a median — it barely moves for the
  // outlier it is being used to find, where a mean would be dragged up by it
  // and could hide it.
  check('and it says what normal looks like there', odd[0].typical === 30, String(odd[0].typical));

  // Rent is larger than every coffee and entirely unremarkable, which is why
  // the comparison is inside a category rather than across the statement.
  const withRent = findings.outliers(
    findings.byCategory([...coffees.slice(0, 4), row('2026-08-01', 'Landlord', 6000, { category: 'Rent' })])
  );
  check('a large payment in a category of its own is not an outlier',
    !withRent.some((o) => o.category === 'Rent'), JSON.stringify(withRent));

  const thin = findings.outliers(findings.byCategory([row('2026-08-01', 'A', 5), row('2026-08-02', 'B', 900)]));
  check('a category too thin to have a normal says nothing', thin.length === 0, JSON.stringify(thin));

  // --- small and frequent -------------------------------------------------
  const habit = Array.from({ length: 7 }, (_, i) =>
    row(`2026-08-0${i + 1}`, 'Tap Coffee', 28)
  );
  const often = findings.frequent([...habit, row('2026-08-20', 'Ikea', 1450)]);
  check('a small charge made often is gathered up',
    often.length === 1 && often[0].times === 7, JSON.stringify(often));
  check('with what it came to', often[0].total === 196, String(often[0].total));
  check('and one large payment is not a habit', !often.some((f) => f.merchant === 'Ikea'));

  // --- nothing at all -----------------------------------------------------
  const nothing = findings.analyse([], []);
  check('an empty statement does not divide by zero',
    nothing.overview.spent === 0 && nothing.categories.length === 0,
    JSON.stringify(nothing.overview));

  // --- the rows are not repeated back -------------------------------------
  const analysed = findings.analyse(mixed, []);
  check('the summary does not carry every row a second time',
    analysed.categories.every((c) => c.rows === undefined));

  // --- what a real credit card statement taught this file ------------------
  // Every case below came from running these functions over an actual monthly
  // statement. None of them showed up against invented data, because invented
  // data is tidy in exactly the ways a bank is not.

  // Paying a card off arrives as a credit for the whole balance. Counted as
  // money received, it says you earned ten thousand by settling your own bill.
  const card = findings.overview([
    row('2026-08-01', 'TRANSFER PAYMENT RECEIVED', 10117.51, { direction: 'in', kind: 'payment' }),
    row('2026-08-03', 'CASHBACK', 342, { direction: 'in', kind: 'cashback' }),
    row('2026-08-09', 'Amazon Grocery', 46, { direction: 'in', kind: 'refund' }),
    row('2026-08-04', 'Al Maya Supermarket', 38.58),
  ]);
  check('paying the card off is not counted as income', card.credits.income === 0,
    JSON.stringify(card.credits));
  check('it is reported as what it is', card.credits.payments === 10117.51, String(card.credits.payments));
  check('with cashback and refunds kept apart from both',
    card.credits.cashback === 342 && card.credits.refunds === 46, JSON.stringify(card.credits));

  // A works canteen charging the same 20.00 on fifteen days of one month is a
  // lunch habit, not a subscription somebody forgot to budget for. Reported as
  // recurring it buries the real findings under lunch.
  const canteen = Array.from({ length: 15 }, (_, i) =>
    row(`2026-08-${String(i + 1).padStart(2, '0')}`, 'ADNH CATERING LLC OPC', 20)
  );
  check('a daily charge at the same price is not called a subscription',
    findings.repeats(canteen, []).length === 0, JSON.stringify(findings.repeats(canteen, [])));
  check('but it is still gathered up as a habit',
    findings.frequent(canteen)[0].times === 15, JSON.stringify(findings.frequent(canteen)[0]));

  // --- reconciliation, the only check that can catch a misreading ----------
  const statement = { openingBalance: 100, closingBalance: 130, periodStart: null, periodEnd: null };
  const balanced = [
    row('2026-08-02', 'Shop', 50),
    row('2026-08-03', 'Refund', 20, { direction: 'in', kind: 'refund' }),
  ];
  check('a reading that adds up to the bank’s own closing balance passes',
    findings.reconcile(balanced, statement).status === 'ok',
    JSON.stringify(findings.reconcile(balanced, statement)));
  check('and says it read as a card, where a purchase raises what is owed',
    findings.reconcile(balanced, statement).reads === 'card');

  // The same rows against a current account, where spending lowers the
  // balance. One formula for both would call every bank statement broken.
  const asAccount = findings.reconcile(balanced, { ...statement, closingBalance: 70 });
  check('a current account reconciles the other way round', asAccount.status === 'ok',
    JSON.stringify(asAccount));
  check('and says so', asAccount.reads === 'account', asAccount.reads);

  // The credit dropped rather than the debit, so only one orientation is
  // remotely plausible and the gap it reports is unambiguous. With a broken
  // reading the shape itself is a guess, and the closer of the two is the
  // honest one to report against.
  const short = findings.reconcile([balanced[0]], statement);
  check('a dropped line is caught', short.status === 'mismatch', JSON.stringify(short));
  check('and the gap is exactly the line that went missing', short.delta === 20, String(short.delta));

  const doubled = findings.reconcile([...balanced, balanced[0]], statement);
  check('a line counted twice is caught too', doubled.status === 'mismatch', String(doubled.delta));
  check('and that one can be pointed at, because it is still there',
    doubled.countedTwice?.amount === 50, JSON.stringify(doubled.countedTwice));

  const rounding = findings.reconcile(balanced, { ...statement, closingBalance: 130.01 });
  check('a cent of rounding is not a misread statement', rounding.status === 'ok', JSON.stringify(rounding));

  check('a statement that prints no balances is unchecked, not failed',
    findings.reconcile(balanced, null).status === 'unchecked');
  check('and so is one that prints only half of them',
    findings.reconcile(balanced, { openingBalance: 100, closingBalance: null }).status === 'unchecked');

  const { failed } = report('Statement findings');
  process.exit(failed ? 1 : 0);
})();
