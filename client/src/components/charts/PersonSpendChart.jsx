import { motion } from 'motion/react';
import { Money } from '../../utils/display';
import { categoricalColors } from '../../utils/palette';
import { formatMonth } from '../../utils/month';

// Who spent what this month. In a two-person household this is the one chart
// that answers a question the dashboard cannot: the dashboard shows each
// person's figures beside their accounts, but never beside each other.
//
// Spending here means everything that went out — what was spent plus what the
// recurring items took — because a person whose money mostly leaves on
// subscriptions has still spent it.
//
// The bar is the point but there is no shared axis, no tooltip and no time,
// so this is not a bklit BarChart — a chart context per row would just wrap
// two lines of animation in a hundred lines of provider. Instead the bar
// grows in via `motion` — bklit's own animation library, so the entrance
// spring matches every other chart on the page — and the row keeps its
// visible name, amount and share, which the user actually reads.
export default function PersonSpendChart({ persons, currency, month }) {
  const colors = categoricalColors();

  const rows = persons
    .map((person, i) => ({
      id: person.id,
      name: person.name,
      spent: person.expenses,
      subs: person.subscriptions,
      total: person.expenses + person.subscriptions,
      color: colors[i % colors.length],
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  const all = rows.reduce((sum, r) => sum + r.total, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);

  return (
    <div className="chart">
      <h3>Who spent what</h3>
      <p className="sub">
        {formatMonth(month)}, converted to {currency}
      </p>

      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: '.88rem' }}>
          Nothing went out this month.
        </p>
      ) : (
        rows.map((row, i) => (
          <div className="hbar" key={row.id}>
            <span className="n">
              {row.name}
              {row.subs > 0 && (
                <small>
                  {' '}
                  · <Money amount={row.subs} currency={currency} compact /> of it recurring
                </small>
              )}
            </span>
            <span className="a">
              <Money amount={row.total} currency={currency} compact />
              <small> {all > 0 ? Math.round((row.total / all) * 100) : 0}%</small>
            </span>
            <span className="t">
              <motion.span
                key={`${month}-${row.id}`}
                initial={{ width: 0 }}
                animate={{ width: `${max > 0 ? (row.total / max) * 100 : 0}%` }}
                transition={{ type: 'spring', stiffness: 140, damping: 22, delay: i * 0.06 }}
                style={{ background: row.color }}
              />
            </span>
          </div>
        ))
      )}
    </div>
  );
}
