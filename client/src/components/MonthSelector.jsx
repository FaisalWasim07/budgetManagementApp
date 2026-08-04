import { formatMonth, shiftMonth, currentMonth } from '../utils/month';

export default function MonthSelector({ month, onChange }) {
  const isCurrent = month === currentMonth();

  return (
    <div className="row-tight">
      <button onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
        ←
      </button>
      <strong style={{ minWidth: 160, textAlign: 'center' }}>{formatMonth(month)}</strong>
      <button onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month">
        →
      </button>
      {!isCurrent && (
        <button className="subtle tiny" onClick={() => onChange(currentMonth())}>
          Today
        </button>
      )}
    </div>
  );
}
