import { Money } from '../../utils/display';
import { formatMonth } from '../../utils/month';

const MAX_ROWS = 8;

// Bars on a shared baseline, biggest first. A pie makes you compare angles to
// answer "was rent bigger than groceries"; a bar chart answers it by length,
// and it survives being half a column wide, which the pie did not.
export default function CategoryChart({ categories, currency, month }) {
  const rows = categories.slice(0, MAX_ROWS);
  const rest = categories.slice(MAX_ROWS).reduce((sum, c) => sum + c.amount, 0);
  const data = rest > 0 ? [...rows, { category: 'Everything else', amount: rest }] : rows;
  const max = data.reduce((m, c) => Math.max(m, c.amount), 0);

  return (
    <div className="chart">
      <h3>Where it went</h3>
      <p className="sub">{formatMonth(month)}, biggest first</p>

      {data.length === 0 ? (
        <p className="muted" style={{ fontSize: '.88rem' }}>
          Nothing spent this month.
        </p>
      ) : (
        data.map((row) => (
          <div className="hbar" key={row.category}>
            <span className="n">{row.category}</span>
            <span className="a">
              <Money amount={row.amount} currency={currency} compact />
            </span>
            <span className="t">
              <span style={{ width: `${max > 0 ? (row.amount / max) * 100 : 0}%` }} />
            </span>
          </div>
        ))
      )}
    </div>
  );
}
