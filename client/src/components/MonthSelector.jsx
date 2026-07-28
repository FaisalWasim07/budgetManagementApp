import { formatMonth, shiftMonth } from '../utils/month';

export default function MonthSelector({ month, onChange }) {
  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <button onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
        ←
      </button>
      <h2 style={{ minWidth: 200, textAlign: 'center' }}>{formatMonth(month)}</h2>
      <button onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month">
        →
      </button>
    </div>
  );
}
