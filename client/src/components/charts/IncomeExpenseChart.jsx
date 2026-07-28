import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { categoricalColors, chrome } from '../../utils/palette';
import { formatCurrency } from '../../utils/currency';

export default function IncomeExpenseChart({ trend }) {
  const [income, expense] = categoricalColors();
  const c = chrome();

  return (
    <div className="card">
      <div className="chart-title">Income vs Expenses (AED)</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={c.gridline} vertical={false} />
          <XAxis dataKey="month" tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.baseline }} tickLine={false} />
          <YAxis tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.baseline }} tickLine={false} />
          <Tooltip
            formatter={(value) => formatCurrency(value, 'AED')}
            contentStyle={{ background: c.surface, border: `1px solid ${c.gridline}`, color: c.textPrimary }}
          />
          <Legend wrapperStyle={{ color: c.textSecondary, fontSize: 12 }} />
          <Bar dataKey="income" name="Income" fill={income} radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenses" name="Expenses" fill={expense} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
