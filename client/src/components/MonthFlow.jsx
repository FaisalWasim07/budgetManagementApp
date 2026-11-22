import { useEffect, useId, useRef, useState } from 'react';
import { Money } from '../utils/display';
import { formatMonth } from '../utils/month';
import { useLive } from '../utils/live';
import { listTransactions } from '../api/transactions';
import { ChevronDown } from './icons';

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

// Per savings account, the same net figure movedToSavings adds up — so the
// rows under "Moved" are the parts of exactly that total.
function movedByAccount(persons) {
  const rows = [];
  for (const person of persons) {
    for (const account of person.accounts) {
      if (account.type !== 'savings') continue;
      const rate = account.rate?.rate;
      if (rate == null) continue;
      const net = (account.activity.transferIn - account.activity.transferOut) * rate;
      if (Math.abs(net) < 0.005) continue;
      rows.push({ label: account.name, sub: person.name, amount: net, personId: person.id });
    }
  }
  return rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

const sum = (rows) => rows.reduce((total, row) => total + row.amount, 0);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Six rows, then the rest as one line carrying their sum. Not "and 4 others"
// with no figure: the list has to add up to the headline, and a tail you
// cannot see the size of is a list that doesn't.
const LIMIT = 6;

const shortDate = (entry) =>
  new Date(entry.entry_date || entry.created_at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });

// The entries behind one row, opened in place. "3 entries" was a count of
// things you could not see; this is the three things.
function Entries({ entries, personName }) {
  if (!entries.length) return null;
  return (
    <ul className="flow-entries">
      {[...entries]
        .sort((a, b) => b.amount - a.amount)
        .map((entry) => (
          <li key={entry.id}>
            <span className="what">
              {/* Your words if you wrote any; otherwise the account it went
                  through, which is the next best thing to recognise it by. */}
              <b>{entry.description || entry.account_name}</b>
              <small>
                {[
                  shortDate(entry),
                  entry.description ? entry.account_name : null,
                  personName(entry.person_id),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
            <span className="amt num">
              <Money amount={entry.amount} currency={entry.currency} compact />
            </span>
          </li>
        ))}
    </ul>
  );
}

function Rows({ rows, colour, currency, empty, entriesFor, personName }) {
  // One row open at a time: the panel is a summary first, and two long lists
  // open at once is a page, not a summary.
  const [expanded, setExpanded] = useState(null);
  const [everything, setEverything] = useState(false);
  if (rows.length === 0) return <p className="flow-empty">{empty}</p>;
  const shown = everything ? rows : rows.slice(0, LIMIT);
  const rest = everything ? [] : rows.slice(LIMIT);
  const largest = Math.max(...rows.map((row) => Math.abs(row.amount)), 1);

  return (
    <ul className="flow-rows">
      {shown.map((row) => {
        const key = row.key ?? row.label;
        const entries = entriesFor ? entriesFor(row) : [];
        const open = expanded === key;
        return (
        <li key={key} className={open ? 'is-open' : undefined}>
          {entries.length > 0 ? (
            <button
              type="button"
              className="what flow-row-toggle"
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : key)}
            >
              <b>{row.label}</b>
              <small>
                {row.sub}
                <ChevronDown size={10} />
              </small>
            </button>
          ) : (
            <span className="what">
              <b>{row.label}</b>
              {row.sub && <small>{row.sub}</small>}
            </span>
          )}
          {/* Against the largest row, not the total: with one big category
              and five small ones, shares of the total leave five bars nobody
              can tell apart. */}
          <span className="meter" aria-hidden="true">
            <i style={{ width: `${(Math.abs(row.amount) / largest) * 100}%`, background: colour }} />
          </span>
          <span className="amt num">
            <Money
              amount={Math.abs(row.amount)}
              currency={currency}
              compact
              prefix={row.amount < 0 ? '−' : ''}
            />
          </span>
          {open && <Entries entries={entries} personName={personName} />}
        </li>
        );
      })}
      {rest.length > 0 && (
        <li className="more">
          {/* Still carrying its sum, so the list adds up while folded; and now
              a way to see what is in it. */}
          <button type="button" className="what flow-row-toggle" onClick={() => setEverything(true)}>
            <b>Show {rest.length} more</b>
          </button>
          <span className="meter" aria-hidden="true" />
          <span className="amt num">
            <Money amount={sum(rest)} currency={currency} compact />
          </span>
        </li>
      )}
    </ul>
  );
}

// Who it was, when there is more than one person to say it about.
function People({ persons, value, currency }) {
  const rows = persons
    .map((person) => ({ name: person.name, amount: value(person) }))
    .filter((row) => Math.abs(row.amount) >= 0.005);
  if (persons.length < 2 || rows.length === 0) return null;
  return (
    <p className="flow-people num">
      {rows.map((row, i) => (
        <span key={row.name}>
          {i > 0 && ' · '}
          {row.name}{' '}
          <Money amount={row.amount} currency={currency} compact />
        </span>
      ))}
    </p>
  );
}

export default function MonthFlow({ summary, month, subscriptionCount }) {
  const { household, primaryCurrency, persons } = summary;
  const flow = summary.flow ?? { cameIn: [], spent: [], recurring: [] };
  const monthName = formatMonth(month).split(' ')[0];

  const moved = movedToSavings(persons);
  const spent = household.expenses;
  const subs = household.subscriptions;
  const left = household.income - spent - subs - moved;

  // Everything is a share of what came in. If nothing came in this month, the
  // bar shows the shape of what went out instead of dividing by zero.
  const base = household.income > 0 ? household.income : spent + subs + moved;
  const share = (value) => (base > 0 ? Math.max(0, (value / base) * 100) : 0);
  const percent = (value) => (base > 0 ? `${Math.round((value / base) * 100)}%` : '—');
  const ofIncome = (value) =>
    household.income > 0 ? `${Math.round((value / household.income) * 100)}% of what came in` : null;

  const segments = [
    { key: 'spent', pct: share(spent), token: '--neg' },
    { key: 'recurring', pct: share(subs), token: '--warn' },
    { key: 'moved', pct: share(moved), token: '--moved' },
    { key: 'left', pct: share(left), token: '--pos' },
  ].filter((s) => s.pct > 0.01);

  const total = segments.reduce((sum, s) => sum + s.pct, 0);
  const width = Math.min(100, total);

  // Where each segment actually sits on the bar, so the part you point at is
  // the part that opens. Clipped to the bar: in a month that spent three times
  // what came in, "spent" is the whole bar and nothing after it is visible to
  // point at.
  let at = 0;
  const zones = segments.map((segment) => {
    const from = Math.min(100, at);
    at += segment.pct;
    return { key: segment.key, left: from, width: Math.min(100, at) - from };
  });

  // ── Which breakdown is showing ────────────────────────────────────────
  // A mouse previews on hover and the panel follows it from key to key. A
  // press — a tap, a click, Enter — pins it, and pressing the same one again
  // or anywhere outside lets it go. Touch never hovers, so on a phone the tap
  // is the whole interaction.
  const [open, setOpen] = useState(null);
  const [pinned, setPinned] = useState(false);
  const card = useRef(null);
  const panel = useRef(null);
  const leaving = useRef(null);
  const panelId = useId();

  const hover = (key) => (event) => {
    if (event.pointerType !== 'mouse' || pinned) return;
    clearTimeout(leaving.current);
    setOpen(key);
  };
  const press = (key) => {
    clearTimeout(leaving.current);
    if (open === key && pinned) {
      setOpen(null);
      setPinned(false);
    } else {
      setOpen(key);
      setPinned(true);
    }
  };
  const leave = (event) => {
    if (event.pointerType !== 'mouse' || pinned) return;
    // A moment's grace, so crossing a gap between two keys doesn't flicker
    // the panel shut and open again.
    leaving.current = setTimeout(() => setOpen(null), 140);
  };
  useEffect(() => () => clearTimeout(leaving.current), []);

  // A press opens the panel below the card, and on a phone that is usually
  // below the fold or under the tab bar. Brought into view once, on opening —
  // never on hover, where scrolling the page under the pointer would move the
  // very thing being pointed at.
  useEffect(() => {
    if (pinned && open) panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pinned, open]);

  useEffect(() => {
    if (!pinned) return undefined;
    const outside = (event) => {
      if (card.current && !card.current.contains(event.target)) {
        setOpen(null);
        setPinned(false);
      }
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        setOpen(null);
        setPinned(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [pinned]);

  // Props for anything that opens a breakdown.
  const opener = (key) => ({
    type: 'button',
    'aria-expanded': open === key,
    'aria-controls': open === key ? panelId : undefined,
    onPointerEnter: hover(key),
    onClick: () => press(key),
  });

  // The month's entries, for opening a row to what is in it. The same list
  // under the same key as Home's latest entries, so it is already loaded and
  // costs nothing. Only accounts still open, because only those are in the
  // totals — a closed account's entry under "Groceries" would be a line the
  // row's own figure does not include.
  const { data: monthEntries } = useLive(`transactions:${month}`, () => listTransactions({ month }));
  const openAccounts = new Set(persons.flatMap((p) => p.accounts.map((a) => a.id)));
  const personName = (id) => persons.find((p) => p.id === id)?.name ?? null;
  // Matched the way the server grouped them: the category exactly as stored,
  // with the same word standing in for none.
  const entriesOf = (kind, fallback) => (row) =>
    row.recurring
      ? []
      : (monthEntries ?? []).filter(
          (entry) =>
            entry.kind === kind &&
            openAccounts.has(entry.account_id) &&
            (entry.category || fallback) === row.label
        );

  const recurringIn = sum(flow.cameIn.filter((row) => row.recurring));
  const entries = (rows) => rows.reduce((n, row) => n + (row.count ?? 0), 0);

  const DETAIL = {
    cameIn: {
      title: 'Came in',
      colour: 'var(--pos)',
      amount: household.income,
      note:
        recurringIn > 0 ? (
          <>
            <Money amount={recurringIn} currency={primaryCurrency} compact /> of it recurring
          </>
        ) : (
          `Everything that arrived in ${monthName}`
        ),
      body: (
        <Rows
          rows={flow.cameIn.map((row) => ({
            ...row,
            key: row.id ? `r${row.id}` : row.label,
            sub: row.recurring
              ? `Recurring · ${row.account}`
              : plural(row.count, 'entry', 'entries'),
          }))}
          colour="var(--pos)"
          currency={primaryCurrency}
          empty={`Nothing has come in for ${monthName} yet.`}
          entriesFor={entriesOf('income', 'Other income')}
          personName={personName}
        />
      ),
      people: (p) => p.income,
    },
    spent: {
      title: 'Spent',
      colour: 'var(--neg)',
      amount: spent,
      note: [ofIncome(spent), entries(flow.spent) ? plural(entries(flow.spent), 'entry', 'entries') : null]
        .filter(Boolean)
        .join(' · '),
      body: (
        <Rows
          rows={flow.spent.map((row) => ({ ...row, sub: plural(row.count, 'entry', 'entries') }))}
          colour="var(--neg)"
          currency={primaryCurrency}
          empty={`Nothing spent in ${monthName} yet.`}
          entriesFor={entriesOf('expense', 'Uncategorised')}
          personName={personName}
        />
      ),
      people: (p) => p.expenses,
    },
    recurring: {
      title: 'Subscriptions',
      colour: 'var(--warn)',
      amount: subs,
      note: [ofIncome(subs), flow.recurring.length ? plural(flow.recurring.length, 'item') : null]
        .filter(Boolean)
        .join(' · '),
      body: (
        <Rows
          rows={flow.recurring.map((row) => ({
            ...row,
            key: `r${row.id}`,
            sub:
              row.currency !== primaryCurrency ? (
                <>
                  {row.account} · <Money amount={row.original} currency={row.currency} compact />
                </>
              ) : (
                row.account
              ),
          }))}
          colour="var(--warn)"
          currency={primaryCurrency}
          empty={`Nothing recurring went out in ${monthName}.`}
        />
      ),
      people: (p) => p.subscriptions,
    },
    moved: {
      title: moved < 0 ? 'From savings' : 'Moved to savings',
      colour: 'var(--moved)',
      amount: Math.abs(moved),
      note: [moved > 0 ? ofIncome(moved) : null, 'net of anything taken back out']
        .filter(Boolean)
        .join(' · '),
      body: (
        <Rows
          rows={movedByAccount(persons)}
          colour="var(--moved)"
          currency={primaryCurrency}
          empty={`Nothing moved into or out of savings in ${monthName}.`}
        />
      ),
      people: (p) => sum(movedByAccount([p])),
    },
    left: {
      title: 'Left',
      colour: 'var(--pos)',
      amount: left,
      note: left < 0 ? 'More went out than came in' : 'What came in, less everything that went out',
      // Not a list but the sum itself, written out — the one figure on the card
      // that is not recorded anywhere, only worked out.
      body: (
        <dl className="flow-sum num">
          <div>
            <dt>Came in</dt>
            <dd>
              <Money amount={household.income} currency={primaryCurrency} compact />
            </dd>
          </div>
          <div>
            <dt>Spent</dt>
            <dd>
              <Money amount={spent} currency={primaryCurrency} compact prefix="−" />
            </dd>
          </div>
          <div>
            <dt>Subscriptions</dt>
            <dd>
              <Money amount={subs} currency={primaryCurrency} compact prefix="−" />
            </dd>
          </div>
          <div>
            <dt>{moved < 0 ? 'Taken from savings' : 'Moved to savings'}</dt>
            <dd>
              <Money
                amount={Math.abs(moved)}
                currency={primaryCurrency}
                compact
                prefix={moved < 0 ? '+' : '−'}
              />
            </dd>
          </div>
          <div className="total">
            <dt>Left</dt>
            <dd className={left < 0 ? 'neg' : undefined}>
              <Money amount={left} currency={primaryCurrency} compact />
            </dd>
          </div>
        </dl>
      ),
      people: null,
    },
  };

  const detail = open ? DETAIL[open] : null;

  return (
    <section className="card flow-card" ref={card} onPointerLeave={leave}>
      <div className="flow-top">
        <h2>{monthName}</h2>
        <button className="in-total flow-opener" {...opener('cameIn')}>
          <small>came in</small>
          <Money amount={household.income} currency={primaryCurrency} compact />
        </button>
      </div>

      <div
        // Only a segment washes the others back. "Came in" is the whole bar,
        // so opening it leaves the bar as it is.
        className={`bar${open && open !== 'cameIn' ? ' has-open' : ''}`}
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
        {/* Pointer targets laid over the bar. Hidden from the keyboard and the
            screen reader on purpose: the keys below open the same panels, and
            a second set of identical buttons would be read out twice. */}
        {zones.map((zone) => (
          <span
            key={zone.key}
            aria-hidden="true"
            className={`zone${open === zone.key ? ' on' : ''}`}
            style={{ left: `${zone.left}%`, width: `${zone.width}%` }}
            onPointerEnter={hover(zone.key)}
            onClick={() => press(zone.key)}
          />
        ))}
      </div>

      {/* One line of keys rather than four labelled blocks. Each opens what it
          is made of. */}
      <div className="breakdown">
        <button className="k flow-opener" {...opener('spent')}>
          <i style={{ background: 'var(--neg)' }} />
          Spent
          <b>
            <Money amount={spent} currency={primaryCurrency} compact />
          </b>
        </button>
        <button className="k flow-opener" {...opener('recurring')}>
          <i style={{ background: 'var(--warn)' }} />
          Subscriptions
          <b>
            <Money amount={subs} currency={primaryCurrency} compact />
          </b>
          {subscriptionCount > 0 && (
            <small>· {subscriptionCount} item{subscriptionCount === 1 ? '' : 's'}</small>
          )}
        </button>
        <button className="k flow-opener" {...opener('moved')}>
          <i style={{ background: 'var(--moved)' }} />
          {moved < 0 ? 'From savings' : 'Moved'}
          <b>
            <Money amount={Math.abs(moved)} currency={primaryCurrency} compact />
          </b>
        </button>
        <button className="k flow-opener" {...opener('left')}>
          <i style={{ background: 'var(--pos)' }} />
          Left
          <b style={left < 0 ? { color: 'var(--neg)' } : undefined}>
            <Money amount={left} currency={primaryCurrency} compact />
          </b>
        </button>
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

      {/* Floats over what is below rather than pushing it down: opening on
          hover must not move the page under the pointer. The top padding is a
          bridge, so travelling from a key down into the panel never crosses a
          gap that counts as leaving. */}
      {detail && (
        <div
          // Keyed by which figure, so a row opened under Spent is not still
          // open when the pointer moves to Came in.
          key={open}
          className="flow-detail"
          id={panelId}
          role="region"
          aria-label={`${detail.title} in ${monthName}`}
          // Pressing anything inside a panel that opened on hover pins it:
          // reaching in to open a row is a sign you mean to read it, and
          // it would be maddening for it to vanish as the pointer drifts.
          onClick={() => setPinned(true)}
        >
          <div className="flow-panel" ref={panel}>
            <div className="flow-head">
              <i style={{ background: detail.colour }} aria-hidden="true" />
              <b>{detail.title}</b>
              <span className={`num${detail.amount < 0 ? ' neg' : ''}`}>
                <Money amount={detail.amount} currency={primaryCurrency} compact />
              </span>
            </div>
            {detail.note && <p className="flow-note">{detail.note}</p>}
            {detail.body}
            {detail.people && (
              <People persons={persons} value={detail.people} currency={primaryCurrency} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
