import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { sequentialBlue, chrome } from '../../utils/palette';
import { formatCurrency } from '../../utils/currency';

export default function NetWorthTrendChart({ trend, currency }) {
  const color = sequentialBlue();
  const c = chrome();

  return (
    <div className="card">
      <div className="chart-title">Net worth over time ({currency})</div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={c.gridline} vertical={false} />
          <XAxis dataKey="month" tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.baseline }} tickLine={false} />
          <YAxis tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.baseline }} tickLine={false} />
          <Tooltip
            formatter={(v) => formatCurrency(v, currency)}
            contentStyle={{ background: c.surface, border: `1px solid ${c.gridline}`, color: c.textPrimary }}
          />
          <Line type="monotone" dataKey="netWorth" name="Net worth" stroke={color} strokeWidth={2} dot={{ r: 4, fill: color }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
