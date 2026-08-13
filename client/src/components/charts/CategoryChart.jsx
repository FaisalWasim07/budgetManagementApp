import { Money } from '../../utils/display';
import { categoricalColors } from '../../utils/palette';
import { formatMonth } from '../../utils/month';

// Six named slices and a remainder. A donut answers "what share of the month
// was this" at a glance, which is the question a category breakdown is for;
// the ranking it is bad at — was rent bigger than groceries — is answered by
// the legend beside it, which is sorted and carries the amounts.
const MAX_SLICES = 6;
const REST = 'var(--ink-3)';

const R = 52;
const STROKE = 20;
const SIZE = (R + STROKE / 2) * 2 + 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

export default function CategoryChart({ categories, currency, month }) {
  const colors = categoricalColors();
  const named = categories.slice(0, MAX_SLICES);
  const rest = categories.slice(MAX_SLICES).reduce((sum, c) => sum + c.amount, 0);

  const data = [
    ...named.map((c, i) => ({ ...c, color: colors[i % colors.length] })),
    ...(rest > 0 ? [{ category: 'Everything else', amount: rest, color: REST }] : []),
  ];
  const total = data.reduce((sum, c) => sum + c.amount, 0);

  // Where each arc starts, as a length along the circle. Drawn from twelve
  // o'clock, clockwise, biggest first.
  let at = 0;
  const slices = data.map((row) => {
    const length = total > 0 ? (row.amount / total) * CIRCUMFERENCE : 0;
    const slice = { ...row, length, offset: at };
    at += length;
    return slice;
  });

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
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Spending by category">
              <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
                {slices.map((slice) => (
                  <circle
                    key={slice.category}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    fill="none"
                    stroke={slice.color}
                    strokeWidth={STROKE}
                    // A 1px gap between arcs, so two neighbouring slices read as
                    // two things rather than one long one.
                    strokeDasharray={`${Math.max(0, slice.length - 1)} ${CIRCUMFERENCE}`}
                    strokeDashoffset={-slice.offset}
                  >
                    <title>{slice.category}</title>
                  </circle>
                ))}
              </g>
            </svg>
            <span className="donut-centre">
              <small>went out</small>
              <Money amount={total} currency={currency} compact />
            </span>
          </div>

          <ul className="donut-legend">
            {slices.map((slice) => (
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
