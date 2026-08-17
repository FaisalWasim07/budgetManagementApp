import { useEffect, useRef, useState } from 'react';

// Touch gestures for the phone shell.
//
// Both of these exist because the phone lost a control the desktop kept. The
// month arrows are folded away until the month disagrees with today, and the
// refresh button had to move into the overflow menu to stop the top bar
// overflowing at 393px — so the two things you do most often are the two that
// take the most taps to reach. A swipe and a pull put them back.

// Below this a touch is a tap that wobbled, not a swipe.
const SWIPE_MIN = 60;
// A swipe that drifts this far vertically was a scroll that happened to start
// sideways, and taking the month off someone mid-scroll is worse than missing
// a gesture.
const SWIPE_MAX_DRIFT = 45;

// How far the finger travels before the page moves at all, and how far it can
// go before the pull stops following. Resistance past the trigger point is what
// tells a thumb it has gone far enough without needing a label.
const PULL_TRIGGER = 72;
const PULL_MAX = 110;

export function useSwipeMonth(enabled, onSwipe) {
  useEffect(() => {
    if (!enabled) return undefined;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const down = (e) => {
      if (e.touches.length !== 1) return;
      // Not from inside something that scrolls sideways of its own accord —
      // the twelve-month strip is exactly that, and stealing its drag would
      // make it impossible to read.
      if (e.target.closest('.year-strip, .modal, .sheet, input, select, textarea')) {
        tracking = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    };
    const up = (e) => {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dy) > SWIPE_MAX_DRIFT) return;
      // Left means forward, the way a page turns.
      onSwipe(dx < 0 ? 1 : -1);
    };

    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchend', up, { passive: true });
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchend', up);
    };
  }, [enabled, onSwipe]);
}

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
