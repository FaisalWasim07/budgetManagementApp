import { curveMonotoneX } from '@visx/curve';
import { AreaChart, Area } from '../../vendor/bklit/charts/index.js';
import { monthDate } from '../../utils/month';

// A twelve-point sparkline drawn by bklit's AreaChart, dressed down to the
// smallest thing that reads as a shape: no axes, no grid, no hover, just the
// line over its own fill. `tone` decides the colour, so a rising expense line
// paints red and a rising net-worth line paints green — the colour is the
// alarm, not a decoration.
//
// `signature` re-plays the draw-in when the month changes: bklit re-animates
// whenever its `revealSignature` prop changes value. Without it, switching
// months would swap in the new numbers with no motion at all.
const TONES = {
  up: 'var(--pos)',
  down: 'var(--neg)',
  flat: 'var(--ink-3)',
  neutral: 'var(--ink-3)',
};

const OPACITY = {
  up: 0.13,
  down: 0.11,
  flat: 0.1,
  neutral: 0.1,
};

export default function Sparkline({ values, tone = 'neutral', signature }) {
  if (!values || values.length < 2) return null;

  // AreaChart's x-scale is time, so plot one point a month and let bklit map
  // them along the axis. The dates are arbitrary — twelve consecutive months
  // ending now — the shape is the point, not the calendar.
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - values.length + 1, 1);
  const data = values.map((v, i) => ({
    date: monthDate(
      `${start.getFullYear() + Math.floor((start.getMonth() + i) / 12)}-${String(
        ((start.getMonth() + i) % 12) + 1,
      ).padStart(2, '0')}`,
    ),
    v,
  }));

  const color = TONES[tone] ?? TONES.neutral;

  return (
    <div className="mini">
      <AreaChart
        data={data}
        aspectRatio={undefined}
        style={{ width: '100%', height: '100%' }}
        revealSignature={signature}
        margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
      >
        <Area
          dataKey="v"
          curve={curveMonotoneX}
          stroke={color}
          fill={color}
          strokeWidth={1.8}
          fillOpacity={OPACITY[tone] ?? OPACITY.neutral}
          showHighlight={false}
        />
      </AreaChart>
    </div>
  );
}
