import {
  BarChart,
  Bar,
  BarXAxis,
  Grid,
  ChartTooltip,
  YAxis,
} from '../../vendor/bklit/charts/index.js';
import { sequentialBlue } from '../../utils/palette';
import { shortMonth } from '../../utils/month';

// What was left of each month's income after everything went out, as a share
// of it. Amounts go up when you earn more and down when you earn less; this
// says whether you actually kept any of it, which is the thing that does not
// change just because the salary did.
//
// It is a percentage rather than an amount, so the privacy toggle leaves it
// alone: a share gives away nothing about how much.
export default function KeptChart({ trend }) {
  const good = sequentialBlue();
  const bad = '#BE123C';

  const data = trend.map((t) => ({
    month: shortMonth(t.month),
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
        <div style={{ position: 'relative', width: '100%', aspectRatio: '2.35 / 1' }}>
          <BarChart data={data} xDataKey="month" aspectRatio="2.35 / 1">
            {/* Zero is the line that matters: below it the month cost more
                than it earned. */}
            <Grid horizontal highlightRowValues={[0]} highlightRowStroke="var(--ink-3)" />
            {/* Without a scale the bars could only be read by hovering them
                one at a time, which is not what a chart of twelve months is
                for — the whole point is taking them in together, and that
                needs to know whether the tall ones are sixty per cent or
                ninety. Not masked: a share tells you nothing about how much,
                which is the same reason the figure above it isn't. */}
            <YAxis formatValue={(v) => `${Math.round(v)}%`} />
            {/* A small radius rather than "round", which is half the bar's
                width: at this width that curved the foot of every bar away
                from the zero line the grid draws, and zero is the line this
                chart is read against. */}
            <Bar
              dataKey="kept"
              fill={good}
              lineCap={4}
              fillFor={(row) => (row.kept < 0 ? bad : undefined)}
            />
            <BarXAxis />
            <ChartTooltip
              rows={(point) => [
                {
                  color: point.kept < 0 ? bad : good,
                  label: point.kept < 0 ? 'Overspent by' : 'Kept',
                  value: `${Math.abs(point.kept)}%`,
                },
              ]}
            />
          </BarChart>
        </div>
      )}
    </div>
  );
}
