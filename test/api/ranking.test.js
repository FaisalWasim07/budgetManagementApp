// The order the findings are read in.
//
// The arithmetic that produces them is tested next door, in findings.test.js;
// this is only about which of them goes first, which is a different question
// and used to have no answer at all. The report showed four headed sections in
// whatever order the code computed them, so a doubled seventeen-hundred dirham
// charge sat third, under a heading, below two subscriptions of forty.
//
// The rule is "what is at stake", and it is worth pinning down because it is
// not the same figure for every kind: a duplicate risks the extra charge, not
// the pair; an unusually large line risks the part above what is normal, not
// the whole line.
const path = require('path');
const { results } = require('../support/client');

const { check, report } = results();

(async () => {
  const { rank, KIND_LABELS } = await import(
    path.join(__dirname, '../../client/src/utils/statementRanking.js')
  );

  check('nothing found is an empty list, not a crash', rank(null).length === 0 && rank({}).length === 0);

  // --- what each kind puts at stake ---------------------------------------
  const one = (findings) => rank(findings)[0];

  const dupe = one({
    duplicates: [{ date: '2026-08-11', merchant: 'Abu Dhabi Service', amount: 1702.96, times: 2, total: 3405.92 }],
  });
  check(
    'a duplicate risks the extra charge, not both of them',
    dupe.atStake === 1702.96,
    String(dupe.atStake),
  );

  const thrice = one({
    duplicates: [{ date: '2026-08-11', merchant: 'Toll', amount: 4, times: 3, total: 12 }],
  });
  check('and three of the same line risk two of them', thrice.atStake === 8, String(thrice.atStake));

  const outlier = one({
    outliers: [{ date: '2026-08-02', merchant: 'Carrefour', category: 'Groceries', amount: 900, typical: 120 }],
  });
  check(
    'an unusually large line risks what it is above typical, not the whole line',
    outlier.atStake === 780,
    String(outlier.atStake),
  );

  const cycle = one({ repeats: [{ merchant: 'Netflix', amount: 56, times: 3, total: 168 }] });
  check(
    'a charge on a cycle is weighed by what the cycle took',
    cycle.atStake === 168,
    String(cycle.atStake),
  );

  const habit = one({ frequent: [{ merchant: 'Tap Coffee', times: 7, total: 196, average: 28 }] });
  check('and a habit by what it came to', habit.atStake === 196, String(habit.atStake));

  // --- the order ----------------------------------------------------------
  const mixed = rank({
    duplicates: [{ date: '2026-08-11', merchant: 'Service', amount: 1702.96, times: 2, total: 3405.92 }],
    repeats: [{ merchant: 'Netflix', amount: 56, times: 2, total: 112 }],
    outliers: [{ date: '2026-08-02', merchant: 'Carrefour', category: 'Groceries', amount: 900, typical: 120 }],
    frequent: [{ merchant: 'Tap Coffee', times: 7, total: 196, average: 28 }],
  });
  check(
    'the largest thing at stake is read first, whatever kind it is',
    mixed.map((f) => f.merchant).join(' > ') === 'Service > Carrefour > Tap Coffee > Netflix',
    mixed.map((f) => `${f.merchant} ${f.atStake}`).join(' | '),
  );
  check('and nothing is dropped on the way', mixed.length === 4, String(mixed.length));
  check(
    'every row says what sort of finding it is',
    mixed.every((f) => f.label === KIND_LABELS[f.kind]),
    JSON.stringify(mixed.map((f) => [f.kind, f.label])),
  );
  check(
    'and carries the numbers the finding came with',
    mixed[0].amount === 1702.96 && mixed[0].date === '2026-08-11',
    JSON.stringify(mixed[0]),
  );

  // Same money at stake, so the tie is broken by what can be acted on today: a
  // charge that may have gone through twice is a phone call, a habit is not.
  const tied = rank({
    duplicates: [{ date: '2026-08-01', merchant: 'Zed', amount: 100, times: 2, total: 200 }],
    frequent: [{ merchant: 'Aaa', times: 5, total: 100, average: 20 }],
  });
  check(
    'where the money is equal the more actionable finding goes first',
    tied[0].kind === 'duplicates',
    tied.map((f) => f.kind).join(','),
  );

  // A repeat whose total is somehow below its own amount, or an outlier under
  // its category's typical, would sort negative and float to the bottom in a
  // way nobody could explain. Nothing at stake is nothing, not less than none.
  const odd = one({ outliers: [{ merchant: 'Odd', category: 'X', amount: 10, typical: 40 }] });
  check('a finding with nothing at stake is not ranked below zero', odd.atStake === 0, String(odd.atStake));

  const { failed } = report('Finding order');
  process.exit(failed ? 1 : 0);
})();
