import { useCallback, useContext, useState } from 'react';
import { curveCardinal } from '@visx/curve';
import { DisplayContext, Money } from '../../utils/display';
import { ChartStatFlow } from '../../vendor/bklit/charts/index.js';
import { StatCardHoverBridge, formatStatCardMonth } from '../../vendor/bklit/blocks/index.js';
import { formatMonth } from '../../utils/month';
import Sparkline from './Sparkline';

// Bayt's adaptation of bklit's `@bklit/stat-card-area-01`. The block's shape is
// kept whole — a title with a trend badge, a NumberFlow figure over a small
// caption, and an area chart bled to the card's edges whose hover drives all
// three — and everything the block drew with shadcn is drawn with Bayt's own
// CSS instead: `.kpi` for shadcn's Card, `.kpi-badge` for its Badge, `.kpi
// .mini` for its StatCardChart, and the arrows are characters rather than an
// icon package. See ../../vendor/bklit/blocks/index.js.
//
// Two things the block knows nothing about and must not lose:
//
//   * the privacy toggle — under the mask the figure is <Money>, whose dust
//     reveal IS the animation, and NumberFlow stays out of its way;
//   * `revealSignature` — without it, changing month swaps the numbers in with
//     no draw-in at all.
//
// Whether a move up is a good move depends on the figure: net worth rising is
// good, spending rising is not. `higherIsBetter` is what decides the colour, so
// nothing here has to hard-code green.
const EMPTY_HOVER = { value: null, label: null, trend: null };

function toneOf(delta, higherIsBetter) {
  if (delta == null) return 'flat';
  return delta > 0 === higherIsBetter ? 'up' : 'down';
}

export default function StatCard({
  title,
  values,
  months,
  current,
  previous,
  higherIsBetter,
  month,
  format,
  currency,
  kind = 'money',
  absolute = false,
}) {
  const { amountsHidden } = useContext(DisplayContext);
  const [hover, setHover] = useState(EMPTY_HOVER);

  // The bridge reports "nothing hovered" on every one of its effect runs, and
  // it re-runs whenever the chart's data identity changes — which, for a
  // sparkline whose points are rebuilt from props each render, is every render.
  // Bailing out of the state update when nothing actually changed is what stops
  // that becoming a render loop.
  const onHoverChange = useCallback((next) => {
    setHover((held) =>
      held.value === next.value && held.label === next.label && held.trend === next.trend
        ? held
        : next,
    );
  }, []);

  const has = previous != null && Number.isFinite(previous);
  const change = has ? current - previous : null;
  // A percentage of a number that was zero is not a percentage; those months
  // get the absolute move instead of "∞%". A figure that is already a
  // percentage moves in points, never in a percentage of a percentage.
  const pct =
    has && !absolute && Math.abs(previous) > 0.005 ? (change / Math.abs(previous)) * 100 : null;
  const flat = change != null && Math.abs(change) < 0.005;

  const hovering = hover.value != null;
  const value = hovering ? hover.value : current;
  const sinceMonth = formatMonth(month).split(' ')[0];

  // Hovered: the badge is that point's move on the one before it, always a
  // percentage, and the caption names the month under the cursor. Resting: the
  // card's own move against the previous month, which falls back to an absolute
  // figure when a percentage would be meaningless — that fallback goes through
  // the caller's `format`, which is masked, so it cannot print an amount the
  // eye is meant to be hiding.
  let badge = null;
  let caption;
  if (hovering) {
    caption = hover.label ?? '';
    if (hover.trend != null && Math.abs(hover.trend) >= 0.05) {
      badge = {
        tone: toneOf(hover.trend, higherIsBetter),
        text: `${hover.trend > 0 ? '↑' : '↓'} ${Math.abs(hover.trend).toFixed(0)}%`,
      };
    }
  } else if (change == null) {
    caption = 'no earlier month';
  } else if (flat) {
    caption = `unchanged since ${sinceMonth}`;
  } else {
    caption = `vs ${sinceMonth}`;
    badge = {
      tone: toneOf(change, higherIsBetter),
      text: `${change > 0 ? '↑' : '↓'} ${
        pct == null ? format(Math.abs(change)) : `${Math.abs(pct).toFixed(0)}%`
      }`,
    };
  }

  // The sparkline's colour follows the card's own direction, not the hovered
  // point's: recolouring the whole year as the cursor crosses a dip would make
  // the shape flicker between red and green on the way past.
  const tone = change == null || flat ? 'flat' : toneOf(change, higherIsBetter);

  const missing = value == null || Number.isNaN(value);

  return (
    <div className="kpi">
      <div className="kpi-head">
        <span className="k">{title}</span>
        {badge ? <span className={`kpi-badge ${badge.tone}`}>{badge.text}</span> : null}
      </div>

      {/* Under the mask the dust animation IS the animation, so nothing here
          fights it. Rolling from `••••` to a number would be a race between two
          reveals and would win neither. A share of what came in is not masked
          at all: it gives away no amount, and it is the one figure here worth
          reading over a shoulder. */}
      {missing ? (
        <>
          <span className="v muted">—</span>
          <span className="d">{caption}</span>
        </>
      ) : kind === 'money' && amountsHidden ? (
        <>
          <span className="v">
            <Money amount={value} currency={currency} compact />
          </span>
          <span className="d">{caption}</span>
        </>
      ) : (
        <ChartStatFlow
          value={kind === 'percent' ? Math.round(value) / 100 : value}
          label={caption}
          labelClassName="d"
          valueClassName="v"
          formatOptions={
            kind === 'percent'
              ? { style: 'percent', maximumFractionDigits: 0 }
              : { style: 'currency', currency: currency || 'AED', maximumFractionDigits: 0 }
          }
        />
      )}

      <Sparkline
        values={values}
        months={months}
        tone={tone}
        signature={`${month}-${title}`}
        curve={curveCardinal.tension(0.65)}
        fillOpacity={0.22}
        showHighlight
      >
        <StatCardHoverBridge
          dataKey="v"
          formatLabel={formatStatCardMonth}
          onHoverChange={onHoverChange}
        />
      </Sparkline>
    </div>
  );
}
