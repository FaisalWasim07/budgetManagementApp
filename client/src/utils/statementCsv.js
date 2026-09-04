// The rows, as a file.
//
// This is the first thing a scan lets out of the browser, and it is worth being
// exact about what that means: the file is built here, from what is already on
// screen, and handed to the browser's own download. Nothing is uploaded, no
// server sees it, and the scanner still stores nothing — the statement is gone
// when the dialog closes, whether or not a copy was saved first.

// A cell beginning with one of these is executed as a formula when the file is
// opened in a spreadsheet, and a bank statement is full of merchant names
// nobody wrote with that in mind. Quoting does not stop it; a leading
// apostrophe does, and reads as itself in every reader that matters.
const RISKY = /^[=+\-@\t\r]/;

function cell(value) {
  // A number is written plainly, unquoted and unescaped. It has to be: the
  // guard below sees a leading minus and cannot tell a negative amount from a
  // merchant called "-DUBAI", so quoting one and prefixing it turned every
  // amount that left the account into text a spreadsheet would not add up.
  // Only what a person wrote goes through the escape.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);

  const text = value == null ? '' : String(value);
  const safe = RISKY.test(text) ? `'${text}` : text;
  // Doubling the quotes is the escape CSV has; wrapping every field means a
  // merchant with a comma in it needs no special case.
  return `"${safe.replace(/"/g, '""')}"`;
}

export const CSV_COLUMNS = [
  ['Date', (r) => r.date],
  ['Posted', (r) => r.postDate ?? ''],
  ['Merchant', (r) => r.merchant],
  ['What', (r) => r.what],
  ['Category', (r) => r.category],
  ['Direction', (r) => (r.direction === 'in' ? 'in' : 'out')],
  // Signed, because a column of positive numbers with the direction in the
  // next column adds up to nonsense in every spreadsheet anybody builds on it.
  ['Amount', (r) => (r.direction === 'in' ? r.amount : -r.amount)],
  ['Currency', (r, currency) => currency ?? ''],
  ['Confidence', (r) => r.confidence ?? ''],
  // The line as the bank printed it, so a reading can still be checked against
  // the statement after it has left the app.
  ['As printed', (r) => r.raw],
];

export function toCsv(rows, currency) {
  const lines = [CSV_COLUMNS.map(([head]) => cell(head)).join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map(([, read]) => cell(read(row, currency))).join(','));
  }
  // A trailing newline: some readers drop the last row without one.
  return `${lines.join('\r\n')}\r\n`;
}

// Named after what it is, so a folder of these can be told apart a month later.
export function csvName(overview) {
  const from = overview?.from;
  const to = overview?.to;
  if (from && to && from !== to) return `statement-${from}-to-${to}.csv`;
  if (from) return `statement-${from}.csv`;
  return 'statement.csv';
}
