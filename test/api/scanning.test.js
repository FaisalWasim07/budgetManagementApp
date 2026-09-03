// What a statement is read with, and what that costs.
//
// The model is not called. The SDK's own `stream` is replaced with something
// that records what it was handed and answers with a fixed message, so these
// checks are about the request this app builds rather than about what any model
// does with it. That is the part worth pinning down: two of the three settings
// here are ones a wrong value makes the request fail outright, and the third is
// money.
const path = require('path');
const service = require('../../server/src/services/statementService');
const { results } = require('../support/client');

const { check, report } = results();

// The same module instance the service holds, resolved from where the service
// resolves it — requiring '@anthropic-ai/sdk' from this directory would find a
// different copy, patch that, and pass while proving nothing.
const Anthropic = require(
  require.resolve('@anthropic-ai/sdk', {
    paths: [path.join(__dirname, '../../server/src/services')],
  })
);

process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-one';

const sent = [];
const answer = {
  stop_reason: 'end_turn',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        rows: [
          {
            date: '2026-08-03',
            raw: 'TAP COFFEE DUBAI',
            merchant: 'Tap Coffee',
            what: 'a coffee shop',
            amount: 28,
            direction: 'out',
            kind: 'purchase',
            category: 'Eating out',
            confidence: 'high',
          },
        ],
        statement: {
          openingBalance: 100,
          closingBalance: 128,
          periodStart: '2026-08-01',
          periodEnd: '2026-08-31',
        },
      }),
    },
  ],
  usage: {
    input_tokens: 10_000,
    output_tokens: 2_000,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
};

const messages = Object.getPrototypeOf(new Anthropic({ apiKey: 'x' }).messages);
messages.stream = function stub(body) {
  sent.push(body);
  return { finalMessage: async () => answer };
};

const lastSent = () => sent[sent.length - 1];

(async () => {
  // --- the choice reaches the API -----------------------------------------
  await service.scan({ text: 'a line', model: 'claude-sonnet-5', effort: 'medium' });
  check('the model picked is the model asked for', lastSent().model === 'claude-sonnet-5',
    lastSent().model);
  check('and so is the effort', lastSent().output_config.effort === 'medium',
    String(lastSent().output_config.effort));

  // --- a name nobody put on the list --------------------------------------
  // The browser can send anything. An unrecognised model must fall back rather
  // than be passed on: forwarding it would turn a typo into a 404 from the API,
  // and a made-up name into somebody else's bill.
  await service.scan({ text: 'a line', model: 'claude-opus-9-ultra' });
  check('a model nobody offered falls back rather than being forwarded',
    lastSent().model === 'claude-opus-5', lastSent().model);
  check('and modelFor says the same about nothing at all',
    service.modelFor(undefined) === service.DEFAULT_MODEL && service.modelFor(null) === service.DEFAULT_MODEL);

  await service.scan({ text: 'a line', effort: 'extreme' });
  check('an effort nobody offered falls back to the default',
    lastSent().output_config.effort === service.DEFAULT_EFFORT,
    lastSent().output_config.effort);

  // --- effort is a capability, not a preference ---------------------------
  // Haiku rejects the field outright. Sent there it is not ignored, it fails
  // the request — so it has to be absent, not merely unset.
  await service.scan({ text: 'a line', model: 'claude-haiku-4-5', effort: 'high' });
  check('a model that does not take an effort is not sent one',
    !('effort' in lastSent().output_config), Object.keys(lastSent().output_config).join(', '));
  check('it is still asked for the same shape of answer',
    lastSent().output_config.format?.type === 'json_schema');

  // --- what makes the caching work ----------------------------------------
  // The instructions go in a marked system block and the slice goes in the user
  // message. Both halves matter: a cached prefix ends at the first byte that
  // differs, so anything per-slice in the system block would cache nothing.
  await service.scan({ text: 'a line of the statement', categories: ['Groceries'] });
  const call = lastSent();
  check('the instructions are sent as a block that can be cached',
    call.system[0].cache_control?.type === 'ephemeral', JSON.stringify(call.system[0].cache_control));
  check('the household’s own categories are in it, so they are cached too',
    call.system[0].text.includes('Groceries'));
  check('and the slice itself is the only thing that changes between requests',
    call.messages[0].content === 'a line of the statement', call.messages[0].content);

  // --- rows are checked before anything downstream sees them --------------
  const scanned = await service.scan({ text: 'a line' });
  check('the rows come back read', scanned.rows.length === 1 && scanned.rows[0].amount === 28,
    JSON.stringify(scanned.rows));
  check('with the bank’s own figures alongside them',
    scanned.statement.closingBalance === 128, JSON.stringify(scanned.statement));
  check('and what it used', scanned.usage.input === 10_000 && scanned.usage.output === 2_000,
    JSON.stringify(scanned.usage));

  // --- the money ----------------------------------------------------------
  const usage = { input: 10_000, output: 2_000, cacheRead: 0, cacheWrite: 0 };
  const opus = service.priceOf({ model: 'claude-opus-5', usage });
  const sonnet = service.priceOf({ model: 'claude-sonnet-5', usage });
  const haiku = service.priceOf({ model: 'claude-haiku-4-5', usage });
  // 10,000 in at $5 and 2,000 out at $25 per million.
  check('a run is priced from the tokens it used', Math.abs(opus - 0.1) < 1e-9, String(opus));
  check('a cheaper model is cheaper', sonnet < opus && haiku < sonnet, `${opus} ${sonnet} ${haiku}`);
  check('an unknown model is priced as the default rather than as free',
    service.priceOf({ model: 'nonsense', usage }) === opus);

  // The whole reason the instructions are sent as one cacheable block: on every
  // slice after the first they are read back at about a tenth of the price.
  const cached = service.priceOf({
    model: 'claude-opus-5',
    usage: { input: 10_000, output: 2_000, cacheRead: 9_000, cacheWrite: 0 },
  });
  check('reading the instructions back from cache costs less than sending them again',
    cached < opus, `${cached} < ${opus}`);
  check('but not nothing — cached input is still charged', cached > 0.05, String(cached));

  const free = service.priceOf({ model: 'claude-opus-5', usage: { input: 0, output: 0 } });
  check('a run that used nothing costs nothing', free === 0, String(free));

  // --- the list the browser is given --------------------------------------
  const choices = service.choices();
  check('every model offered can actually be picked',
    choices.models.every((m) => service.modelFor(m.id) === m.id),
    JSON.stringify(choices.models.map((m) => m.id)));
  check('and the default effort is one that is offered',
    choices.efforts.includes(choices.defaultEffort), choices.defaultEffort);

  const { failed } = report('Statement scanning: model, effort and cost');
  process.exit(failed ? 1 : 0);
})();
