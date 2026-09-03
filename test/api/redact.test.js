// What is taken out of a statement before it is sent to be read.
//
// Tested directly, and hard, because the failure modes point opposite ways and
// both are bad. Too timid and a card number is sent eighteen times to answer a
// question about groceries. Too eager and it eats the merchant references and
// the amounts, and the statement comes back as a column of [removed].
//
// The second is the one worth being paranoid about, so most of what follows is
// things that must survive rather than things that must go.
const path = require('path');
const { results } = require('../support/client');

const { check, report } = results();

(async () => {
  const { redact, KINDS } = await import(
    path.join(__dirname, '../../client/src/utils/statementRedact.js')
  );

  const kinds = (out) => out.found.map((f) => f.kind).sort();
  // Statements are many lines and the detail beside a result is one, so it is
  // trimmed rather than printed whole.
  const brief = (t) => t.replace(/\n/g, ' ⏎ ').slice(0, 110);

  // --- what must go --------------------------------------------------------
  const masked = redact('Card Number 4138 XXXX XXXX 1322\n03 Aug 2026 SHOP 28.00');
  check('a masked card number is taken out', !masked.text.includes('1322'), brief(masked.text));
  check('and named as what it was', kinds(masked).includes('card'), JSON.stringify(kinds(masked)));

  const full = redact('4138 1234 5678 1322\n03 Aug 2026 SHOP 28.00');
  check('so is one printed in full', !full.text.includes('5678'), brief(full.text));

  const account = redact('Current Account 04-11-887342  ·  AED\n03 Aug 2026 SHOP 28.00');
  check('an account number goes', !account.text.includes('887342'), brief(account.text));
  check('while the currency beside it stays, because the reading needs it',
    account.text.includes('AED'), brief(account.text));

  const iban = redact('IBAN AE070331234567890123456\n03 Aug 2026 SHOP 28.00');
  check('an IBAN goes whole, not in pieces', !/\d{6}/.test(iban.text), brief(iban.text));

  const contact = redact('Queries: help@bank.example or +971 4 123 4567\n03 Aug 2026 SHOP 28.00');
  check('an email address goes', !contact.text.includes('@bank.example'), brief(contact.text));
  check('and a telephone number', !contact.text.includes('123 4567'), brief(contact.text));

  // --- what must survive, which matters more -------------------------------
  const statement = [
    'Emirates Example Bank',
    'Current Account 04-11-887342  ·  AED',
    'Statement period 01 Aug 2026 to 31 Aug 2026',
    '03 Aug 2026  TAP*DUB4471 AE          28.00   12,402.00',
    '04 Aug 2026  CARREFOUR MALL          412.75  11,989.25',
    '07 Aug 2026  TLB*ORDER 88213         96.50   11,888.75',
    '15 Aug 2026  IKEA JEBEL ALI        1,450.00  29,767.35',
    '21 Aug 2026  SPOTIFY P39A2B           39.00  29,697.35',
    '24 Aug 2026  ADNOC STATION 118       180.00  29,517.35',
  ].join('\n');
  const clean = redact(statement);

  check('every amount survives',
    ['28.00', '412.75', '96.50', '1,450.00', '39.00', '180.00'].every((a) => clean.text.includes(a)),
    clean.text);
  check('and every running balance',
    ['12,402.00', '11,989.25', '29,767.35'].every((b) => clean.text.includes(b)), brief(clean.text));
  check('and every date', (clean.text.match(/Aug 2026/g) || []).length >= 6, brief(clean.text));
  // These are what the scan is for. A merchant reference is digits attached to
  // letters, which is exactly what a careless account-number rule eats.
  check('merchant references survive being digits',
    ['TAP*DUB4471', 'TLB*ORDER 88213', 'SPOTIFY P39A2B', 'ADNOC STATION 118'].every((m) =>
      clean.text.includes(m)),
    clean.text);
  check('and the account number in the header still went',
    !clean.text.includes('887342'), brief(clean.text));

  // A date is eight digits and an account number is not. That is the whole
  // distinction the digit count is making, so it is worth stating.
  const isoDates = redact('2026-08-01 SHOP 28.00\n2026-08-02 SHOP 31.00');
  check('an ISO date is not mistaken for an account number',
    isoDates.text.includes('2026-08-01') && isoDates.text.includes('2026-08-02'), brief(isoDates.text));

  const big = redact('03 Aug 2026 PROPERTY 1,250,000.00');
  check('a very large amount is not mistaken for one either',
    big.text.includes('1,250,000.00'), brief(big.text));

  // --- the letterhead ------------------------------------------------------
  check('a line of the letterhead carrying nothing the reading needs is dropped',
    !clean.text.includes('Emirates Example Bank'), brief(clean.text));
  check('and that is counted', clean.dropped === 1, String(clean.dropped));
  check('a header line carrying the year is kept',
    clean.text.includes('Statement period 01 Aug 2026'), brief(clean.text));
  check('and one carrying the currency', clean.text.includes('AED'), brief(clean.text));

  // Dropping a line below the header would be dropping money, so the thinning
  // stops where the transactions start.
  check('no transaction line is ever dropped',
    (clean.text.split('\n').filter((l) => l.includes('Aug 2026') && l.includes('.')).length) === 6,
    clean.text);

  // A letterhead with no year and no currency anywhere in it means the test is
  // wrong about this statement, not that the letterhead is empty.
  const odd = redact('SOME BANK\nYOUR STATEMENT\n03 Aug 2026 SHOP 28.00');
  check('a letterhead it cannot read is kept rather than thrown away',
    odd.text.includes('SOME BANK') && odd.text.includes('YOUR STATEMENT'), brief(odd.text));

  // --- what it says it did -------------------------------------------------
  const several = redact(
    'Card 4138 XXXX XXXX 1322\nCard 4138 XXXX XXXX 9999\nhelp@bank.example\n03 Aug 2026 S 1.00'
  );
  check('two of the same kind are counted, not listed twice',
    several.found.filter((f) => f.kind === 'card').length === 1, JSON.stringify(several.found));
  check('with how many there were',
    several.found.find((f) => f.kind === 'card').count === 2, JSON.stringify(several.found));
  check('and every kind has words to describe it',
    several.found.every((f) => f.what && KINDS[f.kind]), JSON.stringify(several.found));
  check('the total counts the dropped letterhead too',
    several.count === several.found.reduce((t, f) => t + f.count, 0) + several.dropped,
    `${several.count}`);

  const nothing = redact('03 Aug 2026 SHOP 28.00\n04 Aug 2026 SHOP 31.00');
  check('a statement with nothing to hide reports nothing hidden',
    nothing.count === 0 && nothing.found.length === 0, JSON.stringify(nothing));
  check('and comes back unchanged', nothing.text.includes('SHOP 28.00'), brief(nothing.text));

  const empty = redact('');
  check('an empty statement does not throw', empty.text === '' && empty.count === 0);

  const { failed } = report('Statement redaction');
  process.exit(failed ? 1 : 0);
})();
