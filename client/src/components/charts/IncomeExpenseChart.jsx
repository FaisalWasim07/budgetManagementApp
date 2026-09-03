import {
  BarChart,
  Bar,
  BarXAxis,
  Grid,
  ChartTooltip,
  YAxis,
} from '../../vendor/bklit/charts/index.js';
import { categoricalColors } from '../../utils/palette';
import { useDisplay } from '../../utils/display';
import { shortMonth } from '../../utils/month';
import { formatTick } from '../../utils/currency';

export default function IncomeExpenseChart({ trend, currency }) {
  const [income, spending, , subs] = categoricalColors();
  const { money, amountsHidden } = useDisplay();

  // BarXAxis reads xDataKey's value raw — no tickFormatter prop exists, so the
  // display label is written into the row itself rather than the ISO month.
  // Twelve consecutive months never collide on their short name.
  const data = trend.map((t) => ({ ...t, month: shortMonth(t.month) }));

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

      <div style={{ position: 'relative', width: '100%', aspectRatio: '2.35 / 1' }}>
        <BarChart data={data} xDataKey="month" aspectRatio="2.35 / 1" barGap={0.16}>
          <Grid horizontal />
          <YAxis formatValue={amountsHidden ? () => '•••' : formatTick} />
          <Bar dataKey="income" fill={income} lineCap="round" />
          <Bar dataKey="expenses" fill={spending} lineCap="round" />
          <Bar dataKey="subscriptions" fill={subs} lineCap="round" />
          <BarXAxis />
          <ChartTooltip
            rows={(point) => [
              { color: income, label: 'Came in', value: money(point.income, currency) },
              { color: spending, label: 'Went out', value: money(point.expenses, currency) },
              { color: subs, label: 'Subscriptions', value: money(point.subscriptions, currency) },
            ]}
          />
        </BarChart>
      </div>
    </div>
  );
}
