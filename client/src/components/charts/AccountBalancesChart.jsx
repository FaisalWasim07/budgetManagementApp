import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { categoricalColors, chrome } from '../../utils/palette';
import { useDisplay } from '../../utils/display';

// One bar per account, all converted to the primary currency so accounts in
// different currencies can be compared directly.
export default function AccountBalancesChart({ persons, currency }) {
  const colors = categoricalColors();
  const c = chrome();
  const { money, amountsHidden } = useDisplay();

  const data = persons.flatMap((person, personIndex) =>
    person.accounts
      .filter((a) => a.balancePrimary != null)
      .map((a) => ({
        name: `${person.name.split(' ')[0]} · ${a.name}`,
        value: a.balancePrimary,
        color: colors[personIndex % colors.length],
      }))
  );

  if (data.length === 0) {
    return (
      <div className="card">
        <div className="chart-title">Account balances ({currency})</div>
        <p className="muted">No convertible balances yet.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chart-title">Account balances ({currency})</div>
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 42)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid stroke={c.gridline} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: c.muted, fontSize: 12 }}
            axisLine={{ stroke: c.baseline }}
            tickLine={false}
            tickFormatter={amountsHidden ? () => '•••' : undefined}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            tick={{ fill: c.muted, fontSize: 12 }}
            axisLine={{ stroke: c.baseline }}
            tickLine={false}
          />
          <Tooltip
            formatter={(v) => money(v, currency)}
            contentStyle={{ background: c.surface, border: `1px solid ${c.gridline}`, color: c.textPrimary }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
