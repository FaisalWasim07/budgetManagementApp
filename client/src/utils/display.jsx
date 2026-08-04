import { createContext, useContext } from 'react';
import { formatCurrency } from './currency';

export const MASK = '*****';

export const DisplayContext = createContext({ amountsHidden: false });

// Every amount on screen goes through `money()` so the privacy toggle has a
// single place to hide them — components never format currency directly.
export function useDisplay() {
  const { amountsHidden } = useContext(DisplayContext);
  const money = (amount, currency, options) =>
    amountsHidden ? MASK : formatCurrency(amount, currency, options);
  return { amountsHidden, money };
}
