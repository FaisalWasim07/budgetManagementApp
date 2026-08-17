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
const THRESHOLD = 96;
const MAX = 132;

export default function SwipeToDelete({ onDelete, disabled = false, children }) {
  const [dx, setDx] = useState(0);
  const [going, setGoing] = useState(false);
  const start = useRef(null);

  if (disabled) return children;

  const armed = -dx >= THRESHOLD;

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

    // Leftwards only, and it stiffens past the point where it would fire so
    // the thumb can feel the threshold rather than having to watch for it.
    const next = Math.max(-MAX, Math.min(0, moveX));
    setDx(next < -THRESHOLD ? -THRESHOLD - (next + THRESHOLD) / 3 : next);
  };

  const onTouchEnd = () => {
    const decided = start.current?.decided;
    start.current = null;
    if (decided !== 'x') return setDx(0);
    if (!armed) return setDx(0);
    // Slid the rest of the way out first, so the row leaves rather than
    // vanishing under the finger.
    setGoing(true);
    setDx(-MAX * 2);
    onDelete();
  };

  return (
    <div className="swipe-row">
      <div className={armed ? 'swipe-action armed' : 'swipe-action'} aria-hidden="true">
        <Trash size={17} />
      </div>
      <div
        className="swipe-front"
        style={{
          transform: `translateX(${dx}px)`,
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
