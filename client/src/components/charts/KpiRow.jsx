import { useDisplay } from '../../utils/display';
import { hasActivity } from '../../utils/month';
import StatCard from './StatCard';

// The four figures above the charts, each one a bklit stat card: what it is
// now, which way it moved, and the shape of the year behind it — and, on hover,
// what any month in that year was. StatCard.jsx is where the block lives; this
// is only the wiring.
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

  const months = trend.map((t) => t.month);
  const outOf = (t) => t.expenses + t.subscriptions;
  // What was left of what came in, as a share of it. A month with nothing
  // coming in has no share to report rather than a rate of minus infinity.
  const keptRate = (t) => (t.income > 0 ? ((t.income - outOf(t)) / t.income) * 100 : null);

  // A month with no share drops out of the Kept sparkline entirely, and its
  // month label has to drop with it or the hover would name the wrong one.
  const keptPoints = trend
    .map((t) => ({ month: t.month, value: keptRate(t) }))
    .filter((p) => p.value != null);
  const keptNow =
    household.income > 0
      ? ((household.income - household.expenses - household.subscriptions) / household.income) * 100
      : null;
  const keptPrev = previous ? keptRate(previous) : null;

  // The absolute fallback in a card's badge — the "↓ AED 1.2K" it falls back to
  // when a percentage would be meaningless — goes through the same masked
  // formatter as every other amount, so the eye still hides it.
  const moneyText = (v) => money(v, currency, { compact: true });

  return (
    <div className="kpis">
      <StatCard
        title="Came in"
        values={trend.map((t) => t.income)}
        months={months}
        current={household.income}
        previous={previous?.income}
        higherIsBetter
        month={prevMonth}
        format={moneyText}
        currency={currency}
      />

      <StatCard
        title="Went out"
        values={trend.map(outOf)}
        months={months}
        current={household.expenses + household.subscriptions}
        previous={previous ? outOf(previous) : null}
        higherIsBetter={false}
        month={prevMonth}
        format={moneyText}
        currency={currency}
      />

      <StatCard
        title="Kept"
        values={keptPoints.map((p) => p.value)}
        months={keptPoints.map((p) => p.month)}
        current={keptNow}
        previous={keptNow == null ? null : keptPrev}
        higherIsBetter
        month={prevMonth}
        absolute
        kind="percent"
        format={(v) => `${Math.round(v)} point${Math.round(v) === 1 ? '' : 's'}`}
      />

      <StatCard
        title="Net worth"
        values={trend.map((t) => t.netWorth)}
        months={months}
        current={household.netWorth}
        previous={previous?.netWorth}
        higherIsBetter
        month={prevMonth}
        format={moneyText}
        currency={currency}
      />
    </div>
  );
}
