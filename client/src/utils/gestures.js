import { useEffect, useRef, useState } from 'react';

// Pull down to refresh, for the phone shell.
//
// It exists because the phone lost a control the desktop kept: the refresh
// button had to move into the overflow menu to stop the top bar overflowing at
// 393px, which left the thing you do most often behind two taps.
//
// There was a swipe-to-change-month here too. It went: swiping a row aside to
// delete it is the gesture a phone already means, and a page-wide month swipe
// can only ever be in a fight with it — see SwipeToDelete.

// How far the finger travels before the page moves at all, and how far it can
// go before the pull stops following. Resistance past the trigger point is what
// tells a thumb it has gone far enough without needing a label.
const PULL_TRIGGER = 72;
const PULL_MAX = 110;

// Returns how far the page is currently pulled down, so the caller can draw
// something at that offset. Only ever non-zero on a touch device at the very
// top of the page.
export function usePullToRefresh(enabled, onRefresh) {
  const [pull, setPull] = useState(0);
  const state = useRef({ startY: 0, tracking: false });

  useEffect(() => {
    if (!enabled) return undefined;

    const down = (e) => {
      // Only from a standing start at the top. Beginning a pull halfway down a
      // list means fighting the scroll the whole way.
      if (e.touches.length !== 1 || window.scrollY > 0) {
        state.current.tracking = false;
        return;
      }
      if (e.target.closest('.modal, .sheet, .backdrop')) {
        state.current.tracking = false;
        return;
      }
      state.current = { startY: e.touches[0].clientY, tracking: true };
    };

    const move = (e) => {
      if (!state.current.tracking) return;
      const dy = e.touches[0].clientY - state.current.startY;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      // Square-rooted rather than linear: the page follows the finger closely
      // at first and then increasingly refuses, which is how far enough
      // announces itself without a word on screen.
      setPull(Math.min(PULL_MAX, Math.sqrt(dy) * 8));
    };

    const up = () => {
      if (!state.current.tracking) return;
      state.current.tracking = false;
      setPull((current) => {
        if (current >= PULL_TRIGGER) onRefresh();
        return 0;
      });
    };

    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up, { passive: true });
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [enabled, onRefresh]);

  return { pull, armed: pull >= PULL_TRIGGER };
}
