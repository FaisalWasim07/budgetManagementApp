// Grouping a statement's spend into categories the report can open.
//
// The server groups them too, and that grouping is what the summary reads.
// This one keeps the rows and merges spellings, and both of those are worth
// pinning: a category that cannot show its lines is a count nobody can follow,
// and a statement read in eighteen slices — none of which can see what the one
// before it called things — produces `Groceries` and `groceries` as two rows
// with two bars unless something folds them.
const path = require('path');
const { results } = require('../support/client');

const { check, report } = results();

const out = (category, amount, merchant = 'Somewhere') => ({
  direction: 'out',
  kind: 'purchase',
  category,
  amount,
  merchant,
  date: '2026-08-04',
});

(async () => {
  const { groupCategories, categoryKey, groupKey, isUnplaced, unplacedNote } = await import(
    path.join(__dirname, '../../client/src/utils/statementCategories.js')
  );

  // --- what the money did ---------------------------------------------------
  const groups = groupCategories([
    out('Groceries', 100),
    out('Groceries', 50),
    out('Eating out', 30),
    { direction: 'in', kind: 'payment', category: 'Payment', amount: 9000, merchant: 'Card' },
  ]);

  check('categories come back largest first', groups.map((g) => g.category).join(' > ') === 'Groceries > Eating out',
    groups.map((g) => g.category).join(' > '));
  check('with what each came to', groups[0].total === 150, String(groups[0].total));
  check('and how many lines', groups[0].count === 2, String(groups[0].count));
  check('and what a line averages', groups[0].average === 75, String(groups[0].average));
  // A card payment is not a kind of spending, and a share of what was spent is
  // not a share of everything that moved.
  check(
    'money coming in is not a category of spending',
    groups.length === 2 && !groups.some((g) => g.category === 'Payment'),
    groups.map((g) => g.category).join(','),
  );
  check(
    'so the shares are of what went out, and add up',
    Math.abs(groups.reduce((sum, g) => sum + g.share, 0) - 100) < 0.2,
    String(groups.reduce((sum, g) => sum + g.share, 0)),
  );

  // --- the rows are kept, which is the whole point --------------------------
  check(
    'every category carries its own lines',
    groups[0].rows.length === 2 && groups[0].rows.every((r) => r.category === 'Groceries'),
    JSON.stringify(groups[0].rows.map((r) => r.amount)),
  );
  check(
    'largest first, because that is the question being asked',
    groups[0].rows[0].amount === 100,
    JSON.stringify(groups[0].rows.map((r) => r.amount)),
  );
  check(
    'and the count on the row is the number of lines behind it',
    groups.every((g) => g.count === g.rows.length),
  );

  // --- one word, one row ----------------------------------------------------
  const spelled = groupCategories([
    out('Groceries', 100),
    out('groceries', 40),
    out('  Groceries ', 10),
    out('GROCERIES', 5),
  ]);
  check('the same word spelled four ways is one category', spelled.length === 1, String(spelled.length));
  check('holding all of it', spelled[0].total === 155, String(spelled[0].total));
  // A single stray lowercase should not rename three lines of the proper one.
  check(
    'labelled with the spelling the statement used most',
    spelled[0].category === 'Groceries',
    spelled[0].category,
  );
  check(
    'and spacing is folded too',
    categoryKey('Eating  Out') === categoryKey('eating out'),
    `${categoryKey('Eating  Out')} vs ${categoryKey('eating out')}`,
  );
  // Punctuation is left alone deliberately: these are different enough words
  // that merging them would be guessing rather than tidying.
  check(
    'but two genuinely different names stay apart',
    groupCategories([out('Health & fitness', 10), out('Health and fitness', 10)]).length === 2,
  );

  // --- what the reading could not place -------------------------------------
  check('"Other" is the model admitting it could not place a line', isUnplaced('Other'));
  check('and so is the code\'s own fallback', isUnplaced('Uncategorised') && isUnplaced('uncategorized'));
  check('an ordinary category is not', !isUnplaced('Groceries'));
  const merged = groupCategories([out('Other', 100), out('Uncategorised', 50), out('Fuel', 20)]);
  check(
    'the model\'s word and the code\'s mean the same thing and share a row',
    merged.filter((g) => g.unplaced).length === 1 && merged[0].total === 150,
    JSON.stringify(merged.map((g) => [g.category, g.total])),
  );

  // Following a category out of the list has to narrow by the same rule the
  // list grouped by, or a row labelled "6 lines" opens onto three.
  check(
    'the key a row is grouped under is the same one it is found by',
    groupKey('Other') === groupKey('Uncategorised') && groupKey('Other') === merged[0].key,
    `${groupKey('Other')} / ${groupKey('Uncategorised')} / ${merged[0].key}`,
  );
  check(
    'and an ordinary category is found by its own, however it was spelled',
    groupKey('  EATING  out ') === groupKey('Eating out'),
    groupKey('  EATING  out '),
  );

  // --- when it is worth saying so -------------------------------------------
  // Displayed as though it were a spending insight, a fifth of the month in
  // "Other" reads as a kind of spending. It is not; it is the reading failing.
  const leading = unplacedNote(groupCategories([out('Other', 100), out('Fuel', 20)]));
  check('an unplaced category in first place is worth saying', leading?.leads === true, JSON.stringify(leading?.share));
  const big = unplacedNote(groupCategories([out('Fuel', 100), out('Other', 30)]));
  check('and so is a large one further down', big != null && big.leads === false, JSON.stringify(big?.share));
  const small = unplacedNote(groupCategories([out('Fuel', 1000), out('Other', 10)]));
  check('a small one is not worth interrupting for', small === null, JSON.stringify(small));
  check('and neither is none at all', unplacedNote(groupCategories([out('Fuel', 10)])) === null);

  // --- the shapes a real statement arrives in -------------------------------
  check('nothing at all groups into nothing', groupCategories([]).length === 0 && groupCategories(undefined).length === 0);
  const empty = groupCategories([out('', 10), out(null, 5)]);
  check(
    'a line with no category at all still lands somewhere',
    empty.length === 1 && empty[0].category === 'Uncategorised' && empty[0].unplaced,
    JSON.stringify(empty.map((g) => g.category)),
  );

  const { failed } = report('Grouping a statement into categories');
  process.exit(failed ? 1 : 0);
})();
