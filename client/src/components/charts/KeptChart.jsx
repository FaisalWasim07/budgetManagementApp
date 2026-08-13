import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chrome, sequentialBlue } from '../../utils/palette';
import { shortMonth } from '../../utils/month';

// What was left of each month's income after everything went out, as a share
// of it. Amounts go up when you earn more and down when you earn less; this
// says whether you actually kept any of it, which is the thing that does not
// change just because the salary did.
//
// It is a percentage rather than an amount, so the privacy toggle leaves it
// alone: a share gives away nothing about how much.
export default function KeptChart({ trend }) {
  const c = chrome();
  const good = sequentialBlue();

  const data = trend.map((t) => ({
    month: t.month,
    // A month with nothing coming in has no share to report. null rather than
    // zero, or a month you were between jobs would read as a month you kept
    // exactly none of a real income.
    kept:
      t.income > 0
        ? Math.round(((t.income - t.expenses - t.subscriptions) / t.income) * 100)
        : null,
  }));

  const any = data.some((d) => d.kept != null);

  return (
    <div className="chart">
      <h3>Kept over time</h3>
      <p className="sub">Share of each month’s income still there at the end</p>

      {!any ? (
        <p className="muted" style={{ fontSize: '.88rem' }}>
          No income recorded yet, so there is no share to work out.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={c.gridline} vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={shortMonth}
              tick={{ fill: c.muted, fontSize: 11 }}
              axisLine={{ stroke: c.baseline }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              tick={{ fill: c.muted, fontSize: 11 }}
              axisLine={{ stroke: c.baseline }}
              tickLine={false}
              width={40}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              labelFormatter={shortMonth}
              formatter={(v) => [`${v}% kept`, '']}
              separator=""
              contentStyle={{
                background: c.surface,
                border: `1px solid ${c.gridline}`,
                borderRadius: 10,
                color: c.textPrimary,
              }}
            />
            {/* Zero is the line that matters: below it the month cost more
                than it earned. */}
            <ReferenceLine y={0} stroke={c.baseline} />
            <Bar dataKey="kept" name="Kept" radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.month} fill={d.kept != null && d.kept < 0 ? '#BE123C' : good} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
