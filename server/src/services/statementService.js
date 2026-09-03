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

// What a statement may be read with, and what each costs per million tokens.
// The list lives here rather than in the browser so a request cannot name a
// model nobody chose — anything arriving from a client is a suggestion, and an
// unrecognised one falls back rather than being passed on to the API.
//
// `effort` is not universal. It is rejected outright by Haiku 4.5, so the flag
// is a capability rather than a preference: sending it there fails the request.
const MODELS = {
  'claude-opus-5': {
    label: 'Opus 5',
    note: 'The most careful reader, and the dearest.',
    input: 5,
    output: 25,
    effort: true,
  },
  'claude-sonnet-5': {
    label: 'Sonnet 5',
    note: 'Less than half the price, and quick.',
    input: 2,
    output: 10,
    effort: true,
  },
  'claude-haiku-4-5': {
    label: 'Haiku 4.5',
    note: 'A fifth of Opus. Reading a statement is mostly transcription.',
    input: 1,
    output: 5,
    effort: false,
  },
};

const DEFAULT_MODEL = 'claude-opus-5';

// Anything above high is for problems with something to reason about, which
// reading a printed list of transactions is not.
const EFFORTS = ['low', 'medium', 'high'];

// Cached input is billed at roughly a tenth, which is the whole reason the
// instructions are sent as a cacheable block.
const CACHE_DISCOUNT = 0.1;

// What the browser needs to offer a choice, without it holding the prices.
const choices = () => ({
  models: Object.entries(MODELS).map(([id, m]) => ({
    id,
    label: m.label,
    note: m.note,
    input: m.input,
    output: m.output,
    effort: m.effort,
  })),
  efforts: EFFORTS,
  defaultModel: DEFAULT_MODEL,
  defaultEffort: 'low',
});

const modelFor = (asked) => (MODELS[asked] ? asked : DEFAULT_MODEL);

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
const DEFAULT_EFFORT = 'low';

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
          category: {
            type: 'string',
            description:
              'A plain, obvious spending category — Groceries, Eating out, Fuel, Utilities. ' +
              'Choose the ordinary word for it rather than anything clever.',
          },
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

// Everything that does not change between slices lives here, and nothing that
// does. That split is the whole point: a statement read in eighteen parts sent
// the instructions eighteen times, which came to more tokens than every
// transaction in the statement put together.
//
// It used to carry the household's own category names too, so the scanner would
// use the same words as the rest of the app. That is gone: a statement is read
// on its own, and the household's ledger — including what it calls things — is
// not sent anywhere to do it.
//
// Marked for caching, so the second slice onwards reads this back at a tenth of
// the price instead of paying for it again. The slice itself is the only thing
// in the user message, and it goes last, because a cached prefix ends at the
// first byte that differs.
function systemFor({ currency }) {
  return [
    {
      type: 'text',
      text: [
        SYSTEM,
        '',
        currency ? `Amounts on this statement are in ${currency}.` : '',
      ].join('\n'),
      cache_control: { type: 'ephemeral' },
    },
  ];
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

async function scan({ text, currency = null, model: asked, effort: askedEffort }) {
  const anthropic = client();
  const model = modelFor(asked);
  const spec = MODELS[model];
  const effort = EFFORTS.includes(askedEffort) ? askedEffort : DEFAULT_EFFORT;

  let message;
  try {
    // Streamed because the response is long and a non-streaming request of this
    // size runs into the SDK's HTTP timeout before the model has finished.
    const stream = anthropic.messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      system: systemFor({ currency }),
      messages: [{ role: 'user', content: text }],
      // Effort only where the model takes one. Haiku rejects the field rather
      // than ignoring it, so this is not a nicety.
      output_config: spec.effort
        ? { effort, format: { type: 'json_schema', schema: ROW_SCHEMA } }
        : { format: { type: 'json_schema', schema: ROW_SCHEMA } },
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
      input: message.usage?.input_tokens ?? 0,
      output: message.usage?.output_tokens ?? 0,
      // Reported separately so it is possible to tell whether caching is
      // actually working. Zero across every slice means the prefix is shorter
      // than the model's minimum and nothing is being cached at all.
      cacheRead: message.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

// What a run cost, worked out here because the prices are here. The browser is
// told a number of dirhams, not a price list it could get wrong or go stale on.
// The three input buckets are separate, and that is the whole subtlety here.
// `input_tokens` counts only what was sent uncached — it does not include the
// tokens read back from cache or the ones written to it, so the total input is
// the three added together, never one carved out of another.
//
// This was wrong, and wrong in the direction that flatters: subtracting the
// cached tokens from the input drove the fresh count to zero on every slice
// after the first, and the price of the statement text itself was quietly not
// charged for. A scan reported at twenty cents had cost twenty-five.
function priceOf({ model, usage }) {
  const spec = MODELS[model] || MODELS[DEFAULT_MODEL];
  const fresh = usage.input || 0;
  const cached = usage.cacheRead || 0;
  const written = usage.cacheWrite || 0;
  // Writing a cache entry costs a quarter more than sending the tokens plainly;
  // reading one back costs a tenth.
  const dollars =
    ((fresh + written * 1.25 + cached * CACHE_DISCOUNT) * spec.input +
      (usage.output || 0) * spec.output) /
    1_000_000;
  return dollars;
}

module.exports = {
  scan,
  choices,
  modelFor,
  priceOf,
  StatementScanError,
  ROW_SCHEMA,
  MODELS,
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
  EFFORTS,
};
