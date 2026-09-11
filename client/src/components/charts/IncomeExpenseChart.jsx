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

// Two bars a month: what came in, and what went out. Everywhere else in the
// app "went out" is spending plus what the recurring items took — the figure
// at the top of this very page, and the arithmetic behind "Kept over time" —
// and this chart used to draw only the spending under that name, with
// subscriptions as a third bar beside it. Two numbers, one word, a hand's
// width apart: whichever the eye landed on, one of them was wrong.
//
// So the third series is folded into the second, where it belongs, and the
// tooltip says how much of the month's outgoings were recurring. The shape
// answers "did more come in than went out", which is what a month-by-month
// comparison is asked; which subscriptions did the damage is a question for
// Recurring, and how it was spent is the donut two cards down.
//
// Folding it in also gives the bars their width back. Three series over
// twelve months left each bar eight pixels wide, and subscriptions beside a
// salary is under a percent of it — a sliver too thin to see, whatever it was
// coloured.
export default function IncomeExpenseChart({ trend, currency }) {
  const [income, spending] = categoricalColors();
  const { money, amountsHidden } = useDisplay();

  // BarXAxis reads xDataKey's value raw — no tickFormatter prop exists, so the
  // display label is written into the row itself rather than the ISO month.
  // Twelve consecutive months never collide on their short name.
  const data = trend.map((t) => ({
    ...t,
    month: shortMonth(t.month),
    out: t.expenses + t.subscriptions,
  }));

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
      </div>

      {/* The caps are a small radius rather than "round", which means half the
          bar's width: that curved the foot of every bar away from the axis it
          was standing on, and turned a bar shorter than it is wide into a
          floating lozenge. A fixed three keeps a tall bar soft-topped and
          leaves a short one sitting where it belongs. */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '2.35 / 1' }}>
        <BarChart data={data} xDataKey="month" aspectRatio="2.35 / 1" barGap={0.1}>
          <Grid horizontal />
          <YAxis formatValue={amountsHidden ? () => '•••' : formatTick} />
          <Bar dataKey="income" fill={income} lineCap={3} groupGap={3} />
          <Bar dataKey="out" fill={spending} lineCap={3} groupGap={3} />
          <BarXAxis />
          <ChartTooltip
            rows={(point) => [
              { color: income, label: 'Came in', value: money(point.income, currency) },
              { color: spending, label: 'Went out', value: money(point.out, currency) },
              // Only when there were any. A household with no subscriptions
              // has nothing to break out, and a row reading "nil" is a line of
              // tooltip spent saying nothing.
              //
              // Faded from the bar's own colour rather than given one of its
              // own: this is part of the amount above it, and a fourth
              // categorical hue here would announce a series that is not
              // drawn — the palette's order is spoken for anyway.
              ...(point.subscriptions > 0
                ? [
                    {
                      color: `color-mix(in srgb, ${spending} 45%, transparent)`,
                      label: 'of it recurring',
                      value: money(point.subscriptions, currency),
                    },
                  ]
                : []),
            ]}
          />
        </BarChart>
      </div>
    </div>
  );
}
