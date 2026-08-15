import { Money, useDisplay } from '../utils/display';
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
//
// Each bar sits in a track rather than floating on the card: the empty part of
// the track is what makes a tall month read as tall. The month you are in is
// the one picked out, not the dearest — the dearest is already the tallest bar
// and does not need a second colour to say so.
export default function RecurringYear({ items, rateFor, currency, month }) {
  const { money } = useDisplay();
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

  return (
    <section className="card">
      <div className="panel-h">
        The next twelve months
        <small>
          Yearly charges are the ones that surprise you — here they are, in the month they land
        </small>
      </div>

      <div className="strip">
        {months.map((m, i) => (
          <div className={i === 0 ? 'now' : ''} key={m}>
            {/* The figure on hover, because a bar you cannot read the value of
                only answers "which month is worst", not "by how much". The
                same text is the title, so it is reachable without a mouse. */}
            <i title={`${formatMonth(m)} · ${money(totals[i], currency, { compact: true })}`}>
              <b style={{ height: `${Math.max(4, (totals[i] / peak) * 100)}%` }} />
              <em>
                <Money amount={totals[i]} currency={currency} compact />
              </em>
            </i>
            <small>{shortMonth(m)}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
