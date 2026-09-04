import { PieChart, PieSlice } from '../../vendor/bklit/charts/index.js';
import { Money } from '../../utils/display';
import { categoricalColors } from '../../utils/palette';
import { formatMonth } from '../../utils/month';

// Six named slices and a remainder. A donut answers "what share of the month
// was this" at a glance, which is the question a category breakdown is for;
// the ranking it is bad at — was rent bigger than groceries — is answered by
// the legend beside it, which is sorted and carries the amounts.
//
// PieChart, not RingChart: bklit's Ring is a concentric progress ring — each
// one its own radius, scaled against its own maxValue, the Apple-Watch-rings
// shape — and a single category at 100% of the month sent it a full-circle
// sweep it renders as NaN. PieChart's arc() layout is the one that actually
// divides one ring into proportional slices.
const MAX_SLICES = 6;
const REST = 'var(--ink-3)';

export default function CategoryChart({ categories, currency, month }) {
  const colors = categoricalColors();
  const named = categories.slice(0, MAX_SLICES);
  const rest = categories.slice(MAX_SLICES).reduce((sum, c) => sum + c.amount, 0);

  const data = [
    ...named.map((c, i) => ({ ...c, color: colors[i % colors.length] })),
    ...(rest > 0 ? [{ category: 'Everything else', amount: rest, color: REST }] : []),
  ];
  const total = data.reduce((sum, c) => sum + c.amount, 0);
  // PieSlice's own `color` prop only reaches its hover glow — the fill it
  // actually paints comes from `getFill`, which reads `color` off the DATA
  // ITEM first and only falls back to bklit's own --chart-1..5 palette
  // (which Bayt has no reason to define, since it already has one). Carrying
  // color on the row is the documented way in, and the one that works.
  const pieData = data.map((c) => ({ label: c.category, value: c.amount, color: c.color }));

  return (
    <div className="chart">
      <h3>Where it went</h3>
      <p className="sub">{formatMonth(month)}, biggest first</p>

      {data.length === 0 ? (
        <p className="muted" style={{ fontSize: '.88rem' }}>
          Nothing spent this month.
        </p>
      ) : (
        <div className="donut-wrap">
          <div className="donut">
            {/* Explicit 0 → 2π: bklit's default is startAngle=−π/2 with a
                comment claiming "top", but d3-shape's arc convention treats
                0 as 12 o'clock, so its default puts the first slice at 9
                o'clock and the whole donut reads as tilted a quarter-turn.
                Starting at 12 is what every pie chart in the world does. */}
            <PieChart
              data={pieData}
              size={148}
              innerRadius={44}
              startAngle={0}
              endAngle={2 * Math.PI}
            >
              {pieData.map((item, i) => (
                <PieSlice index={i} key={item.label} />
              ))}
            </PieChart>
            {/* Not <PieCenter>: its own built-in content is NumberFlow, which
                knows nothing about the privacy toggle or a currency symbol —
                and its render-prop override only fires while a slice is
                actively hovered, defaulting back to that same unmasked number
                the rest of the time, which is most of the time. This sibling
                span is exactly what sat over the hand-drawn donut before;
                <Money> already knows how to become dots when the eye is
                clicked, which is the property that matters here. */}
            <span className="donut-centre">
              <small>went out</small>
              <Money amount={total} currency={currency} compact />
            </span>
          </div>

          <ul className="donut-legend">
            {data.map((slice) => (
              <li key={slice.category}>
                <i style={{ background: slice.color }} />
                <span className="n">{slice.category}</span>
                <span className="p">
                  {total > 0 ? Math.round((slice.amount / total) * 100) : 0}%
                </span>
                <span className="a">
                  <Money amount={slice.amount} currency={currency} compact />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
