import { curveMonotoneX } from '@visx/curve';
import {
  LineChart,
  Line,
  XAxis,
  Grid,
  ChartTooltip,
  YAxis,
} from '../../vendor/bklit/charts/index.js';
import { sequentialBlue } from '../../utils/palette';
import { useDisplay } from '../../utils/display';
import { monthDate } from '../../utils/month';
import { formatTick } from '../../utils/currency';

export default function NetWorthTrendChart({ trend, currency }) {
  const color = sequentialBlue();
  const { money, amountsHidden } = useDisplay();

  // LineChart scales its x-axis against a real time domain — see monthDate's
  // own comment for why the 15th and not the 1st.
  const data = trend.map((t) => ({ ...t, date: monthDate(t.month) }));

  return (
    <div className="chart">
      <h3>Net worth</h3>
      <p className="sub">Everything you hold, in {currency}</p>

      <div style={{ position: 'relative', width: '100%', aspectRatio: '2.35 / 1' }}>
        <LineChart data={data} aspectRatio="2.35 / 1">
          <Grid horizontal />
          <YAxis formatValue={amountsHidden ? () => '•••' : formatTick} />
          <Line
            dataKey="netWorth"
            curve={curveMonotoneX}
            stroke={color}
            strokeWidth={2}
            fadeEdges
          />
          <XAxis />
          <ChartTooltip
            rows={(point) => [
              { color, label: 'Net worth', value: money(point.netWorth, currency) },
            ]}
          />
        </LineChart>
      </div>
    </div>
  );
}
