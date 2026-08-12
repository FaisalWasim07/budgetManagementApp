import { formatMonth, shiftMonth, currentMonth, shortMonth } from '../utils/month';
import { ChevronLeft, ChevronRight } from './icons';

export default function MonthSelector({ month, onChange }) {
  const isCurrent = month === currentMonth();

  return (
    <div className="month-nav">
      <button onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
        <ChevronLeft />
      </button>
      {/* The label doubles as the way back: once you have wandered off into
          March, "this month" is the thing you want next. */}
      <button
        className="m"
        onClick={() => onChange(currentMonth())}
        disabled={isCurrent}
        title={isCurrent ? undefined : 'Back to this month'}
      >
        {/* Both labels are rendered and CSS picks one: "August 2026" wraps to
            two lines in a phone's top bar, and "Aug 2026" is a waste of the
            room a laptop has. */}
        <span className="long">{formatMonth(month)}</span>
        <span className="short">{`${shortMonth(month)} ${month.split('-')[0]}`}</span>
      </button>
      <button onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month">
        <ChevronRight />
      </button>
    </div>
  );
}
