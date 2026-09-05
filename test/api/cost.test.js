// The price on the button, before the button is pressed.
//
// This is an estimate and the app says so wherever it appears. What is worth
// pinning down is not its precision — token counts are not knowable from the
// browser — but that it is the right shape: that it rises with the statement,
// that the cache makes later slices cheap rather than free, that a cheaper
// model reads as cheaper, and that the words it comes out as are words about
// money rather than about arithmetic.
const path = require('path');
const { results } = require('../support/client');

const { check, report } = results();

// The same shape the server serves for each model, so there is no second copy
// of a price anywhere in the browser.
const OPUS = { input: 5, output: 25 };
const SONNET = { input: 2, output: 10 };

const lines = (n) =>
  Array.from({ length: n }, (_, i) => `0${(i % 9) + 1} Aug 2026 MERCHANT ${i} AE 128.50`).join('\n');

(async () => {
  const { estimateScan, describeCost, spentSoFar } = await import(
    path.join(__dirname, '../../client/src/utils/statementCost.js')
  );

  check('nothing to read costs nothing to say', estimateScan({ chunks: [], prices: OPUS }) === null);
  check(
    'and neither does a model with no price',
    estimateScan({ chunks: [lines(10)], prices: null }) === null,
  );

  const one = estimateScan({ chunks: [lines(60)], prices: OPUS });
  const three = estimateScan({ chunks: [lines(60), lines(60), lines(60)], prices: OPUS });
  check('a statement costs something to read', one > 0, `$${one.toFixed(4)}`);
  check('a longer one costs more', three > one, `$${one.toFixed(4)} → $${three.toFixed(4)}`);
  // The instructions ride along with every slice and are what caching is for.
  // Three slices must cost less than three times one, or the cacheable block is
  // not being counted as cacheable.
  check(
    'but not three times as much, because the instructions are cached',
    three < one * 3,
    `$${(one * 3).toFixed(4)} uncached vs $${three.toFixed(4)}`,
  );

  const sonnet = estimateScan({ chunks: [lines(60), lines(60)], prices: SONNET });
  const opus = estimateScan({ chunks: [lines(60), lines(60)], prices: OPUS });
  check(
    'the cheaper model reads as cheaper, in the ratio its prices say',
    sonnet < opus && Math.abs(sonnet / opus - 0.4) < 0.05,
    `sonnet $${sonnet.toFixed(4)} vs opus $${opus.toFixed(4)}`,
  );

  // A real statement: about 115 lines at 60 to a slice is two parts. On Sonnet
  // that came to roughly a quarter under the real reading, which is the range
  // the button's promise has to sit in to be worth making.
  const real = estimateScan({ chunks: [lines(60), lines(55)], prices: SONNET });
  check(
    'a whole statement lands in cents rather than dollars on Sonnet',
    real > 0.01 && real < 0.5,
    `$${real.toFixed(4)}`,
  );

  // --- said as money, not as arithmetic -----------------------------------
  check('under a cent says so in words', describeCost(0.004) === 'less than a cent', describeCost(0.004));
  check(
    'cents are cents, because "about $0.25" reads as a rounding of something larger',
    describeCost(0.25) === 'about 25¢',
    describeCost(0.25),
  );
  check('and a dollar is a dollar', describeCost(1.004) === 'about $1.00', describeCost(1.004));
  check('nothing at all says nothing', describeCost(null) === '' && describeCost(NaN) === '');

  // --- what it has actually cost so far -----------------------------------
  // The estimate is the promise; this is the bill, added up from what each
  // request reported, and it is what the reading screen shows.
  check(
    'the running total is the slices that came back, not the ones asked for',
    spentSoFar([{ cost: 0.01 }, undefined, { cost: 0.02 }]) === 0.03,
    String(spentSoFar([{ cost: 0.01 }, undefined, { cost: 0.02 }])),
  );
  check('and nothing back is nothing spent', spentSoFar(undefined) === 0);

  const { failed } = report('What a scan will cost');
  process.exit(failed ? 1 : 0);
})();
