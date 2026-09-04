// The rows as a file — the first thing a scan lets out of the browser.
//
// Two things are worth being exact about, and neither is the comma. The first
// is that a spreadsheet executes a cell beginning with = + - or @, and a bank
// statement is full of merchant names nobody wrote with that in mind. The
// second is that an amount without a sign is a column that adds up to nonsense
// in whatever the person builds on top of it.
const path = require('path');
const { results } = require('../support/client');

const { check, report } = results();

const ROW = {
  date: '2026-08-04',
  postDate: null,
  merchant: 'Carrefour',
  what: 'a supermarket',
  category: 'Groceries',
  direction: 'out',
  amount: 72.5,
  confidence: 'high',
  raw: 'CARREFOUR HYPER DUBAI',
};

(async () => {
  const { toCsv, csvName } = await import(
    path.join(__dirname, '../../client/src/utils/statementCsv.js')
  );

  const lines = toCsv([ROW], 'AED').trim().split('\r\n');
  check('the first line names the columns', lines[0].includes('"Merchant"'), lines[0]);
  check('one row in, one row out', lines.length === 2, String(lines.length));
  check('the line as the bank printed it goes with it', lines[1].includes('CARREFOUR HYPER DUBAI'), lines[1]);
  check('and the currency it was read in', lines[1].includes('"AED"'), lines[1]);

  // --- money keeps its direction ------------------------------------------
  const out = toCsv([ROW], 'AED');
  check('money leaving the account is negative', out.includes(',-72.5,'), out.split('\r\n')[1]);
  const inn = toCsv([{ ...ROW, direction: 'in', amount: 200 }], 'AED');
  check('and money arriving is not', inn.includes(',200,'), inn.split('\r\n')[1]);
  // The formula guard sees a leading minus and cannot tell an amount from a
  // merchant. Prefixing it made every debit text, and a column of text does
  // not add up in whatever the person builds on this.
  check(
    'and neither is quoted into being text a spreadsheet will not total',
    !out.includes("'-72.5") && !out.includes('"-72.5"'),
    out.split('\r\n')[1],
  );

  // --- what must not break the file ---------------------------------------
  const comma = toCsv([{ ...ROW, merchant: 'Spinneys, Marina' }], 'AED').trim().split('\r\n');
  check(
    'a merchant with a comma in it is still one field',
    comma[1].includes('"Spinneys, Marina"'),
    comma[1],
  );
  const quoted = toCsv([{ ...ROW, merchant: 'The "Good" Cafe' }], 'AED');
  check('a quote is doubled rather than ending the field', quoted.includes('"The ""Good"" Cafe"'), quoted);

  // --- what must not run --------------------------------------------------
  // Quoting does not stop this; a leading apostrophe does, and reads as itself
  // in every spreadsheet worth naming.
  for (const start of ['=', '+', '-', '@']) {
    const risky = toCsv([{ ...ROW, merchant: `${start}HYPERLINK("http://x")` }], 'AED');
    check(
      `a merchant beginning with ${start} is not handed to a spreadsheet as a formula`,
      risky.includes(`"'${start}HYPERLINK`),
      risky.split('\r\n')[1],
    );
  }
  check(
    'and an ordinary name is left exactly as it is',
    toCsv([ROW], 'AED').includes('"Carrefour"'),
  );

  // --- the name on the file -----------------------------------------------
  check(
    'the file is named after the period it covers',
    csvName({ from: '2026-08-01', to: '2026-08-31' }) === 'statement-2026-08-01-to-2026-08-31.csv',
    csvName({ from: '2026-08-01', to: '2026-08-31' }),
  );
  check(
    'a single day says so once rather than twice',
    csvName({ from: '2026-08-01', to: '2026-08-01' }) === 'statement-2026-08-01.csv',
    csvName({ from: '2026-08-01', to: '2026-08-01' }),
  );
  check('and a statement with no dates on it still gets a name',
    csvName(null) === 'statement.csv', csvName(null));

  const { failed } = report('The rows as a file');
  process.exit(failed ? 1 : 0);
})();
