import { useState } from 'react';
import Modal from './Modal';
import { formatMonth, currentMonth } from '../utils/month';
import { ChevronDown, ChevronLeft, ChevronRight } from './icons';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// The same year stepper and grid the top bar uses, as a form field. A browser's
// own month control is a dropdown of numbers in Chrome, a plain text box in
// Firefox, and a wheel on a phone — three different things, none of them the
// one the rest of the app already uses to pick a month.
//
// `min` and `max` are month strings; anything outside them is shown but not
// selectable, so the limits are visible rather than discovered by being
// refused.
export default function MonthPicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Any month',
  clearable = false,
  disabled = false,
  label,
}) {
  const [open, setOpen] = useState(false);
  const now = currentMonth();
  const [year, setYear] = useState(() => Number((value || now).split('-')[0]));

  const [selectedYear, selectedIndex] = value
    ? [Number(value.split('-')[0]), Number(value.split('-')[1]) - 1]
    : [null, null];
  const [nowYear, nowIndex] = [Number(now.split('-')[0]), Number(now.split('-')[1]) - 1];

  const monthAt = (index) => `${year}-${String(index + 1).padStart(2, '0')}`;
  const blocked = (index) => {
    const at = monthAt(index);
    return Boolean((min && at < min) || (max && at > max));
  };

  const pick = (index) => {
    if (blocked(index)) return;
    onChange(monthAt(index));
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={value ? 'month-field' : 'month-field empty'}
        disabled={disabled}
        onClick={() => {
          setYear(Number((value || now).split('-')[0]));
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-label={label}
      >
        <span>{value ? formatMonth(value) : placeholder}</span>
        <ChevronDown />
      </button>

      {open && (
        <Modal title={label ?? 'Which month?'} onClose={() => setOpen(false)}>
          <div className="year-nav">
            <button type="button" onClick={() => setYear(year - 1)} aria-label="Previous year">
              <ChevronLeft />
            </button>
            <b>{year}</b>
            <button type="button" onClick={() => setYear(year + 1)} aria-label="Next year">
              <ChevronRight />
            </button>
          </div>

          <div className="month-grid">
            {MONTHS.map((name, index) => {
              const isSelected = year === selectedYear && index === selectedIndex;
              const isNow = year === nowYear && index === nowIndex;
              return (
                <button
                  type="button"
                  key={name}
                  className={`${isSelected ? 'selected' : ''}${isNow ? ' now' : ''}`}
                  aria-current={isSelected ? 'true' : undefined}
                  disabled={blocked(index)}
                  onClick={() => pick(index)}
                >
                  {name}
                </button>
              );
            })}
          </div>

          {clearable && value && (
            <button
              type="button"
              className="subtle"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              No end — runs until I stop it
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
