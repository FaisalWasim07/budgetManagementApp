import { useRef, useState } from 'react';
import { listCategories } from '../api/transactions';
import { useLive } from '../utils/live';

const NEW = '__new';

// The one way a category is chosen anywhere in the app: a dropdown of every
// category the household has used, most used first and per kind, with
// "New category…" at the bottom opening a box to type one. The add sheet, the
// edit dialog and the recurring form all use it, so a category picked in one
// is offered in the others, and none of them asks you to remember how you
// spelled "Groceries" last time.
//
// A value already set that the list does not carry (an old entry under a
// category nobody has used since) stays selectable rather than being shown as
// blank, which would read as "no category" and be saved as one.
export default function CategoryPicker({ kind = 'expense', value, onChange, onEnter, id }) {
  const [typing, setTyping] = useState(false);
  const box = useRef(null);
  // Live, so one typed in here is in the list the next time any of them opens.
  const { data: used } = useLive('categories', listCategories);
  const listed = used?.[kind === 'income' ? 'income' : 'expense'] ?? [];
  const current = (value ?? '').trim();
  const choices = current && !listed.includes(current) && !typing ? [current, ...listed] : listed;

  const pick = (next) => {
    if (next === NEW) {
      setTyping(true);
      onChange('');
      setTimeout(() => box.current?.focus(), 0);
    } else {
      setTyping(false);
      onChange(next);
    }
  };

  return (
    <>
      <select
        id={id}
        value={typing ? NEW : current}
        onChange={(e) => pick(e.target.value)}
        aria-label="Category"
      >
        <option value="">No category</option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={NEW}>New category…</option>
      </select>
      {typing && (
        <div className="new-category">
          <input
            ref={box}
            type="text"
            placeholder={kind === 'income' ? 'e.g. Salary' : 'e.g. Groceries'}
            value={value}
            maxLength={60}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onEnter?.(e)}
            aria-label="New category"
          />
          <button
            type="button"
            className="subtle tiny"
            onClick={() => {
              setTyping(false);
              onChange('');
            }}
          >
            Back to list
          </button>
        </div>
      )}
    </>
  );
}
