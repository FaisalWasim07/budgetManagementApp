// How a statement is cut up before it is sent.
//
// This had a bug that cost the report its headline answer, and it is the kind
// only a test can hold shut, because nothing about it looks wrong: every figure
// on the report was right except the one somebody opened the statement to find.
//
// A card statement prints a summary box above the table —
//
//   Previous Balance      10,117.51
//   Total Amount Due       9,496.06
//
// — and the header used to be cut at the first line ending in an amount. That
// is the first line of the summary box. So the balances fell out of the header
// and into the body, under a heading reading "transactions only", where a model
// doing as it is told skips them. The bill was never sent as a bill.
const path = require('path');
const { results } = require('../support/client');

const { check, report } = results();

const HEADER = [
  'EMIRATES ISLAMIC BANK',
  'Card Number 4444 XXXX XXXX 3456',
  'Statement date 30 Aug 2026',
  '',
  'Previous Balance                 10,117.51',
  'Payments and Credits             10,678.51',
  'Purchases                        10,057.06',
  'Total Amount Due                  9,496.06',
  '',
  'Date        Description               Amount',
];
const FOOTER = ['', 'Closing Balance                   9,496.06', 'Minimum Due 500.00 by 25 Sep 2026'];
const txn = (n) => `0${(n % 9) + 1} Aug 2026 MERCHANT ${n} AE           ${(n + 1) * 11}.50`;

(async () => {
  const { chunkStatement } = await import(
    path.join(__dirname, '../../client/src/utils/statementChunks.js')
  );

  const lines = [...HEADER, ...Array.from({ length: 130 }, (_, i) => txn(i)), ...FOOTER];
  const chunks = chunkStatement(lines.join('\n'), 60);

  check('a long statement is cut into parts', chunks.length > 1, `${chunks.length} parts`);

  // --- the bill reaches the model, as a balance ---------------------------
  check(
    'every part carries the balances the bank printed at the top',
    chunks.every((c) => c.includes('Total Amount Due') && c.includes('10,117.51')),
    chunks.map((c) => c.includes('Total Amount Due')).join(','),
  );
  check(
    'and carries them above the line that says the rest is transactions',
    chunks.every((c) => c.indexOf('Total Amount Due') < c.indexOf('transactions only')),
  );
  // The whole bug: the summary box ends in amounts, so it read as the first
  // transaction and the header was cut above it.
  check(
    'the summary box is not mistaken for the first transaction',
    !chunks[0].includes('--- part 1, transactions only ---\nPrevious Balance'),
    chunks[0].slice(0, 160).replace(/\n/g, ' | '),
  );

  // --- what the bank prints underneath ------------------------------------
  check(
    'the summary under the table is carried too, for statements that only print it there',
    chunks[0].includes('Closing Balance') && chunks[0].includes('statement summary'),
    chunks[0].slice(-160).replace(/\n/g, ' | '),
  );
  check(
    'and is left off the part that already reaches it, rather than repeated to itself',
    !chunks[chunks.length - 1].includes('--- statement summary'),
    chunks[chunks.length - 1].slice(-120).replace(/\n/g, ' | '),
  );

  // --- and no transaction is duplicated by any of it -----------------------
  // The failure this guards against is the worst one available here: a line
  // repeated into every part comes back once per part, and that is spending
  // somebody did not do.
  const body = chunks
    .map((c) => c.split('--- part')[1] ?? '')
    .join('\n');
  const seen = body.split('\n').filter((l) => /^0\d Aug 2026 MERCHANT/.test(l.trim()));
  check(
    'every transaction appears exactly once across the parts',
    seen.length === 130 && new Set(seen.map((l) => l.trim())).size === 130,
    `${seen.length} lines, ${new Set(seen.map((l) => l.trim())).size} distinct`,
  );

  // --- statements that print no dates at the start of a line --------------
  const undated = [
    'SOME BANK',
    'Account summary',
    'Opening balance 500.00',
    'COFFEE SHOP                    12.00',
    'SUPERMARKET                   140.00',
  ];
  const loose = chunkStatement(undated.join('\n'), 2);
  check(
    'a statement with no dates still gets cut rather than refused',
    loose.length >= 1,
    `${loose.length} parts`,
  );

  // A statement short enough to send whole is sent whole.
  const short = chunkStatement([...HEADER, txn(1), txn(2)].join('\n'), 60);
  check('a short statement is one part, untouched', short.length === 1 && short[0].includes('Total Amount Due'));

  const { failed } = report('Cutting a statement up');
  process.exit(failed ? 1 : 0);
})();
