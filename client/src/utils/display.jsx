import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { formatCurrency } from './currency';
import { dust } from './dust';

export const MASK = '••••';

export const DisplayContext = createContext({ amountsHidden: true });

// Every amount on screen goes through here, so the privacy toggle has a single
// place to hide them — components never format currency themselves.
//
// `money()` returns a string, for the places an amount is part of a sentence,
// an aria-label or a chart tick. `<Money>` is the same thing as an element, and
// is what the figures on the dashboard use: only an element can be turned to
// dust when the eye is clicked.
export function useDisplay() {
  const { amountsHidden } = useContext(DisplayContext);
  const money = (amount, currency, options) =>
    amountsHidden ? MASK : formatCurrency(amount, currency, options);
  return { amountsHidden, money };
}

export function Money({
  amount,
  currency,
  compact = false,
  prefix = '',
  suffix = '',
  className = '',
}) {
  const { amountsHidden } = useContext(DisplayContext);
  const real =
    amount == null || Number.isNaN(amount)
      ? '—'
      : `${prefix}${formatCurrency(amount, currency, { compact })}${suffix}`;
  const target = amountsHidden ? MASK : real;

  const box = useRef(null);
  const host = useRef(null);
  const was = useRef(amountsHidden);
  // `flash` only ever increments, and only when the eye was clicked: it keys
  // the inner span so the new figure remounts and plays its reveal. A figure
  // that merely changed because the data reloaded must not flash.
  const [shown, setShown] = useState({ text: target, flash: 0 });

  useEffect(() => {
    if (was.current === amountsHidden) {
      setShown((current) => (current.text === target ? current : { ...current, text: target }));
      return undefined;
    }
    was.current = amountsHidden;

    let live = true;
    dust(box.current, host.current).then(() => {
      if (live) setShown((current) => ({ text: target, flash: current.flash + 1 }));
    });
    return () => {
      live = false;
    };
  }, [amountsHidden, target]);

  // Driven by what is on screen rather than by the toggle: applying the masked
  // colour the instant the eye is clicked would recolour the figure grey for
  // the frame before it is rasterised, and the dust would come out grey.
  const masked = shown.text === MASK;

  return (
    <span
      className={`money num${masked ? ' masked' : ''}${className ? ` ${className}` : ''}`}
      ref={box}
    >
      <span className={shown.flash ? 'fig reveal' : 'fig'} key={shown.flash}>
        {shown.text}
      </span>
      <span className="dust-host" ref={host} aria-hidden="true" />
    </span>
  );
}
