import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { sequentialBlue, chrome } from '../../utils/palette';
import { useDisplay } from '../../utils/display';
import { shortMonth } from '../../utils/month';
import { formatTick } from '../../utils/currency';

export default function NetWorthTrendChart({ trend, currency }) {
  const color = sequentialBlue();
  const c = chrome();
  const { money, amountsHidden } = useDisplay();
  const ticks = amountsHidden ? () => '•••' : formatTick;

  return (
    <div className="chart">
      <h3>Net worth</h3>
      <p className="sub">Everything you hold, in {currency}</p>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
          <Line
            type="monotone"
            dataKey="netWorth"
            name="Net worth"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: color }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
