import { Money } from '../utils/display';
import { formatMonth, hasActivity, shiftMonth } from '../utils/month';
import Sparkline from './charts/Sparkline';
import EndDot from './charts/EndDot';

// A sparkline, not a chart: no axes, no ticks, no numbers. It answers one
// question — has this been going up? — and the figure beside it answers the
// rest. It used to roll its own path maths; it is bklit's AreaChart now, like
// every other shape in the app, which is what buys it the draw-in. Two things
// it kept: `normalise`, because a year spent between 120k and 130k has to show
// its shape and not a flat line pinned to the top of the box, and the end dot,
// which bklit's Area has no marker for.

export default function Hero({ summary, trend, month }) {
  const { household, primaryCurrency } = summary;

  // Looking at a past month shows what the money was worth *then*, not now. If
  // the rupee has halved since, August still says what August said — which is
  // right, and would be baffling without saying so once, plainly.
  const historical = summary.persons.some((person) =>
    person.accounts.some((account) => account.rate?.source === 'historical')
  );
  const estimated = summary.persons.some((person) =>
    person.accounts.some((account) => account.rate?.source === 'estimated')
  );

  // The trend ends on the month being viewed, so the month before it is the
  // one to compare against — including when you have scrolled back to March.
  const values = trend.map((t) => t.netWorth);
  // A month before you started here comes back as zeroes, and comparing
  // against one would call your entire net worth this month's gain.
  const before = trend.length >= 2 ? trend[trend.length - 2] : null;
  const previous = hasActivity(before) ? before.netWorth : null;
  const delta = previous == null ? null : household.netWorth - previous;
  // A first month has nothing to have fallen from, so it reads as rising.
  const rising = delta == null ? true : delta >= 0;
  // Home's colour, not the ledger's green: this is the headline figure, and it
  // is brand-coloured on the way up. Only a fall recolours it.
  const tone = rising ? 'brand' : 'down';

  return (
    <div className="hero">
      <div>
        {/* Whose money this is. Everything else on Home is one person's
            column, so the total at the top has to say it is not. The qualifier
            is the half that goes when there is no width for it. */}
        <p className="label">
          Net worth<span className="on-desk"> · everyone in this household</span>
        </p>
        <p className="value">
          <Money amount={household.netWorth} currency={primaryCurrency} compact />
        </p>
        {/* A first month has neither a comparison nor, usually, savings yet.
            Nothing to say beats an empty line holding space for it. */}
        {delta == null ? (
          household.savings > 0 && (
            <p className="delta">
              <Money amount={household.savings} currency={primaryCurrency} compact /> of it in
              savings
            </p>
          )
        ) : (
          <p className="delta">
            <strong className={delta >= 0 ? 'up' : 'down'}>
              <Money
                amount={Math.abs(delta)}
                currency={primaryCurrency}
                compact
                prefix={delta >= 0 ? '+' : '−'}
              />
            </strong>{' '}
            since {formatMonth(shiftMonth(month, -1)).split(' ')[0]}
            {household.savings > 0 && (
              <>
                {' · '}
                <Money amount={household.savings} currency={primaryCurrency} compact /> in savings
              </>
            )}
          </p>
        )}
        {(historical || estimated) && (
          <p className="rate-note">
            {historical
              ? `Converted at ${formatMonth(month)}’s rate.`
              : `No rate was recorded for ${formatMonth(month)}, so this uses today’s.`}
          </p>
        )}
      </div>
      <Sparkline
        values={values}
        months={trend.map((t) => t.month)}
        tone={tone}
        signature={month}
        normalise
        margin={{ top: 5, right: 5, bottom: 2, left: 5 }}
        className="spark"
        label={`Net worth over the last ${values.length} months, ${
          rising ? 'rising' : 'falling'
        }`}
      >
        <EndDot tone={tone} color={rising ? 'var(--brand-deep)' : 'var(--neg)'} />
      </Sparkline>
    </div>
  );
}
