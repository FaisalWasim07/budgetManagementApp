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

// Runs the slices a few at a time, reporting progress as each lands. Results
// keep their original order however they finish, because a statement read out
// of order is a statement in the wrong order.
//
// The first slice goes on its own. Everything that does not change between
// slices is cached server-side after the first request that sends it, and three
// requests leaving together would all miss that cache and all pay to write it.
// One request ahead of the rest turns eighteen full-price prefixes into one.
export async function inBatches(items, limit, run, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;

  if (items.length > 1) {
    results[0] = await run(items[0], 0);
    next = 1;
    done = 1;
    onProgress?.(done, items.length);
  }

  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index], index);
      done += 1;
      onProgress?.(done, items.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
