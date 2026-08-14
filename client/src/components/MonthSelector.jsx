import { useState } from 'react';
import Modal from './Modal';
import { formatMonth, currentMonth, shortMonth } from '../utils/month';
import { ChevronDown, ChevronLeft, ChevronRight } from './icons';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// The month is a label you tap, not a pair of arrows either side of a pill.
//
// Arrows are the wrong tool for this: they cost a tap per month, so March is
// five taps from August and there is no way to see where you are in a year.
// A grid is one tap to anywhere, and it fits a phone's top bar as a few words
// rather than a bar of its own.
export default function MonthSelector({ month, onChange }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(month.split('-')[0]));

  const now = currentMonth();
  const [currentYear, currentIndex] = [Number(now.split('-')[0]), Number(now.split('-')[1]) - 1];
  const [selectedYear, selectedIndex] = [
    Number(month.split('-')[0]),
    Number(month.split('-')[1]) - 1,
  ];

  const pick = (index) => {
    onChange(`${year}-${String(index + 1).padStart(2, '0')}`);
    setOpen(false);
  };

  return (
    <>
      <button
        className="month-trigger"
        onClick={() => {
          setYear(selectedYear);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        title="Choose a month"
      >
        <span className="long">{formatMonth(month)}</span>
        <span className="short">{`${shortMonth(month)} ${selectedYear}`}</span>
        <ChevronDown />
      </button>

      {open && (
        <Modal title="Which month?" onClose={() => setOpen(false)}>
          <div className="year-nav">
            <button onClick={() => setYear(year - 1)} aria-label="Previous year">
              <ChevronLeft />
            </button>
            <b>{year}</b>
            <button onClick={() => setYear(year + 1)} aria-label="Next year">
              <ChevronRight />
            </button>
          </div>

          <div className="month-grid">
            {MONTHS.map((label, index) => {
              const isSelected = year === selectedYear && index === selectedIndex;
              const isNow = year === currentYear && index === currentIndex;
              return (
                <button
                  key={label}
                  className={`${isSelected ? 'selected' : ''}${isNow ? ' now' : ''}`}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => pick(index)}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* However far you have wandered, one tap back. */}
          {month !== now && (
            <button
              className="subtle"
              onClick={() => {
                onChange(now);
                setOpen(false);
              }}
            >
              Back to this month
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
