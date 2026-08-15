import { useEffect } from 'react';

// Holds the page still while something is open over it.
//
// A dialog that lets the page scroll underneath it reads as two screens fighting
// each other: the wheel goes to whichever the pointer happens to be over, and on
// a phone a flick meant for the sheet takes the whole page with it.
//
// Counted rather than a boolean, because more than one thing can be open at
// once — the month grid opens from inside the recurring form — and the first to
// close must not unlock the page while the second is still up.
let locked = 0;
let restore = '';

function lock() {
  locked += 1;
  if (locked > 1) return;
  const { body } = document;
  // Taking the scrollbar away widens the page by its width, which jolts every
  // fixed element on it. Padding the body by the same amount holds it still.
  const gap = window.innerWidth - document.documentElement.clientWidth;
  restore = body.style.cssText;
  body.style.overflow = 'hidden';
  if (gap > 0) body.style.paddingRight = `${gap}px`;
}

function unlock() {
  locked = Math.max(0, locked - 1);
  if (locked > 0) return;
  document.body.style.cssText = restore;
  restore = '';
}

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    lock();
    return unlock;
  }, [active]);
}
