import { useRef, useState } from 'react';
import { Trash } from './icons';

// Drag a row aside to delete it.
//
// The page briefly had a swipe of its own to change month, which meant a swipe
// on a row changed the month instead of deleting anything. That one is gone:
// horizontally, a phone list row slides and the page under it does not, so the
// row is the only thing here that answers to a sideways drag.
//
// Releasing past the threshold deletes without asking. That is only reasonable
// because the undo toast is already there to catch it; a swipe is easy to do by
// accident, and this pairs an easy mistake with an easy way back rather than
// with a dialog.
//
// Phone only. A pointer has a delete button on every row already.
//
// Two numbers, deliberately kept apart: how far the finger actually went, and
// how far the row is drawn. They were the same value once, with the drawn one
// eased — and the easing had its sign inverted, so past the threshold the row
// crept backwards, capped short of the trigger, and delete could never fire.
// A cosmetic mistake disabled the action because the action was reading the
// cosmetics. It asks the finger now.
const THRESHOLD = 96;
const MAX = 150;
// How much of the drag past the threshold the row still follows. Enough to
// stay alive under the thumb, little enough to feel like it has arrived.
const RESIST = 0.35;

const drawFor = (travel) =>
  Math.max(MAX * -1, travel > -THRESHOLD ? travel : -THRESHOLD + (travel + THRESHOLD) * RESIST);

export default function SwipeToDelete({ onDelete, disabled = false, children }) {
  const [travel, setTravel] = useState(0);
  const [going, setGoing] = useState(false);
  const start = useRef(null);
  // Set the moment a drag turns horizontal, and read by the click handler
  // underneath: without it, letting go at the end of a swipe also counts as a
  // tap on the row and opens the editor behind the row that just left.
  const dragged = useRef(false);

  if (disabled) return children;

  const armed = -travel >= THRESHOLD;

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, decided: null };
  };

  const onTouchMove = (e) => {
    if (!start.current) return;
    const moveX = e.touches[0].clientX - start.current.x;
    const moveY = e.touches[0].clientY - start.current.y;

    // Which way this drag is going gets decided once, on the first movement
    // that is clearly one or the other, and then held. Deciding every frame
    // makes a diagonal drag flicker between scrolling and sliding.
    if (start.current.decided === null) {
      if (Math.abs(moveX) < 8 && Math.abs(moveY) < 8) return;
      start.current.decided = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
    }
    if (start.current.decided !== 'x') return;
    dragged.current = true;

    // Leftwards only. What is stored is the finger, not the drawing.
    setTravel(Math.min(0, moveX));
  };

  const onTouchEnd = () => {
    const decided = start.current?.decided;
    start.current = null;
    if (decided !== 'x' || !armed) {
      setTravel(0);
      return;
    }
    // Slid the rest of the way out first, so the row leaves rather than
    // vanishing under the finger.
    setGoing(true);
    setTravel(-MAX * 3);
    onDelete();
  };

  return (
    <div className="swipe-row">
      <div className={armed ? 'swipe-action armed' : 'swipe-action'} aria-hidden="true">
        <Trash size={17} />
      </div>
      <div
        className="swipe-front"
        onClickCapture={(e) => {
          // A swipe ends with a touchend the browser also reports as a click.
          if (!dragged.current) return;
          dragged.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{
          transform: `translateX(${going ? -MAX * 3 : drawFor(travel)}px)`,
          // Follows the finger exactly while dragging; eases only when it is
          // springing back or leaving.
          transition: start.current ? 'none' : 'transform .22s cubic-bezier(.2,.8,.3,1)',
          opacity: going ? 0 : 1,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
