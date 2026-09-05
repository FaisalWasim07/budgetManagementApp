// What a scan will cost, before it is paid for.
//
// The scanner is the one part of this app that spends money when a button is
// pressed, and it already says what a reading cost afterwards. Afterwards is
// the wrong time to learn it. This is the same figure, worked out from the
// slices about to be sent and the prices the server serves, so the button can
// carry its own price tag.
//
// It is an estimate and says so everywhere it is shown. Token counts are not
// knowable from this side — only the model's own tokeniser knows — so the
// numbers below are ratios measured against real readings of real statements.
// They are close enough to choose between a model that costs a quarter and one
// that costs a dollar, which is the decision this exists to inform, and nowhere
// near precise enough to be printed without the word "about" in front of it.

// English prose and printed transaction lines both land near four characters a
// token. Statement text is mostly names and numbers, which run slightly denser,
// so this errs on the side of over-estimating.
const CHARS_PER_TOKEN = 4;

// The instructions and the JSON schema, which ride along with every request.
// Measured from the system block the server actually sends.
const SYSTEM_TOKENS = 1200;

// One transaction as the model writes it back: two dates, the raw line, a tidy
// name, a phrase, an amount, three enums. Around sixty tokens of JSON.
const TOKENS_PER_ROW = 60;

// Writing a cache entry costs a quarter more than sending the tokens plainly;
// reading one back costs a tenth. The instructions are sent as a cacheable
// block precisely so every slice after the first is charged the tenth.
const CACHE_WRITE = 1.25;
const CACHE_READ = 0.1;

const tokensIn = (text) => Math.ceil(String(text).length / CHARS_PER_TOKEN);
const rowsIn = (text) => String(text).split('\n').filter((line) => line.trim()).length;

/**
 * Dollars, roughly, for reading `chunks` with `model`.
 *
 * `prices` is one entry from the server's own model list — the same list the
 * pickers are built from — so there is no second copy of the price of anything
 * in this browser.
 */
export function estimateScan({ chunks, prices }) {
  if (!chunks?.length || !prices) return null;

  const slices = chunks.map((chunk) => ({
    input: tokensIn(chunk),
    output: rowsIn(chunk) * TOKENS_PER_ROW,
  }));

  const text = slices.reduce((total, s) => total + s.input, 0);
  const output = slices.reduce((total, s) => total + s.output, 0);
  // The first slice writes the instructions into the cache; every one after it
  // reads them back.
  const system =
    SYSTEM_TOKENS * CACHE_WRITE + SYSTEM_TOKENS * CACHE_READ * Math.max(0, chunks.length - 1);

  return ((text + system) * prices.input + output * prices.output) / 1_000_000;
}

/**
 * A price a person can read. Cents below a dollar, because "about $0.25" reads
 * as a rounding of something larger and "about 25¢" reads as what it is;
 * dollars above, where cents stop being the unit anybody thinks in.
 */
export function describeCost(dollars) {
  if (dollars == null || Number.isNaN(dollars)) return '';
  if (dollars < 0.01) return 'less than a cent';
  if (dollars < 1) return `about ${Math.round(dollars * 100)}¢`;
  return `about $${dollars.toFixed(2)}`;
}

/**
 * What the slices in hand have actually cost — the real figure, added up from
 * what each request reported, for use while a reading is still running. The
 * estimate above is what it is checked against.
 */
export function spentSoFar(parts) {
  return (parts ?? []).reduce((total, part) => total + (part?.cost ?? 0), 0);
}
