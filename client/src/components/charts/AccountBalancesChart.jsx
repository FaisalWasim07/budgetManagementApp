import { Money } from '../../utils/display';
import { categoricalColors } from '../../utils/palette';

// One bar per account, everything converted to the primary currency so
// accounts in different currencies can be compared by eye. Colour groups the
// bars by person rather than decorating them.
export default function AccountBalancesChart({ persons, currency }) {
  const colors = categoricalColors();

  const rows = persons.flatMap((person, personIndex) =>
    person.accounts
      .filter((a) => a.balancePrimary != null && a.balancePrimary > 0)
      .map((a) => ({
        key: a.id,
        name: `${person.name.split(' ')[0]} · ${a.name}`,
        value: a.balancePrimary,
        color: colors[personIndex % colors.length],
      }))
  );

  rows.sort((a, b) => b.value - a.value);
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);

  return (
    <div className="chart">
      <h3>What sits where</h3>
      <p className="sub">Balances today, converted to {currency}</p>

      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: '.88rem' }}>
          No convertible balances yet.
        </p>
      ) : (
        rows.map((row) => (
          <div className="hbar" key={row.key}>
            <span className="n">{row.name}</span>
            <span className="a">
              <Money amount={row.value} currency={currency} compact />
            </span>
            <span className="t">
              <span
                style={{ width: `${max > 0 ? (row.value / max) * 100 : 0}%`, background: row.color }}
              />
            </span>
          </div>
        ))
      )}
    </div>
  );
}
