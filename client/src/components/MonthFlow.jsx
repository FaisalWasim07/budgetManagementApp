import { Money } from '../utils/display';
import { formatMonth } from '../utils/month';

// One gradient across the whole bar rather than four blocks butted together.
// Each colour holds solid through the middle of its share and cross-fades over
// a few percent either side of a join, so the segments melt into each other.
//
// The blend is capped at a third of the smaller neighbour: at 4% of the month,
// subscriptions were otherwise entirely crossfade and lost their own colour.
// The colours go in as var() rather than resolved values, so the bar follows
// the theme without anything having to watch for a theme change.
export function blendedGradient(segments) {
  const blendAt = (a, b) => Math.min(3.2, Math.min(a, b) / 3);
  const stops = [];
  let at = 0;

  segments.forEach((segment, i) => {
    const colour = `var(${segment.token})`;
    const before = i === 0 ? 0 : blendAt(segments[i - 1].pct, segment.pct);
    const after = i === segments.length - 1 ? 0 : blendAt(segment.pct, segments[i + 1].pct);
    stops.push(`${colour} ${(at + before).toFixed(2)}%`);
    stops.push(`${colour} ${(at + segment.pct - after).toFixed(2)}%`);
    at += segment.pct;
  });

  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// Money moved into a savings account is not money spent and not money left
// lying in the current account — it was the one thing the old dashboard could
// not tell you, because it quietly counted as "left over".
//
// Net, not gross. Adding up only what arrives counts a transfer between two
// savings accounts as money saved, when nothing moved at all: the destination
// reports it as arriving and nothing reports it as leaving. Subtracting what
// left cancels those to zero, and it lets the figure go negative — a month you
// dipped into savings is a real thing that had no way of being said before.
export function movedToSavings(persons) {
  let total = 0;
  for (const person of persons) {
    for (const account of person.accounts) {
      if (account.type !== 'savings') continue;
      const rate = account.rate?.rate;
      if (rate == null) continue;
      total += (account.activity.transferIn - account.activity.transferOut) * rate;
    }
  }
  return total;
}

export default function MonthFlow({ summary, month, subscriptionCount }) {
  const { household, primaryCurrency, persons } = summary;

  const moved = movedToSavings(persons);
  const spent = household.expenses;
  const subs = household.subscriptions;
  const left = household.income - spent - subs - moved;

  // Everything is a share of what came in. If nothing came in this month, the
  // bar shows the shape of what went out instead of dividing by zero.
  const base = household.income > 0 ? household.income : spent + subs + moved;
  const share = (value) => (base > 0 ? Math.max(0, (value / base) * 100) : 0);
  const percent = (value) => (base > 0 ? `${Math.round((value / base) * 100)}%` : '—');

  const segments = [
    { pct: share(spent), token: '--neg' },
    { pct: share(subs), token: '--warn' },
    { pct: share(moved), token: '--moved' },
    { pct: share(left), token: '--pos' },
  ].filter((s) => s.pct > 0.01);

  const total = segments.reduce((sum, s) => sum + s.pct, 0);
  const width = Math.min(100, total);

  return (
    <section className="card">
      <div className="flow-top">
        <h2>Where {formatMonth(month).split(' ')[0]} went</h2>
        <span className="in-total">
          <small>came in</small>
          <Money amount={household.income} currency={primaryCurrency} compact />
        </span>
      </div>

      <div
        className="bar"
        role="img"
        aria-label={
          `Of what came in: spent ${percent(spent)}, subscriptions ${percent(subs)}, ` +
          (moved < 0
            ? `${percent(-moved)} taken from savings`
            : `moved to savings ${percent(moved)}`) +
          `, left over ${percent(left)}`
        }
      >
        <div
          className="track"
          style={{
            width: `${width}%`,
            backgroundImage: segments.length ? blendedGradient(segments) : 'none',
          }}
        />
      </div>

      <div className="breakdown">
        <div>
          <span className="k">
            <i style={{ background: 'var(--neg)' }} />
            Spent
          </span>
          <span className="v">
            <Money amount={spent} currency={primaryCurrency} compact />
          </span>
          <span className="pct">{percent(spent)} of what came in</span>
        </div>
        <div>
          <span className="k">
            <i style={{ background: 'var(--warn)' }} />
            Subscriptions
          </span>
          <span className="v">
            <Money amount={subs} currency={primaryCurrency} compact />
          </span>
          <span className="pct">
            {percent(subs)}
            {subscriptionCount > 0 && ` · ${subscriptionCount} item${subscriptionCount === 1 ? '' : 's'}`}
          </span>
        </div>
        {/* A month can go either way, and "Moved to savings: −AED 2,000" is a
            sentence nobody should have to parse. Same slot, same colour, the
            label does the work. */}
        <div>
          <span className="k">
            <i style={{ background: 'var(--moved)' }} />
            {moved < 0 ? 'Taken from savings' : 'Moved to savings'}
          </span>
          <span className="v">
            <Money amount={Math.abs(moved)} currency={primaryCurrency} compact />
          </span>
          <span className="pct">
            {moved < 0 ? 'money you dipped into' : `${percent(moved)} · not spent`}
          </span>
        </div>
        <div>
          <span className="k">
            <i style={{ background: 'var(--pos)' }} />
            Left over
          </span>
          <span className="v" style={left < 0 ? { color: 'var(--neg)' } : undefined}>
            <Money amount={left} currency={primaryCurrency} compact />
          </span>
          <span className="pct">
            {left < 0 ? 'more went out than came in' : `${percent(left)} · still sitting there`}
          </span>
        </div>
      </div>

      {household.unconvertedCurrencies?.length > 0 && (
        <div className="warn-banner" style={{ marginTop: 14 }}>
          No exchange rate for {household.unconvertedCurrencies.join(', ')}, so{' '}
          {household.unconvertedCurrencies.length > 1
            ? 'those accounts are'
            : 'that account is'}{' '}
          left out of these totals. Check your connection, then hit Refresh in Settings.
        </div>
      )}
    </section>
  );
}
