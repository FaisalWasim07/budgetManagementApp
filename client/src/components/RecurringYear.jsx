import { Money } from '../utils/display';
import { shiftMonth, shortMonth, formatMonth } from '../utils/month';
import { dueIn, convert } from '../utils/recurring';

// Twelve bars, this month forward. Monthly items make a flat floor; the point
// is the months standing above it, where a yearly renewal lands. That is
// information you cannot get from a list sorted any way at all, and it is the
// difference between being surprised by March and expecting it.
//
// It used to hide itself when every item was monthly, on the grounds that
// twelve identical bars say nothing. But the twelve months are also how you
// see an item ending — the floor drops the month after it stops — and a strip
// that comes and goes is one you never learn to look at. It stays.
export default function RecurringYear({ items, rateFor, currency, month }) {
  if (items.length === 0) return null;

  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i));
  const totals = months.map((m) =>
    items.reduce(
      (sum, item) => (dueIn(item, m) ? sum + (convert(item.amount, rateFor(item)) || 0) : sum),
      0
    )
  );

  const peak = Math.max(...totals);
  if (!(peak > 0)) return null;

  const dearest = totals.indexOf(peak);
  const floor = Math.min(...totals);

  return (
    <section className="card">
      <div className="flow-top">
        <h2>The year ahead</h2>
        <span className="muted" style={{ fontSize: '.8rem' }}>
          {peak > floor
            ? `${formatMonth(months[dearest]).split(' ')[0]} is the expensive one`
            : 'The same every month'}
        </span>
      </div>

      <div className="year">
        {months.map((m, i) => (
          <div className={i === dearest && peak > floor ? 'mo peak' : 'mo'} key={m}>
            <div className="col" title={`${formatMonth(m)}`}>
              <span style={{ height: `${peak > 0 ? Math.max(3, (totals[i] / peak) * 100) : 3}%` }} />
            </div>
            <span className="m">{shortMonth(m)}</span>
          </div>
        ))}
      </div>

      <p className="muted" style={{ fontSize: '.8rem', margin: '12px 0 0' }}>
        {peak > floor ? (
          <>
            Highest is {formatMonth(months[dearest])} at{' '}
            <Money amount={peak} currency={currency} compact />.
          </>
        ) : (
          <>
            <Money amount={peak} currency={currency} compact /> every month for the next year.
          </>
        )}
      </p>
    </section>
  );
}
