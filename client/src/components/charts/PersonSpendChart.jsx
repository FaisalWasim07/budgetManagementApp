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
      <p className="sub">{formatMonth(month)}, converted to {currency}</p>

      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: '.88rem' }}>
          Nothing went out this month.
        </p>
      ) : (
        rows.map((row) => (
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
              <span
                style={{ width: `${max > 0 ? (row.total / max) * 100 : 0}%`, background: row.color }}
              />
            </span>
          </div>
        ))
      )}
    </div>
  );
}
