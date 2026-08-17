import { useCallback, useEffect, useRef } from 'react';
import { Trash } from './icons';

// Drag a row aside to delete it.
//
// Releasing past the threshold deletes without asking. That is only reasonable
// because the undo toast is already there to catch it; a swipe is easy to do by
// accident, and this pairs an easy mistake with an easy way back rather than
// with a dialog.
//
// Phone only. A pointer has a delete button on every row already.
//
// Nothing here goes through React state, which is the point. A finger moving
// across a phone reports up to 120 times a second, and asking React to
// reconcile a list row at that rate is where the stutter came from. The drag
// writes two custom properties straight onto the element and lets the
// compositor do the rest; React is told nothing until the row actually leaves.
//
// Two numbers, still deliberately apart: how far the finger went, and how far
// the row is drawn. They were one value once, eased, with the easing sign
// inverted — so past the threshold the row crept backwards and could never
// arm. Reading the drawing to decide the action is how a cosmetic mistake
// disables the feature.

const THRESHOLD = 96;
const MAX = 150;
// How much of the drag past the threshold the row still follows. Enough to
// stay alive under the thumb, little enough to feel like it has arrived.
const RESIST = 0.35;
// Long enough to read as the row leaving rather than blinking out, short
// enough that the undo toast is not waiting on it. Must match --swipe-exit.
const EXIT_MS = 260;
// Below this a drag has not said which way it is going yet.
const DECIDE_AT = 8;

const drawFor = (travel) =>
  Math.max(-MAX, travel > -THRESHOLD ? travel : -THRESHOLD + (travel + THRESHOLD) * RESIST);

export default function SwipeToDelete({ onDelete, disabled = false, children }) {
  const root = useRef(null);
  const front = useRef(null);
  // Everything the gesture needs, in one mutable box: none of it should cause
  // a render, and all of it must be readable from a rAF callback.
  const g = useRef({ x: 0, y: 0, axis: null, travel: 0, frame: 0, armed: false, dragged: false });
  const exit = useRef(0);

  useEffect(() => () => {
    cancelAnimationFrame(g.current.frame);
    clearTimeout(exit.current);
  }, []);

  // One write per frame however many events arrived, and only properties the
  // compositor can animate without touching layout.
  const paint = useCallback(() => {
    g.current.frame = 0;
    const { travel } = g.current;
    if (!front.current || !root.current) return;
    front.current.style.transform = `translate3d(${drawFor(travel)}px, 0, 0)`;
    // How far through the gesture we are, for the icon to grow with. Clamped,
    // because past the threshold the answer is simply "all the way".
    root.current.style.setProperty('--reveal', String(Math.min(1, -travel / THRESHOLD)));

    const armed = -travel >= THRESHOLD;
    if (armed !== g.current.armed) {
      g.current.armed = armed;
      root.current.classList.toggle('armed', armed);
      // A real detent on the phones that can do one. The threshold is
      // otherwise something you have to watch for rather than feel.
      if (armed) navigator.vibrate?.(9);
    }
  }, []);

  const schedule = useCallback(() => {
    if (!g.current.frame) g.current.frame = requestAnimationFrame(paint);
  }, [paint]);

  if (disabled) return children;

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    g.current.x = e.touches[0].clientX;
    g.current.y = e.touches[0].clientY;
    g.current.axis = null;
    g.current.travel = 0;
  };

  const onTouchMove = (e) => {
    if (g.current.axis === 'y') return;
    const moveX = e.touches[0].clientX - g.current.x;
    const moveY = e.touches[0].clientY - g.current.y;

    // Which way this drag is going is decided once and then held. Deciding
    // every frame makes a diagonal flicker between scrolling and sliding.
    if (g.current.axis === null) {
      if (Math.abs(moveX) < DECIDE_AT && Math.abs(moveY) < DECIDE_AT) return;
      g.current.axis = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
      if (g.current.axis === 'x') {
        g.current.dragged = true;
        // Transitions off for the duration: while a finger is down the row
        // should be exactly where the finger is, not easing towards it.
        root.current.classList.add('dragging');
      } else {
        return;
      }
    }

    g.current.travel = Math.min(0, moveX);
    schedule();
  };

  const finish = () => {
    const { axis, armed } = g.current;
    g.current.axis = null;
    if (axis !== 'x') return;

    cancelAnimationFrame(g.current.frame);
    g.current.frame = 0;
    root.current.classList.remove('dragging');

    if (!armed) {
      g.current.travel = 0;
      g.current.armed = false;
      root.current.classList.remove('armed');
      root.current.style.setProperty('--reveal', '0');
      front.current.style.transform = 'translate3d(0, 0, 0)';
      return;
    }

    // Out sideways, then the gap closes behind it. Without the second half the
    // row flies off and the list underneath snaps shut, which reads as two
    // unrelated things happening rather than one row leaving.
    //
    // The height has to be a real number before it can be animated to zero, so
    // it is measured and pinned first, and the layout forced before the class
    // that changes it — or the browser coalesces both into one style and there
    // is nothing to transition between.
    const el = root.current;
    el.style.height = `${el.offsetHeight}px`;
    void el.offsetHeight;
    el.classList.add('leaving');
    el.style.height = '0px';
    front.current.style.transform = `translate3d(${-MAX * 2.5}px, 0, 0)`;

    // Told last, so the reload it triggers cannot unmount the row out from
    // under its own animation.
    exit.current = setTimeout(onDelete, EXIT_MS);
  };

  return (
    <div className="swipe-row" ref={root}>
      <div className="swipe-action" aria-hidden="true">
        <Trash size={18} />
      </div>
      <div
        className="swipe-front"
        ref={front}
        onClickCapture={(e) => {
          // A swipe ends with a touchend the browser also reports as a click,
          // which was opening the editor behind the row that had just left.
          if (!g.current.dragged) return;
          g.current.dragged = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={finish}
        onTouchCancel={finish}
      >
        {children}
      </div>
    </div>
  );
}
