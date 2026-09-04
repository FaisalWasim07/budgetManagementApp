import { useDisplay } from '../../utils/display';
import { formatMonth, hasActivity } from '../../utils/month';
import Sparkline from './Sparkline';
import { KpiMoney, KpiPercent } from './KpiValue';

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
      <Sparkline values={values} tone={tone} signature={`${month}-${label}`} />
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
  const keptNow =
    household.income > 0
      ? ((household.income - household.expenses - household.subscriptions) / household.income) * 100
      : null;
  const keptPrev = previous ? keptRate(previous) : null;

  // The delta line (the "vs July" bit) still falls back to the text money()
  // formatter when a percentage is not available: that path had to be masked
  // by the eye, and used to print the figure in the clear otherwise. The
  // headline value uses KpiMoney, which rolls between values on every render
  // instead of blinking to the new one — but hands over to the same <Money>
  // dust animation while amounts are hidden, so the two never overlap.
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
        <KpiMoney amount={household.income} currency={currency} />
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
        <KpiMoney amount={household.expenses + household.subscriptions} currency={currency} />
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
        <KpiPercent value={keptNow} />
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
        <KpiMoney amount={household.netWorth} currency={currency} />
      </Kpi>
    </div>
  );
}
