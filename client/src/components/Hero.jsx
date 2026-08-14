import { Money } from '../utils/display';
import { formatMonth, hasActivity, shiftMonth } from '../utils/month';

// A sparkline, not a chart: no axes, no ticks, no numbers. It answers one
// question — has this been going up? — and the figure beside it answers the
// rest. Values are normalised to their own range so a flat year still shows
// its shape rather than a dead straight line at the bottom.
function Spark({ values, rising }) {
  if (values.length < 2) return null;

  const width = 150;
  const height = 52;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  // Inset by the radius of the end dot, or half of it is cut off by the edge
  // of the box.
  const pad = 4;
  const x = (i) => pad + ((width - pad * 2) / (values.length - 1)) * i;
  const y = (v) => height - 6 - ((v - lo) / span) * (height - 16);

  const last = values.length - 1;
  const line = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      className={rising ? 'spark' : 'spark down'}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Net worth over the last ${values.length} months, ${rising ? 'rising' : 'falling'}`}
    >
      <path className="fill" d={`${line} L${x(last)} ${height} L${x(0)} ${height} Z`} />
      <path className="line" d={line} />
      <circle className="dot" cx={x(last)} cy={y(values[last])} r="3.4" />
    </svg>
  );
}

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

  return (
    <div className="hero">
      <div>
        <p className="label">Net worth</p>
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
      <Spark values={values} rising={delta == null ? true : delta >= 0} />
    </div>
  );
}
