import NumberFlow from '@number-flow/react';
import { useContext } from 'react';
import { DisplayContext, Money } from '../../utils/display';

// A KPI's big figure. The dust reveal that <Money> does when the eye is
// clicked is preserved unchanged: this only replaces the printed number when
// amounts are visible with one that rolls between values instead of swapping.
// So on load the value counts up from zero to its real height, and when the
// month changes the digits reshape rather than blink.
//
// Two callers today: money and percent. Both share the same NumberFlow shape
// with different format options.
export function KpiMoney({ amount, currency }) {
  const { amountsHidden } = useContext(DisplayContext);
  // Under the mask the dust animation IS the animation, so nothing here
  // fights it. Rolling from `••••` to a number would be a race between two
  // reveals and would win neither.
  if (amountsHidden || amount == null || Number.isNaN(amount)) {
    return <Money amount={amount} currency={currency} compact />;
  }
  return (
    <NumberFlow
      value={amount}
      format={{
        style: 'currency',
        currency: currency || 'AED',
        maximumFractionDigits: 0,
      }}
      willChange
    />
  );
}

// A share, not a currency. Kept out of the mask because a share of what came
// in gives away no amount and reads over a shoulder without cost — the same
// reason <Kpi label="Kept"> uses no <Money>.
export function KpiPercent({ value }) {
  if (value == null || Number.isNaN(value)) {
    return <span className="muted">—</span>;
  }
  return (
    <NumberFlow
      value={Math.round(value) / 100}
      format={{
        style: 'percent',
        maximumFractionDigits: 0,
      }}
      willChange
    />
  );
}
