import { useChart } from '../../vendor/bklit/charts/index.js';
import { toneColor } from './Sparkline';

// The dot on the last point of a sparkline — "and here is where that leaves
// you". bklit's Area has `showMarkers`, but that marks every point; there is no
// terminal-only marker for an area the way there is for a line, so this draws
// the one. It is an ordinary child of the chart, which means it sits inside the
// same reveal clip as the line and is uncovered by the same animation, arriving
// exactly as the line reaches it.
export default function EndDot({
  valueKey = 'v',
  dateKey = 'date',
  tone = 'neutral',
  // The dot is allowed its own colour: on Home it is a shade deeper than the
  // line it ends, which is what stops it reading as a lump in the stroke.
  color,
  r = 3.4,
}) {
  const { data, xScale, yScale } = useChart();

  const last = data[data.length - 1];
  if (!last) return null;

  const x = xScale(last[dateKey]);
  const y = yScale(last[valueKey]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return <circle className="spark-dot" cx={x} cy={y} r={r} fill={color ?? toneColor(tone)} />;
}
