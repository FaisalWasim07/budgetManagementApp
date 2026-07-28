import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { categoricalColors, chrome } from '../../utils/palette';
import { formatCurrency } from '../../utils/currency';

export default function CurrencyCompositionChart({ composition }) {
  const colors = categoricalColors();
  const c = chrome();
  const aed = composition.AED ?? 0;
  const foreign = composition.foreignAED ?? 0;

  if (aed <= 0 && foreign <= 0) {
    return (
      <div className="card">
        <div className="chart-title">Currency Composition</div>
        <p className="muted">No balances yet this month.</p>
      </div>
    );
  }

  const data = [
    { name: 'AED accounts', value: Math.max(aed, 0), color: colors[0] },
    { name: 'Foreign (in AED)', value: Math.max(foreign, 0), color: colors[2] },
  ];

  return (
    <div className="card">
      <div className="chart-title">Currency Composition</div>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} stroke={c.surface} strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => formatCurrency(value, 'AED')}
            contentStyle={{ background: c.surface, border: `1px solid ${c.gridline}`, color: c.textPrimary }}
          />
          <Legend wrapperStyle={{ color: c.textSecondary, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
