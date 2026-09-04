import { curveMonotoneX } from '@visx/curve';
import { AreaChart, Area } from '../../vendor/bklit/charts/index.js';
import { monthDate } from '../../utils/month';

// A twelve-point sparkline drawn by bklit's AreaChart, dressed down to the
// smallest thing that reads as a shape: no axes, no grid, just the line over
// its own fill. `tone` decides the colour, so a rising expense line paints red
// and a rising net-worth line paints green — the colour is the alarm, not a
// decoration.
//
// `signature` re-plays the draw-in when the month changes: bklit re-animates
// whenever its `revealSignature` prop changes value. Without it, switching
// months would swap in the new numbers with no motion at all.
//
// `children` are handed to the AreaChart untouched, which is how bklit's own
// stat-card block reaches the hovered point: `StatCardHoverBridge` is a child
// of the chart, renders nothing, and reads the hover out of chart context.
// `showHighlight` is off by default because a sparkline with no hover is still
// a sparkline; the stat card turns it on.
//
// `normalise` maps the values onto 0..1 before plotting them. bklit's y-domain
// for an all-positive series is [0, max × 1.1] — measured from zero, which is
// the honest choice for a chart with an axis and the wrong one for a sparkline
// with none: a net worth that spent the year between 120k and 130k would draw
// as a dead flat line pinned to the top of the box. Normalising to the series'
// own range gives the shape back. It costs the real numbers, so it is only for
// the callers that never read a value back out — anything with a hover readout
// wants the raw figures.
const TONES = {
  up: 'var(--pos)',
  down: 'var(--neg)',
  flat: 'var(--ink-3)',
  neutral: 'var(--ink-3)',
  brand: 'var(--brand)',
};

const OPACITY = {
  up: 0.13,
  down: 0.11,
  flat: 0.1,
  neutral: 0.1,
  brand: 0.16,
};

export function toneColor(tone) {
  return TONES[tone] ?? TONES.neutral;
}

export default function Sparkline({
  values,
  months,
  tone = 'neutral',
  signature,
  curve = curveMonotoneX,
  fillOpacity,
  showHighlight = false,
  normalise = false,
  label,
  // Zero on every side by default, so a KPI card's sparkline sits flush with
  // the card's edges. A caller that draws something at the last point — an end
  // dot — has to inset by at least its radius, or half of it is cut off.
  margin = { top: 2, right: 0, bottom: 0, left: 0 },
  className = 'mini',
  children,
}) {
  if (!values || values.length < 2) return null;

  let plotted = values;
  if (normalise) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    plotted = values.map((v) => (v - lo) / span);
  }

  // AreaChart's x-scale is time. When the caller knows which months its values
  // belong to it passes them, and the hover label can name a real month;
  // otherwise the dates are arbitrary — as many consecutive months as there
  // are values, ending now — because the shape is the point, not the calendar.
  let data;
  if (months && months.length === values.length) {
    data = months.map((month, i) => ({ date: monthDate(month), v: plotted[i] }));
  } else {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - values.length + 1, 1);
    data = plotted.map((v, i) => ({
      date: monthDate(
        `${start.getFullYear() + Math.floor((start.getMonth() + i) / 12)}-${String(
          ((start.getMonth() + i) % 12) + 1,
        ).padStart(2, '0')}`,
      ),
      v,
    }));
  }

  const color = toneColor(tone);

  return (
    <div className={className} role={label ? 'img' : undefined} aria-label={label}>
      <AreaChart
        data={data}
        aspectRatio={undefined}
        style={{ width: '100%', height: '100%' }}
        revealSignature={signature}
        margin={margin}
      >
        {children}
        <Area
          dataKey="v"
          curve={curve}
          stroke={color}
          fill={color}
          strokeWidth={1.8}
          fillOpacity={fillOpacity ?? OPACITY[tone] ?? OPACITY.neutral}
          showHighlight={showHighlight}
        />
      </AreaChart>
    </div>
  );
}
