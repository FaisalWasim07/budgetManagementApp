const Anthropic = require('@anthropic-ai/sdk');

// Reading a statement, and only reading it. Nothing here writes a row: the
// result goes back in the response and is gone when the tab closes.
//
// The division of labour is the whole design, and it is deliberate. The model
// reads, identifies and categorises; it is never asked to add anything up.
// Every total, share and comparison the app shows is computed from these rows
// in code. A confidently wrong figure in a budget looks exactly like a right
// one, and is acted on — so the model is allowed to be wrong about *what*
// something is, which is visible and correctable, and never about *how much*.

const MODEL = 'claude-opus-5';

// One request carries about thirty lines, so the answer is about thirty rows —
// a few thousand tokens. This is a ceiling on a runaway, not a target: it was
// 32,000 when a request carried a whole statement, and left far too much room
// for one to generate its way through several dollars before anything stopped
// it.
const MAX_TOKENS = 8000;

// Reading a statement is transcription. The lines are already there, in order,
// with the amounts printed on them; what is being asked for is to write them
// out as rows and name what each merchant is.
//
// Opus thinks by default, at high effort, and thinking bills as output. On a
// task with nothing to reason about that is money spent producing deliberation
// nobody reads — and it was the single largest thing wrong with what a scan
// cost. Low effort is the right setting for work of this shape, and it is
// faster for the same reason.
const EFFORT = 'low';

// One row per line on the statement. `strict` schema-valid output, so what
// comes back is checked before this code ever sees it — no parsing prose, no
// half-written JSON to repair.
const ROW_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'The date on the statement line, as YYYY-MM-DD.',
          },
          raw: {
            type: 'string',
            description: 'The description exactly as printed, unchanged.',
          },
          merchant: {
            type: 'string',
            description: 'The same thing tidied into a readable name.',
          },
          what: {
            type: 'string',
            description:
              'What this is, in a short plain phrase a person would use — "a coffee shop", ' +
              '"a supermarket", "a road toll". Not a sentence, not a category.',
          },
          amount: {
            type: 'number',
            description: 'Always positive. Direction carries the sign.',
          },
          direction: { type: 'string', enum: ['in', 'out'] },
          kind: {
            type: 'string',
            enum: ['purchase', 'payment', 'refund', 'cashback', 'income', 'fee', 'other'],
            description:
              'What sort of movement this is. On a card statement "payment" is you paying the ' +
              'card off — money leaving your current account, not money you received. ' +
              '"cashback" and "refund" are money back from a purchase. "income" is a salary or ' +
              'similar arriving in a bank account.',
          },
          category: { type: 'string' },
          confidence: {
            type: 'string',
            enum: ['high', 'low'],
            description: 'low when the line is too cryptic to place with any confidence.',
          },
        },
        required: [
          'date', 'raw', 'merchant', 'what', 'amount', 'direction', 'kind', 'category', 'confidence',
        ],
        additionalProperties: false,
      },
    },
    // The bank's own figures, so the reading can be checked against them rather
    // than trusted. Null wherever the document does not print one — a plain
    // transaction list often prints none of them.
    statement: {
      type: 'object',
      properties: {
        openingBalance: { type: ['number', 'null'] },
        closingBalance: { type: ['number', 'null'] },
        periodStart: { type: ['string', 'null'] },
        periodEnd: { type: ['string', 'null'] },
      },
      required: ['openingBalance', 'closingBalance', 'periodStart', 'periodEnd'],
      additionalProperties: false,
    },
  },
  required: ['rows', 'statement'],
  additionalProperties: false,
};

const SYSTEM = [
  'You read bank statements and turn them into rows. You are careful and literal.',
  '',
  'Rules that matter more than being helpful:',
  '',
  '- Copy every amount exactly as printed. Never round, convert, or tidy a figure.',
  '- Do not total anything, and do not add a summary row. Sums are computed elsewhere.',
  '- Never invent a line. If the text is unclear, return what is there and mark it low confidence.',
  '- Skip anything that is not a transaction: opening and closing balances, page headers,',
  '  column titles, carried-forward lines, and marketing footers are not rows.',
  '- `raw` is the description exactly as printed. It is what makes your reading checkable,',
  '  so it must never be cleaned up, expanded or corrected.',
  '- `direction` is "out" for money leaving the account and "in" for money arriving.',
  '  A credit, refund, salary or transfer in is "in".',
  '- `what` says what the merchant is, not what the transaction was: "a supermarket",',
  '  not "groceries were bought". Three or four words at most.',
  '- Mark `confidence` low whenever you are guessing at the merchant or the category.',
  '  A guess admitted is useful; a guess presented as fact is not.',
  '',
  'On a card statement `kind` is easy to get wrong and matters. A line reading',
  '"TRANSFER PAYMENT RECEIVED" is the cardholder paying the card off: a credit to the',
  'card, and not money they received. It is "payment", never "income". Cashback and',
  'refunds are money coming back from a purchase, not earnings either.',
  '',
  'Copy the opening and closing balances into `statement` exactly as printed, along with',
  'the period covered. They are used to check that your reading adds up. Where the',
  'document does not print one, answer null rather than working it out — a figure you',
  'derived cannot check the rows you derived it from.',
].join('\n');

function prompt({ text, categories, currency }) {
  const known = categories.length
    ? [
        'Categories already used in this household. Prefer one of these where it fits, so',
        'the two halves of the app speak the same language. Invent a new one only when',
        'nothing here is close:',
        '',
        categories.map((c) => `  ${c}`).join('\n'),
        '',
      ].join('\n')
    : 'This household has no categories yet, so choose plain, obvious ones.\n';

  return [
    known,
    currency ? `Amounts on this statement are in ${currency}.\n` : '',
    'Here is the statement, as text pulled out of the file:',
    '',
    text,
  ].join('\n');
}

// Thrown where the cause is a missing or refused key rather than a bad
// statement, so the route can say which without leaking the difference to
// anybody who has not signed in.
class StatementScanError extends Error {
  constructor(message, code, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new StatementScanError(
      'Reading statements needs an Anthropic API key. Set ANTHROPIC_API_KEY and redeploy.',
      'NO_API_KEY',
      503
    );
  }
  return new Anthropic();
}

// Rows come back schema-valid, which is not the same as sensible: a model can
// still hand over a negative amount or a date it has reformatted. This is the
// last place before the screen, so the checking happens here rather than in
// three components downstream.
function clean(rows) {
  return rows
    .map((row) => ({
      ...row,
      amount: Math.abs(Number(row.amount)),
      date: String(row.date).slice(0, 10),
      raw: String(row.raw),
      merchant: String(row.merchant).trim() || String(row.raw),
      what: String(row.what).trim(),
      kind: row.kind || 'other',
      category: String(row.category).trim() || 'Uncategorised',
    }))
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0);
}

async function scan({ text, categories = [], currency = null }) {
  const anthropic = client();

  let message;
  try {
    // Streamed because the response is long and a non-streaming request of this
    // size runs into the SDK's HTTP timeout before the model has finished.
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt({ text, categories, currency }) }],
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: ROW_SCHEMA } },
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new StatementScanError('That Anthropic API key was refused.', 'BAD_API_KEY', 503);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new StatementScanError('Too many requests just now. Try again shortly.', 'RATE_LIMITED', 429);
    }
    throw new StatementScanError(`Reading the statement failed: ${err.message}`, 'SCAN_FAILED');
  }

  // A refusal comes back as a normal 200 with nothing useful in it, so it is
  // checked before the content is read rather than after it fails to parse.
  if (message.stop_reason === 'refusal') {
    throw new StatementScanError('That file was declined as a statement.', 'DECLINED', 422);
  }

  const body = message.content.find((block) => block.type === 'text')?.text;
  if (!body) throw new StatementScanError('Nothing came back to read.', 'EMPTY', 502);

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new StatementScanError('What came back was not readable.', 'BAD_SHAPE', 502);
  }

  return {
    statement: parsed.statement ?? null,
    rows: clean(Array.isArray(parsed.rows) ? parsed.rows : []),
    usage: {
      input: message.usage?.input_tokens ?? null,
      output: message.usage?.output_tokens ?? null,
    },
  };
}

module.exports = { scan, StatementScanError, ROW_SCHEMA, MODEL };
