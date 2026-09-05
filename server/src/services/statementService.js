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
    note: 'The most careful reader, and the dearest. Worth trying on a statement that came back wrong.',
    input: 5,
    output: 25,
    effort: true,
  },
  'claude-sonnet-5': {
    label: 'Sonnet 5',
    note: 'The usual choice. On a real statement it read exactly the figures Opus did, for about a quarter of the price.',
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

// Sonnet, not Opus, and on evidence rather than on price alone: read against
// the same August statement, at low effort, Sonnet produced figures identical
// to Opus 5's — every row, every date, the same closing balance — at roughly a
// quarter of the cost. Paying four times as much for the same answer is not
// carefulness. Opus is still on the list, one click away, for the statement
// that comes back looking wrong.
const DEFAULT_MODEL = 'claude-sonnet-5';

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
            description:
              'The TRANSACTION date on the statement line, as YYYY-MM-DD — the day the ' +
              'thing actually happened. This is the column marked "Transaction date", ' +
              '"Trans date" or "Date of transaction". When the statement prints only one ' +
              'date per line, that one goes here.',
          },
          postDate: {
            type: ['string', 'null'],
            description:
              'The POSTING date on the same line, as YYYY-MM-DD — the day the bank ' +
              'settled or charged it. This is a separate column, often labelled "Posting ' +
              'date" or "Post date", and it sits a day or two after the transaction date. ' +
              'It can even land in a different month at the edges of the statement. ' +
              'Null when the statement prints only one date column, because then the two ' +
              'are the same fact and this would be a copy of `date`.',
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
          'date',
          'postDate',
          'raw',
          'merchant',
          'what',
          'amount',
          'direction',
          'kind',
          'category',
          'confidence',
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
        openingBalance: {
          type: ['number', 'null'],
          description:
            'What the account or card stood at before these transactions. On a card statement ' +
            'this is printed in the summary box as "Previous Balance", "Opening Balance" or ' +
            '"Balance brought forward". Copy the figure exactly.',
        },
        closingBalance: {
          type: ['number', 'null'],
          description:
            'What is owed or held at the end of this statement — the single figure the ' +
            'cardholder is being asked to pay. Banks print it under a variety of names: ' +
            '"Total Amount Due", "Closing Balance", "New Balance", "Statement Balance", ' +
            '"Total Outstanding". It appears in the summary box above the transactions, ' +
            'below the table, or both. Copy the figure exactly.',
        },
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
  '- Bank statements often print TWO dates per transaction — a transaction date (when the',
  '  purchase actually happened) and a posting date (when the bank settled it, often a day',
  '  or two later). `date` is always the transaction date; `postDate` is the posting date,',
  '  or null when the statement prints only one date column. Do not merge them, and do not',
  '  put the posting date into `date` because it looks tidier — the transaction date is',
  '  what a person remembers, and the two can straddle a month boundary.',
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
  '',
  'Those balances are not in the transaction list. They are in the summary the bank',
  'prints above the table, below it, or both, and they are the most important thing on',
  'the page: the closing balance is the one figure the cardholder opened the statement',
  'to find. It goes by many names — "Total Amount Due", "Closing Balance", "New',
  'Balance", "Statement Balance", "Total Outstanding" — and the opening one by',
  '"Previous Balance" or "Balance brought forward". Sections marked as a header or as a',
  'statement summary are there to be read for exactly this; only the part marked',
  'transactions is the list of rows. Read the balances even when a section says it is',
  'not transactions — that marking means "do not make rows of this", not "ignore it".',
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
      text: [SYSTEM, '', currency ? `Amounts on this statement are in ${currency}.` : ''].join(
        '\n',
      ),
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
      503,
    );
  }
  return new Anthropic();
}

// Rows come back schema-valid, which is not the same as sensible: a model can
// still hand over a negative amount or a date it has reformatted. This is the
// last place before the screen, so the checking happens here rather than in
// three components downstream.
function clean(rows) {
  // Both dates are strings the model wrote out and could still get wrong (a
  // year with two digits, a stray time zone). Trimmed to their first ten
  // characters, which is the YYYY-MM-DD prefix and nothing else. `postDate`
  // is nulled where the model handed the same value as `date` — the model is
  // supposed to leave it null when the statement prints one date column, but
  // sometimes echoes it instead, which is the same fact twice on the screen.
  return rows
    .map((row) => {
      const date = String(row.date).slice(0, 10);
      const postRaw = row.postDate == null ? null : String(row.postDate).slice(0, 10);
      const postDate = postRaw && postRaw !== date ? postRaw : null;
      return {
        ...row,
        amount: Math.abs(Number(row.amount)),
        date,
        postDate,
        raw: String(row.raw),
        merchant: String(row.merchant).trim() || String(row.raw),
        what: String(row.what).trim(),
        kind: row.kind || 'other',
        category: String(row.category).trim() || 'Uncategorised',
      };
    })
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
      throw new StatementScanError(
        'Too many requests just now. Try again shortly.',
        'RATE_LIMITED',
        429,
      );
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

// --- the written summary --------------------------------------------------

// The second thing a model is asked for, and a much smaller thing than the
// first. Reading is transcription over a whole statement; this is a paragraph
// over the figures that reading produced — a few hundred tokens in, a few
// hundred out, which is why it costs a cent or two rather than a dollar.
//
// It is behind a button rather than automatic for exactly that reason: most
// scans are opened to check one line, and charging for prose nobody asked to
// read is how a feature that costs money loses its welcome.
const SUMMARY_MAX_TOKENS = 700;

// The model is handed figures, never rows, and never anything it could add up
// differently from the app. Same division of labour as the reading: it is
// allowed to be wrong about what a month *means*, which is visible and
// arguable, and is given no opportunity to be wrong about what it *cost*.
//
// And the same seclusion: everything below comes out of the one statement in
// front of it. No subscriptions, no categories the household uses, no history.
const SUMMARY_SYSTEM = [
  'You are given the figures already worked out from one bank statement, and you write the',
  'short paragraph that explains them to the person who owns it. Three to five sentences.',
  '',
  'Rules that matter more than being helpful:',
  '',
  '- Every number you write must be one you were given, copied exactly. Do not add,',
  '  subtract, average, convert or round anything. A figure that is not in the digest below',
  '  does not belong in the paragraph.',
  '- Say what the month actually looks like: where the money went, what is unusual in it,',
  '  and what the findings mean in practice. Be specific — name the merchants and the',
  '  categories you were given.',
  '- No advice. Do not suggest budgeting, cutting back, cancelling anything or watching a',
  '  category. You were asked what this statement says, not what to do about it.',
  '- If the reading did not add up, that is the first sentence, and everything after it is',
  '  described as a reading rather than as fact.',
  '- Plain prose in the second person. No headings, no bullets, no markdown, no sign-off,',
  '  and no closing sentence that summarises the paragraph you just wrote.',
].join('\n');

// What the model sees. Compact on purpose — this is the whole input, and every
// line of it was computed in code from the rows.
function digestFor({ analysis, currency }) {
  const unit = currency ? `${currency} ` : '';
  const amount = (n) => `${unit}${Number(n).toFixed(2)}`;
  const { overview, categories = [], findings = {}, reconciliation = {} } = analysis;
  const lines = [];

  lines.push(`Currency: ${currency || 'unstated'}`);
  if (overview.from) lines.push(`Period covered: ${overview.from} to ${overview.to}`);
  lines.push(`Lines read: ${overview.lines}`);
  lines.push(`Total spent: ${amount(overview.spent)}`);

  const credits = Object.entries(overview.credits || {}).filter(([, v]) => v > 0);
  if (credits.length) {
    const words = { payments: 'paid off the card', refunds: 'refunded', cashback: 'cashback', income: 'came in' };
    lines.push(`Money in: ${credits.map(([k, v]) => `${amount(v)} ${words[k] ?? k}`).join(', ')}`);
  }

  if (reconciliation.status === 'ok') {
    lines.push(`The rows add up to the printed closing balance of ${amount(reconciliation.closing)}.`);
  } else if (reconciliation.status === 'mismatch') {
    lines.push(
      `THE READING DOES NOT ADD UP: following the rows lands on ${amount(reconciliation.expected)} ` +
        `where the statement closes at ${amount(reconciliation.closing)}, a gap of ` +
        `${amount(Math.abs(reconciliation.delta))}. A line was probably missed or misread.`,
    );
  }

  if (categories.length) {
    lines.push('');
    lines.push('Where it went, largest first:');
    for (const c of categories) {
      lines.push(`- ${c.category}: ${amount(c.total)} over ${c.count} lines, ${c.share}% of what went out`);
    }
  }

  const say = {
    duplicates: (d) => `- the same ${amount(d.amount)} at ${d.merchant} ${d.times} times on ${d.date}`,
    repeats: (r) => `- ${r.merchant} charging ${amount(r.amount)} on a roughly monthly cycle, ${r.times} times, ${amount(r.total)} in total`,
    outliers: (o) => `- ${o.merchant} at ${amount(o.amount)}, against a typical ${amount(o.typical)} in ${o.category}`,
    frequent: (f) => `- ${f.merchant} ${f.times} times, ${amount(f.total)} in total`,
  };
  const found = Object.entries(say).flatMap(([key, write]) => (findings[key] ?? []).map(write));
  if (found.length) {
    lines.push('');
    lines.push('What stood out:');
    lines.push(...found);
  }

  return lines.join('\n');
}

// Written from the figures, not from the statement: the text of the statement
// is not sent again, so this costs a fraction of what reading it did.
async function summarise({ analysis, currency = null, model: asked, effort: askedEffort }) {
  const anthropic = client();
  const model = modelFor(asked);
  const spec = MODELS[model];
  const effort = EFFORTS.includes(askedEffort) ? askedEffort : DEFAULT_EFFORT;

  let message;
  try {
    message = await anthropic.messages.create({
      model,
      max_tokens: SUMMARY_MAX_TOKENS,
      system: [{ type: 'text', text: SUMMARY_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: digestFor({ analysis, currency }) }],
      ...(spec.effort ? { output_config: { effort } } : {}),
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new StatementScanError('That Anthropic API key was refused.', 'BAD_API_KEY', 503);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new StatementScanError('Too many requests just now. Try again shortly.', 'RATE_LIMITED', 429);
    }
    throw new StatementScanError(`Writing the summary failed: ${err.message}`, 'SUMMARY_FAILED');
  }

  if (message.stop_reason === 'refusal') {
    throw new StatementScanError('That reading was declined as a statement.', 'DECLINED', 422);
  }

  const summary = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!summary) throw new StatementScanError('Nothing came back to read.', 'EMPTY', 502);

  return {
    summary,
    usage: {
      input: message.usage?.input_tokens ?? 0,
      output: message.usage?.output_tokens ?? 0,
      cacheRead: message.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

module.exports = {
  scan,
  summarise,
  digestFor,
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
