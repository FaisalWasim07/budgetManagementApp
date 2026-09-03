// What gets taken out of a statement before any of it is sent to be read.
//
// The file never leaves the browser and neither does the password, but the text
// pulled out of it does, and a statement's letterhead carries things that have
// nothing to do with what was spent: a card number, an account number, an
// address. Worse, that letterhead is repeated into every slice — on a statement
// read in eighteen parts, a card number is sent eighteen times to answer a
// question about groceries.
//
// So it is taken out here, on this side, before the text is cut into slices.
// The preview shows the result rather than the original, which is the property
// that matters: what is on screen is what left the machine.
//
// Two things this is not. It is not anonymisation — where somebody shops, when,
// and how much is far more identifying than an account number, and that is the
// data the scan exists to read. And it is not a guess at names: a person's name
// looks exactly like a merchant's, so anything clever enough to catch "Faisal
// Wasim" would also eat "Carrefour". Names in the letterhead are handled by
// keeping only the lines that earn their place, further down.

// What each rule is for, in words, because the count on screen has to say what
// was hidden rather than just how much.
export const KINDS = {
  card: { one: 'a card number', many: 'card numbers' },
  iban: { one: 'an IBAN', many: 'IBANs' },
  account: { one: 'an account number', many: 'account numbers' },
  email: { one: 'an email address', many: 'email addresses' },
  phone: { one: 'a phone number', many: 'phone numbers' },
};

const MARK = '[removed]';

// Nine digits. An amount never reaches it — the longest group in 1,234,567.89
// is three, and the comma and the point end the run — and neither does a date:
// 2026-08-01 is eight. An account number does: 04-11-887342 is ten.
const ENOUGH_DIGITS = 9;

const digitsIn = (s) => (s.match(/\d/g) || []).length;

// Order matters. An IBAN ends in a long run of digits and a card number is four
// groups of four, so both would be half-eaten by the plain account rule if it
// ran first, leaving a fragment that is still identifying and no longer
// recognisable as anything.
const RULES = [
  // Two letters, two check digits, then the rest of it.
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },

  // A card number with the middle masked, which is how a statement prints it:
  // 4138 XXXX XXXX 1322. The mask is the giveaway, so this runs before the
  // rules that count digits — there are only eight here to count.
  { kind: 'card', re: /\b\d{4}[\s-]?[X*]{4}[\s-]?[X*]{4}[\s-]?\d{4}\b/gi },

  // And printed in full, in the four groups of four it is always printed in.
  { kind: 'card', re: /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g },

  { kind: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g },

  // A plus, a country code, and enough after it to be a telephone number. An
  // amount never begins with a plus.
  { kind: 'phone', re: /\+\d[\d\s-]{7,}\d/g },

  // Everything else long enough to be an account number. Grouped with dashes or
  // spaces or not at all, but counted in digits, so the shape does not matter.
  {
    kind: 'account',
    re: /\b\d[\d\s-]{7,}\d\b/g,
    unless: (match) => digitsIn(match) < ENOUGH_DIGITS,
  },
];

// A header line earns its place by carrying something the reading needs: the
// year, so a line reading "03 Aug" can be dated, and the currency. A line with
// neither is a letterhead — a name, an address, a marketing strapline — and it
// is dropped rather than sent eighteen times.
const CARRIES_A_YEAR = /\b(19|20)\d{2}\b/;
const CARRIES_A_CURRENCY = /\b(AED|USD|EUR|GBP|SAR|INR|PKR|QAR|KWD|OMR|BHD|CHF|CAD|AUD|JPY|CNY)\b/;
const worthKeeping = (line) => CARRIES_A_YEAR.test(line) || CARRIES_A_CURRENCY.test(line);

// Where the transactions start. Deliberately the same test the slicer uses, so
// the two agree about what is a header and what is money.
const looksLikeTransaction = (line) =>
  /\d[\d,]*\.\d{2}\s*(CR)?$/i.test(line.trim()) || /^\d{1,2}[\s/-][A-Za-z]{3}/.test(line.trim());

const MOST_HEADER_LINES = 12;

function headerEnd(lines) {
  const first = lines.findIndex(looksLikeTransaction);
  if (first < 0) return 0;
  return Math.min(first, MOST_HEADER_LINES);
}

// Takes the statement text and gives back what is safe to send, along with what
// was taken out of it so the screen can say so.
export function redact(text) {
  const found = new Map();
  const note = (kind) => found.set(kind, (found.get(kind) ?? 0) + 1);

  const scrub = (line) =>
    RULES.reduce(
      (soFar, rule) =>
        soFar.replace(rule.re, (match) => {
          if (rule.unless?.(match)) return match;
          note(rule.kind);
          return MARK;
        }),
      line
    );

  const lines = text.split('\n');
  const end = headerEnd(lines);

  // Only the letterhead is thinned. Below it every line is a transaction or
  // something printed among them, and dropping one of those would be dropping
  // money.
  const header = lines.slice(0, end);
  const kept = header.filter(worthKeeping);
  const dropped = kept.length ? header.length - kept.length : 0;
  // Nothing in the letterhead looked like a date or a currency, which means the
  // test is wrong about this statement rather than that the letterhead is
  // empty. Keep it, scrubbed, rather than throwing away the year.
  const head = kept.length ? kept : header;

  return {
    text: [...head, ...lines.slice(end)].map(scrub).join('\n'),
    // What was hidden, as pairs of kind and count, largest first.
    // Worded here rather than on screen, so the counting and the plural stay
    // together: "a card number" reads as one thing, "2 card numbers" as two.
    found: [...found.entries()]
      .map(([kind, count]) => ({
        kind,
        count,
        what: count === 1 ? KINDS[kind].one : `${count} ${KINDS[kind].many}`,
      }))
      .sort((a, b) => b.count - a.count),
    dropped,
    count: [...found.values()].reduce((t, n) => t + n, 0) + dropped,
  };
}
