import { useCallback, useRef, useState } from 'react';
import { PieChart, PieSlice } from '../../vendor/bklit/charts/index.js';
import { Money } from '../../utils/display';
import { categoricalColors } from '../../utils/palette';
import { formatMonth } from '../../utils/month';

// Six named slices and a remainder. A donut answers "what share of the month
// was this" at a glance, which is the question a category breakdown is for;
// the ranking it is bad at — was rent bigger than groceries — is answered by
// the legend beside it, which is sorted and carries the amounts.
//
// PieChart, not RingChart: bklit's Ring is a concentric progress ring — each
// one its own radius, scaled against its own maxValue, the Apple-Watch-rings
// shape — and a single category at 100% of the month sent it a full-circle
// sweep it renders as NaN. PieChart's arc() layout is the one that actually
// divides one ring into proportional slices.
const MAX_SLICES = 6;
const REST = 'var(--ink-3)';

// bklit's PieChart takes a pixel size, not a CSS width: given `size` it draws
// a box of exactly that many pixels and ignores whatever the stylesheet has
// done to its container. Hard-coding 148 here meant the phone breakpoint's
// 124px `.donut` had a 148px ring hanging out of it — the ring overflowed to
// the right and the centre label, which centres on the CSS box rather than on
// the drawn circle, sat a dozen pixels left of the hole it belongs in.
//
// So the stylesheet stays the one place the size is decided and the chart is
// told what that came out as. `.donut` has an explicit width, so measuring it
// cannot feed back into its own layout.
const FALLBACK_SIZE = 148;
// Ring thickness as a share of the box, so the donut stays a donut at every
// width instead of thinning to a hoop as the outer radius shrinks and the
// inner one does not.
const INNER = 0.3;
// Both the padding that keeps a hovered slice from being clipped and the
// distance it moves. Ten cost twenty pixels of diameter at every size for an
// effect no phone can trigger.
const HOVER_OFFSET = 6;

// A callback ref, not a ref object read from an effect. The donut is not
// rendered at all until there is something to draw, so on a month that opens
// empty the element arrives several renders after the component mounts — and
// an effect whose only dependency is a ref object runs once, on mount, when
// there is nothing there yet to measure, and never runs again. The chart then
// keeps the fallback size for as long as the page is open. A callback ref is
// called by React when the element itself attaches, which is the moment there
// is something to measure.
function useBoxSize() {
  const [size, setSize] = useState(FALLBACK_SIZE);
  const watching = useRef(null);

  const ref = useCallback((el) => {
    if (watching.current) {
      watching.current.disconnect();
      watching.current = null;
    }
    if (!el) return;
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) setSize(Math.round(width));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // Keeps up with the breakpoint being crossed, a phone being turned, and
    // the sidebar opening — all of which change the box without remounting it.
    watching.current = new ResizeObserver(measure);
    watching.current.observe(el);
  }, []);

  return [ref, size];
}

export default function CategoryChart({ categories, currency, month }) {
  const [box, size] = useBoxSize();
  // Which slice the cursor is on, held here rather than inside the chart.
  // bklit's PieChart keeps this itself and offers it as a controlled pair, and
  // the pair is what the centre needs: hovering a slice should answer "how much
  // was that one" without moving the eye off the ring.
  //
  // It doubles as the link between the ring and its legend — hovering either
  // lights the other, so a thin slice can still be found by its name.
  const [hovered, setHovered] = useState(null);
  const colors = categoricalColors();
  const named = categories.slice(0, MAX_SLICES);
  const rest = categories.slice(MAX_SLICES).reduce((sum, c) => sum + c.amount, 0);

  const data = [
    ...named.map((c, i) => ({ ...c, color: colors[i % colors.length] })),
    ...(rest > 0 ? [{ category: 'Everything else', amount: rest, color: REST }] : []),
  ];
  const total = data.reduce((sum, c) => sum + c.amount, 0);
  // PieSlice's own `color` prop only reaches its hover glow — the fill it
  // actually paints comes from `getFill`, which reads `color` off the DATA
  // ITEM first and only falls back to bklit's own --chart-1..5 palette
  // (which Bayt has no reason to define, since it already has one). Carrying
  // color on the row is the documented way in, and the one that works.
  const pieData = data.map((c) => ({ label: c.category, value: c.amount, color: c.color }));

  return (
    <div className="chart">
      <h3>Where it went</h3>
      <p className="sub">{formatMonth(month)}, biggest first</p>

      {data.length === 0 ? (
        <p className="muted" style={{ fontSize: '.88rem' }}>
          Nothing spent this month.
        </p>
      ) : (
        <div className="donut-wrap">
          <div className="donut" ref={box}>
            {/* Explicit 0 → 2π: bklit's default is startAngle=−π/2 with a
                comment claiming "top", but d3-shape's arc convention treats
                0 as 12 o'clock, so its default puts the first slice at 9
                o'clock and the whole donut reads as tilted a quarter-turn.
                Starting at 12 is what every pie chart in the world does. */}
            <PieChart
              data={pieData}
              size={size}
              innerRadius={size * INNER}
              hoverOffset={HOVER_OFFSET}
              hoveredIndex={hovered}
              onHoverChange={setHovered}
              startAngle={0}
              endAngle={2 * Math.PI}
            >
              {pieData.map((item, i) => (
                <PieSlice index={i} key={item.label} />
              ))}
            </PieChart>
            {/* Not <PieCenter>: its own built-in content is NumberFlow, which
                knows nothing about the privacy toggle or a currency symbol —
                and its render-prop override only fires while a slice is
                actively hovered, defaulting back to that same unmasked number
                the rest of the time, which is most of the time. This sibling
                span is exactly what sat over the hand-drawn donut before;
                <Money> already knows how to become dots when the eye is
                clicked, which is the property that matters here. */}
            {/* What the ring is being asked about. Resting, that is the month;
                hovering, it is the slice under the cursor — which is the whole
                point of a donut having a hole in it. */}
            <span className="donut-centre">
              <small>{hovered == null ? 'went out' : data[hovered]?.category}</small>
              <Money
                amount={hovered == null ? total : data[hovered]?.amount}
                currency={currency}
                compact
              />
            </span>
          </div>

          <ul className="donut-legend">
            {data.map((slice, i) => (
              <li
                key={slice.category}
                className={hovered === i ? 'on' : hovered == null ? '' : 'off'}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <i style={{ background: slice.color }} />
                <span className="n">{slice.category}</span>
                <span className="p">
                  {total > 0 ? Math.round((slice.amount / total) * 100) : 0}%
                </span>
                <span className="a">
                  <Money amount={slice.amount} currency={currency} compact />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
