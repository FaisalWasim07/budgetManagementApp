import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { categoricalColors, chrome } from '../../utils/palette';
import { useDisplay } from '../../utils/display';

export default function IncomeExpenseChart({ trend, currency }) {
  const [income, spending, , subs] = categoricalColors();
  const c = chrome();
  const { money, amountsHidden } = useDisplay();
  const hideTicks = amountsHidden ? () => '•••' : undefined;

  return (
    <div className="card">
      <div className="chart-title">Money in vs money out ({currency})</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={c.gridline} vertical={false} />
          <XAxis dataKey="month" tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.baseline }} tickLine={false} />
          <YAxis tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.baseline }} tickLine={false} tickFormatter={hideTicks} />
          <Tooltip
            formatter={(v) => money(v, currency)}
            contentStyle={{ background: c.surface, border: `1px solid ${c.gridline}`, color: c.textPrimary }}
          />
          <Legend wrapperStyle={{ color: c.textSecondary, fontSize: 12 }} />
          <Bar dataKey="income" name="Income" fill={income} radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenses" name="Spending" fill={spending} radius={[4, 4, 0, 0]} />
          <Bar dataKey="subscriptions" name="Subscriptions" fill={subs} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
