// Comparing kept statements, tested directly rather than through HTTP.
//
// Same reasoning as findings.test.js: this is arithmetic over rows somebody
// already read, so testing it through a route would mean paying for a model
// call to check a subtraction. What the routes do with these figures is
// covered in statements.test.js; what the figures ARE is covered here.
const history = require('../../server/src/services/statementHistory');
const { results } = require('../support/client');

const { check, report } = results();

const row = (merchant, amount, extra = {}) => ({
  date: '2026-08-04',
  raw: merchant.toUpperCase(),
  merchant,
  what: 'a shop',
  amount,
  direction: 'out',
  kind: 'purchase',
  category: 'Shopping',
  confidence: 'high',
  ...extra,
});

const statement = (id, periodStart, periodEnd, rows) => ({
  id,
  periodStart,
  periodEnd,
  currency: 'AED',
  rows,
});

(async () => {
  // --- the trend across statements ----------------------------------------
  const july = statement(1, '2026-07-01', '2026-07-31', [
    row('Carrefour', 400, { category: 'Groceries' }),
    row('Netflix', 56, { category: 'Subscriptions' }),
    // Cancelled before August, so it is the one that has to show up as
    // stopped. Without a merchant that genuinely goes away, that branch would
    // be asserted against an empty list and would pass having checked nothing.
    row('Gym Plus', 180, { category: 'Health' }),
    row('Acme FZE', 9000, { direction: 'in', kind: 'income', category: 'Salary' }),
    row('Card payment', 2000, { direction: 'in', kind: 'payment', category: 'Fees' }),
  ]);
  const august = statement(2, '2026-08-01', '2026-08-31', [
    row('Carrefour', 520, { category: 'Groceries' }),
    row('Netflix', 62, { category: 'Subscriptions' }),
    row('Emirates', 1800, { category: 'Travel' }),
  ]);

  // Handed in the wrong order on purpose: a statement scanned late must still
  // sort into the period it covers.
  const line = history.trend([august, july]);
  check('statements sort by the period they cover, not when they were kept',
    line.map((t) => t.id).join(',') === '1,2', line.map((t) => t.id).join(','));
  check('what left the account is totalled per statement',
    line[0].spent === 636 && line[1].spent === 2382,
    `${line[0].spent} then ${line[1].spent}`);
  // 400 + 56 + 180. The 2000 card payment and the 9000 salary both arrived,
  // and neither is spending.
  check('paying the card off is not counted as spending',
    line[0].spent === 636, String(line[0].spent));
  check('and it is not counted as income either',
    line[0].credits.income === 9000 && line[0].credits.payments === 2000,
    JSON.stringify(line[0].credits));

  // --- one against the other ----------------------------------------------
  const diff = history.compare(july.rows, august.rows);
  check('spending is compared between the two',
    diff.spent.before === 636 && diff.spent.after === 2382 && diff.spent.change === 1746,
    JSON.stringify(diff.spent));
  check('and said as a percentage of what it was',
    diff.spent.pct === 274.5, String(diff.spent.pct));

  check('categories come back by how much they moved, biggest first',
    diff.categories[0].name === 'Travel', diff.categories.map((c) => c.name).join(','));
  check('a category that did not move at all is left out',
    !diff.categories.some((c) => c.change === 0),
    JSON.stringify(diff.categories.map((c) => [c.name, c.change])));

  const travel = diff.categories.find((c) => c.name === 'Travel');
  check('something that was not there before has no percentage, rather than an infinite one',
    travel.before === 0 && travel.pct === null, JSON.stringify(travel));

  // --- merchants, split three ways ----------------------------------------
  check('a merchant that appeared is listed as having appeared',
    diff.merchants.appeared.map((m) => m.name).join(',') === 'Emirates',
    diff.merchants.appeared.map((m) => m.name).join(','));
  check('one that stopped is listed as having stopped',
    diff.merchants.stopped.map((m) => m.name).join(',') === 'Gym Plus',
    diff.merchants.stopped.map((m) => m.name).join(','));
  check('and carries what it used to cost, so a cancellation can be confirmed',
    diff.merchants.stopped[0].before === 180 && diff.merchants.stopped[0].after === 0,
    JSON.stringify(diff.merchants.stopped[0]));
  const carrefour = diff.merchants.moved.find((m) => m.name === 'Carrefour');
  check('one that is still there carries what it was and what it became',
    carrefour.before === 400 && carrefour.after === 520 && carrefour.change === 120,
    JSON.stringify(carrefour));
  check('money arriving is not compared as if it were spending',
    !diff.merchants.appeared.some((m) => m.name === 'Acme FZE') &&
      !diff.merchants.moved.some((m) => m.name === 'Acme FZE'),
    JSON.stringify(diff.merchants));

  // --- what comes back every statement ------------------------------------
  const repeats = history.recurring([july, august]);
  const netflix = repeats.find((r) => r.merchant === 'Netflix');
  check('a charge in both statements is found, which one statement could never show',
    Boolean(netflix) && netflix.statements === 2, JSON.stringify(netflix ?? null));
  check('a price that moved is reported rather than averaged away',
    netflix.steady === false && netflix.priceMove.before === 56 && netflix.priceMove.after === 62,
    JSON.stringify(netflix.priceMove));
  check('and what it costs now is the figure carried, not the mean of the two',
    netflix.latest === 62, String(netflix.latest));

  const groceries = repeats.find((r) => r.merchant === 'Carrefour');
  check('a charge that is in both but moved is still recurring',
    Boolean(groceries) && groceries.statements === 2, JSON.stringify(groceries ?? null));
  check('something seen in only one statement is not called recurring',
    !repeats.some((r) => r.merchant === 'Emirates'),
    repeats.map((r) => r.merchant).join(','));

  // Twice in one month is one statement's worth of evidence, not two.
  const twice = statement(3, '2026-09-01', '2026-09-30', [
    row('Spinneys', 100, { category: 'Groceries' }),
    row('Spinneys', 130, { category: 'Groceries' }),
  ]);
  const once = history.recurring([twice]);
  check('a merchant charged twice inside one statement has still only been seen once',
    once.length === 0, JSON.stringify(once.map((r) => [r.merchant, r.statements])));

  // The same merchant in a second statement, so it does recur — and the month
  // it was charged twice must count as one statement carrying the sum of both
  // lines, not as two statements' worth of evidence.
  const alsoSpinneys = statement(5, '2026-10-01', '2026-10-31', [
    row('Spinneys', 90, { category: 'Groceries' }),
  ]);
  const spanning = history.recurring([twice, alsoSpinneys]);
  const spinneys = spanning.find((r) => r.merchant === 'Spinneys');
  check('across two statements it recurs, counted once per statement',
    spinneys.statements === 2, String(spinneys.statements));
  check('and the month it was charged twice carries the sum of both lines',
    spinneys.charges[0].amount === 230 && spinneys.charges[1].amount === 90,
    JSON.stringify(spinneys.charges.map((c) => c.amount)));

  // --- categories drifting between statements -----------------------------
  //
  // The failure this guards against: a category is a label inside one report
  // and a join key across two, and a model reading September has no idea what
  // August called things. Two drifts, and only one of them can be designed out.

  // Spelling. Two readings of the same word, which must not become two
  // categories — the comparison would report one as vanished and the other as
  // new, with both totals wrong and an arrow beside each.
  const spelledOneWay = [row('Carrefour', 300, { category: 'Eating out' })];
  const spelledAnother = [row('Carrefour', 340, { category: 'eating  out' })];
  const spelling = history.compare(spelledOneWay, spelledAnother);
  check('the same category spelled differently is still one category',
    spelling.categories.length === 1 && spelling.categories[0].change === 40,
    JSON.stringify(spelling.categories));

  // But not so loosely that genuinely different words are merged. These two
  // are close enough to tempt a punctuation-stripping fold and different
  // enough that merging them would be guessing.
  const ampersand = history.compare(
    [row('Gym', 100, { category: 'Health & fitness' })],
    [row('Gym', 100, { category: 'Health and fitness' })],
  );
  check('two genuinely different words are not merged into one',
    ampersand.categories.length === 2, JSON.stringify(ampersand.categories.map((c) => c.name)));

  // Assignment. The same merchant, filed under two different but defensible
  // categories. Nothing about the spending changed, and without this the
  // report would show Groceries down 300 and Eating out up 300.
  const filedAsGroceries = [row('Tap Coffee', 300, { category: 'Groceries' })];
  const filedAsEatingOut = [row('Tap Coffee', 300, { category: 'Eating out' })];
  const drifted = history.compare(filedAsGroceries, filedAsEatingOut);
  check('a merchant refiled under another category shows as two category moves',
    drifted.categories.length === 2, JSON.stringify(drifted.categories.map((c) => c.name)));
  check('so the relabelling is named, rather than left looking like a spending change',
    drifted.recategorised.length === 1 &&
      drifted.recategorised[0].merchant === 'Tap Coffee' &&
      drifted.recategorised[0].was === 'Groceries' &&
      drifted.recategorised[0].now === 'Eating out',
    JSON.stringify(drifted.recategorised));
  check('with how much of the swing it accounts for',
    drifted.recategorised[0].amount === 300, JSON.stringify(drifted.recategorised[0]));
  check('and total spending is correctly unchanged, because nothing was actually spent',
    drifted.spent.change === 0, JSON.stringify(drifted.spent));

  // A merchant that stayed put is not reported as refiled.
  check('a merchant filed the same way both months is not called a relabelling',
    history.compare(filedAsGroceries, [row('Tap Coffee', 400, { category: 'Groceries' })])
      .recategorised.length === 0,
    'clean');

  // --- a statement with nothing in it -------------------------------------
  const empty = statement(4, '2026-10-01', '2026-10-31', []);
  const withEmpty = history.trend([empty]);
  check('a statement with no rows reports nothing rather than failing',
    withEmpty[0].spent === 0 && withEmpty[0].lines === 0, JSON.stringify(withEmpty[0]));
  const nothingBoth = history.compare([], []);
  check('comparing two empty statements is zero, not a divide by zero',
    nothingBoth.spent.change === 0 && nothingBoth.spent.pct === null,
    JSON.stringify(nothingBoth.spent));

  report('Comparing kept statements');
})();
