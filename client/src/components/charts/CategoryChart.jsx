import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { categoricalColors, chrome } from '../../utils/palette';
import { formatCurrency } from '../../utils/currency';

const MAX_SLICES = 6;

export default function CategoryChart({ categories, currency }) {
  const colors = categoricalColors();
  const c = chrome();

  if (!categories || categories.length === 0) {
    return (
      <div className="card">
        <div className="chart-title">Where the money went ({currency})</div>
        <p className="muted">No spending recorded this month.</p>
      </div>
    );
  }

  // Categorical hues are assigned in fixed order and never generated, so
  // anything past the palette's usable slots is folded into one "Other" slice.
  const head = categories.slice(0, MAX_SLICES);
  const tailTotal = categories.slice(MAX_SLICES).reduce((s, x) => s + x.amount, 0);
  const data = tailTotal > 0 ? [...head, { category: 'Other', amount: tailTotal }] : head;

  return (
    <div className="card">
      <div className="chart-title">Where the money went ({currency})</div>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="amount" nameKey="category" innerRadius={58} outerRadius={92} paddingAngle={2}>
            {data.map((d, i) => (
              <Cell key={d.category} fill={colors[i % colors.length]} stroke={c.surface} strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => formatCurrency(v, currency)}
            contentStyle={{ background: c.surface, border: `1px solid ${c.gridline}`, color: c.textPrimary }}
          />
          <Legend wrapperStyle={{ color: c.textSecondary, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
