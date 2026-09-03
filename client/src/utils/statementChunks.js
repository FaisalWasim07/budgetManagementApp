// A statement is read in slices, and the reason is worth stating because it
// looks like premature optimisation and is not.
//
// The question is short and the answer is long: a hundred and fifteen
// transactions means a hundred and fifteen rows written out, several thousand
// tokens of them, which takes minutes. Nothing reaches the browser until the
// last one is done, so the request times out and the whole reading is lost —
// including the part that had already been worked out.
//
// Slices of thirty lines come back in seconds each. The wait is the same work
// but visible, and a slice that fails costs one slice.

// Lines of statement per request.
//
// Thirty was cautious to the point of being expensive. A real statement came
// back in eighteen parts, and because the instructions and the category list
// ride along with each one, the repetition came to more tokens than every
// transaction in the statement put together. The answers were tiny — about
// seven hundred tokens a slice against a ceiling of eight thousand — so the
// caution was buying nothing.
//
// Sixty halves the number of requests and so halves what is repeated, while
// still leaving an answer well short of anything that could time out.
export const LINES_PER_CHUNK = 60;

// How long a slice may be depends on how hard the model is being asked to
// think, because thinking happens before a single row is written and the host
// kills the request at sixty seconds either way. Sixty lines at low effort come
// back in seconds; the same sixty at medium never arrived at all, and the whole
// reading — every slice already paid for — went with it.
//
// So the harder the thinking, the fewer lines are asked for at a time. It costs
// more requests, and the cache makes those cheap.
export const LINES_FOR_EFFORT = { low: 60, medium: 30, high: 20 };

export const linesFor = (effort) => LINES_FOR_EFFORT[effort] ?? LINES_PER_CHUNK;

// How many are in the air at once. Enough to keep the total wait short, few
// enough not to look like a burst to anything counting requests.
export const AT_ONCE = 3;

// The first lines of a statement carry the year, the currency and the account,
// none of which are repeated further down. A slice from the middle without them
// is a column of numbers with no idea what year it is in, so they ride along
// with every slice.
//
// Where the header ends has to be found rather than assumed. Taking a fixed
// number of lines was wrong in the worst way: on a statement whose transactions
// start early it swallowed the first few, and because the header is repeated
// into every slice, those transactions then came back once per slice. Ninety
// became ninety-six, and on a real statement that is spending you did not do.
const MOST_HEADER_LINES = 12;

// A transaction line ends in an amount, or begins with a date. Either is enough
// to say the header is over; neither appears in a bank's letterhead.
const looksLikeTransaction = (line) =>
  /\d[\d,]*\.\d{2}\s*(CR)?$/i.test(line.trim()) || /^\d{1,2}[\s/-][A-Za-z]{3}/.test(line.trim());

function headerEnd(lines) {
  const first = lines.findIndex(looksLikeTransaction);
  // Nothing that looks like a transaction at all: keep a little context and let
  // the model make of it what it can.
  if (first < 0) return Math.min(4, lines.length);
  return Math.min(first, MOST_HEADER_LINES);
}

export function chunkStatement(text, linesPerChunk = LINES_PER_CHUNK) {
  const lines = text.split('\n');
  if (lines.length <= linesPerChunk) return [text];

  const start = headerEnd(lines);
  const header = lines.slice(0, start).join('\n');
  const chunks = [];

  for (let i = start; i < lines.length; i += linesPerChunk) {
    const body = lines.slice(i, i + linesPerChunk).join('\n');
    if (!body.trim()) continue;
    // The header is marked rather than pasted in silently, so the model does
    // not read it as transactions and return the account number as a purchase.
    chunks.push(`${header}\n\n--- part ${chunks.length + 1}, transactions only ---\n${body}`);
  }

  return chunks.length ? chunks : [text];
}

// How many times a slice that died on the way is asked for again. Once: a
// connection that drops twice is not going to work on the third attempt, and
// every attempt is a reading somebody pays for.
export const RETRIES = 1;

// Some failures will happen identically to every remaining slice, so trying the
// other seventeen is seventeen guaranteed failures and a long wait for them.
const HOPELESS = ['NO_API_KEY', 'BAD_API_KEY'];
const hopeless = (err) => HOPELESS.some((code) => String(err?.message).includes(code));

// Runs the slices a few at a time, reporting progress as each lands. Results
// keep their original order however they finish, because a statement read out
// of order is a statement in the wrong order.
//
// The first slice goes on its own. Everything that does not change between
// slices is cached server-side after the first request that sends it, and three
// requests leaving together would all miss that cache and all pay to write it.
// One request ahead of the rest turns eighteen full-price prefixes into one.
//
// A slice that fails does not take the others with it. It used to: one rejected
// request rejected the lot, and seventeen readings that had already arrived —
// and already been charged for — were dropped on the floor because the
// eighteenth timed out. Failures are collected and handed back instead, for the
// caller to be honest about.
export async function inBatches(items, limit, run, onProgress) {
  const results = new Array(items.length);
  const failures = [];
  let next = 0;
  let done = 0;
  let stop = null;

  const attempt = async (index) => {
    for (let tries = 0; ; tries += 1) {
      try {
        results[index] = await run(items[index], index);
        return;
      } catch (err) {
        // Nothing about this one is going to be different next time, and it
        // will be just as true of the rest.
        if (hopeless(err)) {
          stop = stop ?? err;
          failures.push({ index, error: err });
          return;
        }
        if (tries >= RETRIES) {
          failures.push({ index, error: err });
          return;
        }
      }
    }
  };

  if (items.length > 1) {
    await attempt(0);
    next = 1;
    done = 1;
    onProgress?.(done, items.length);
  }

  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length || stop) return;
      await attempt(index);
      done += 1;
      onProgress?.(done, items.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  // A cause that applies to every slice equally is the answer, not a footnote
  // on a partial reading. Reported as itself — "no API key" has to reach the
  // screen as those words, not as a statement that happened to come back empty.
  if (stop) throw stop;

  // Nothing came back at all, so there is no partial reading to be honest
  // about. The first failure is the closest thing to a reason there is.
  if (failures.length === items.length) throw failures[0].error;

  return { results, failures };
}
