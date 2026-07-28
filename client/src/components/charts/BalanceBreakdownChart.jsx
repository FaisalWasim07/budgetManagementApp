import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { categoricalColors, chrome } from '../../utils/palette';
import { formatCurrency } from '../../utils/currency';

const TYPES = [
  { key: 'primary', label: 'Primary' },
  { key: 'expense', label: 'Expense' },
  { key: 'savings', label: 'Savings' },
  { key: 'multi_currency', label: 'Multi-Currency' },
];

export default function BalanceBreakdownChart({ persons }) {
  const colors = categoricalColors();
  const c = chrome();

  const data = persons.map((person) => {
    const row = { name: person.name };
    for (const { key } of TYPES) {
      const account = person.accounts.find((a) => a.type === key);
      row[key] = account ? account.balanceAED ?? 0 : 0;
    }
    return row;
  });

  return (
    <div className="card">
      <div className="chart-title">Account Balances (AED)</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={c.gridline} vertical={false} />
          <XAxis dataKey="name" tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.baseline }} tickLine={false} />
          <YAxis tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.baseline }} tickLine={false} />
          <Tooltip
            formatter={(value) => formatCurrency(value, 'AED')}
            contentStyle={{ background: c.surface, border: `1px solid ${c.gridline}`, color: c.textPrimary }}
          />
          <Legend wrapperStyle={{ color: c.textSecondary, fontSize: 12 }} />
          {TYPES.map(({ key, label }, i) => (
            <Bar key={key} dataKey={key} name={label} fill={colors[i]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
