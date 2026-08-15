import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { categoricalColors, chrome } from '../../utils/palette';
import { useDisplay } from '../../utils/display';
import { shortMonth } from '../../utils/month';
import { formatTick } from '../../utils/currency';

export default function IncomeExpenseChart({ trend, currency }) {
  const [income, spending, , subs] = categoricalColors();
  const c = chrome();
  const { money, amountsHidden } = useDisplay();
  const ticks = amountsHidden ? () => '•••' : formatTick;

  return (
    <div className="chart">
      <h3>In and out</h3>
      <p className="sub">Twelve months, converted to {currency}</p>

      {/* The legend is markup rather than the chart library's, so it reads the
          same as every other legend in the app and never steals chart height. */}
      <div className="chart-legend">
        <span>
          <i style={{ background: income }} /> Came in
        </span>
        <span>
          <i style={{ background: spending }} /> Went out
        </span>
        <span>
          <i style={{ background: subs }} /> Subscriptions
        </span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={trend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
            width={46}
            tickFormatter={ticks}
          />
          <Tooltip
            labelFormatter={shortMonth}
            formatter={(v) => money(v, currency)}
            contentStyle={{
              background: c.surface,
              border: `1px solid ${c.gridline}`,
              borderRadius: 10,
              color: c.textPrimary,
            }}
          />
          <Bar dataKey="income" name="Came in" fill={income} radius={[6, 6, 0, 0]} />
          <Bar dataKey="expenses" name="Went out" fill={spending} radius={[6, 6, 0, 0]} />
          <Bar dataKey="subscriptions" name="Subscriptions" fill={subs} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
