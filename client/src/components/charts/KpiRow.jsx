import { Money, useDisplay } from '../../utils/display';
import { formatMonth, hasActivity } from '../../utils/month';

// Four figures across the top of Stats, each with the same three parts: what
// it is now, how it moved since last month, and the shape of the last twelve.
// The shape is what stops a single month being read as a trend.
function Mini({ values, tone }) {
  if (values.length < 2) return null;

  const width = 120;
  const height = 34;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const pad = 3;
  const x = (i) => (width / (values.length - 1)) * i;
  // A salary that was the same twelve months running has no range to spread
  // over. Normalising it anyway would pin the line to the floor, where it is
  // half-hidden by the edge and reads as a bug rather than as "flat".
  const y = (v) =>
    span === 0 ? height / 2 : height - pad - ((v - lo) / span) * (height - pad * 2);

  const line = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      className={`mini ${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="fill" d={`${line} L${width} ${height} L0 ${height} Z`} />
      <path className="line" d={line} />
    </svg>
  );
}

// Whether a move up is a good move depends on the figure: net worth rising is
// good, spending rising is not. `higherIsBetter` is what decides the colour,
// so nothing here has to hard-code green.
function Kpi({
  label,
  children,
  values,
  current,
  previous,
  higherIsBetter,
  month,
  format,
  absolute = false,
}) {
  const has = previous != null && Number.isFinite(previous);
  const change = has ? current - previous : null;
  // A percentage of a number that was zero is not a percentage; those months
  // get the absolute move instead of "∞%". A figure that is already a
  // percentage moves in points, never in a percentage of a percentage.
  const pct =
    has && !absolute && Math.abs(previous) > 0.005 ? (change / Math.abs(previous)) * 100 : null;
  const flat = change != null && Math.abs(change) < 0.005;
  const good = change == null || flat ? null : change > 0 === higherIsBetter;
  const tone = good == null ? 'flat' : good ? 'up' : 'down';

  return (
    <div className="kpi">
      <span className="k">{label}</span>
      <span className="v">{children}</span>
      <span className={`d ${tone}`}>
        {change == null ? (
          <span className="muted">no earlier month</span>
        ) : flat ? (
          <>unchanged since {formatMonth(month).split(' ')[0]}</>
        ) : (
          <>
            <b>
              {change > 0 ? '↑' : '↓'}{' '}
              {pct == null ? format(Math.abs(change)) : `${Math.abs(pct).toFixed(0)}%`}
            </b>{' '}
            vs {formatMonth(month).split(' ')[0]}
          </>
        )}
      </span>
      <Mini values={values} tone={tone} />
    </div>
  );
}

export default function KpiRow({ summary, trend, month }) {
  const currency = summary.primaryCurrency;
  const { household } = summary;
  const { money } = useDisplay();

  // The trend ends on the month being viewed, so the row before the last is
  // the one to compare against — but only if it actually happened. Before you
  // started using the app those rows are zeroes, and every figure would report
  // itself as having appeared out of nowhere this month.
  const before = trend.length >= 2 ? trend[trend.length - 2] : null;
  const previous = hasActivity(before) ? before : null;
  const prevMonth = previous?.month ?? month;

  const outOf = (t) => t.expenses + t.subscriptions;
  // What was left of what came in, as a share of it. A month with nothing
  // coming in has no share to report rather than a rate of minus infinity.
  const keptRate = (t) => (t.income > 0 ? ((t.income - outOf(t)) / t.income) * 100 : null);

  const kept = trend.map(keptRate);
  const keptNow = household.income > 0
    ? ((household.income - household.expenses - household.subscriptions) / household.income) * 100
    : null;
  const keptPrev = previous ? keptRate(previous) : null;

  const asMoney = (v) => <Money amount={v} currency={currency} compact />;
  // Through the same masking as every other amount. This is what a delta falls
  // back to when last month was zero, and it used to print the figure in the
  // clear with the eye shut.
  const moneyText = (v) => money(v, currency, { compact: true });

  return (
    <div className="kpis">
      <Kpi
        label="Came in"
        values={trend.map((t) => t.income)}
        current={household.income}
        previous={previous?.income}
        higherIsBetter
        month={prevMonth}
        format={moneyText}
      >
        {asMoney(household.income)}
      </Kpi>

      <Kpi
        label="Went out"
        values={trend.map(outOf)}
        current={household.expenses + household.subscriptions}
        previous={previous ? outOf(previous) : null}
        higherIsBetter={false}
        month={prevMonth}
        format={moneyText}
      >
        {asMoney(household.expenses + household.subscriptions)}
      </Kpi>

      {/* Not masked by the eye: a share of what came in gives away no amount,
          and it is the one figure here that is worth reading over a shoulder. */}
      <Kpi
        label="Kept"
        values={kept.filter((v) => v != null)}
        current={keptNow ?? 0}
        previous={keptNow == null ? null : keptPrev}
        higherIsBetter
        month={prevMonth}
        absolute
        format={(v) => `${Math.round(v)} point${Math.round(v) === 1 ? '' : 's'}`}
      >
        {keptNow == null ? <span className="muted">—</span> : `${Math.round(keptNow)}%`}
      </Kpi>

      <Kpi
        label="Net worth"
        values={trend.map((t) => t.netWorth)}
        current={household.netWorth}
        previous={previous?.netWorth}
        higherIsBetter
        month={prevMonth}
        format={moneyText}
      >
        {asMoney(household.netWorth)}
      </Kpi>

    </div>
  );
}
