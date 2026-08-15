import { useCallback, useEffect, useState } from 'react';
import { listTransactions, deleteTransaction } from '../api/transactions';
import { useLive } from '../utils/live';
import { Money, useDisplay } from '../utils/display';
import { Pencil, Search, Trash } from './icons';
import { iconForEntry, toneForEntry } from '../utils/categoryIcon';
import TransactionEditModal from './TransactionEditModal';
import ToolbarSlot from './ToolbarSlot';

const KIND_LABEL = {
  income: 'Income',
  expense: 'Expense',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

const FILTERS = [
  ['all', 'Everything'],
  ['income', 'Came in'],
  ['expense', 'Went out'],
  ['transfers', 'Moved'],
];

const isCredit = (kind) => kind === 'income' || kind === 'transfer_in';
const isMove = (kind) => kind === 'transfer_in' || kind === 'transfer_out';

// Entries recorded before the app knew who added them have neither a name nor a
// meaningful time, so both fall back to nothing rather than to now().
function when(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// The key a day heading groups on. Entries with no date of their own fall into
// one bucket at the end rather than each becoming a heading of its own.
const dayKey = (row) => (row.entry_date || row.created_at || '').slice(0, 10);

// "Today" and "Yesterday" are worth the words; anything older reads better as
// the date, because by then you are looking for a day, not counting back.
function dayLabel(key) {
  if (!key) return 'No date';
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'No date';
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round((midnight - date) / 86400000);
  const full = date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  if (days === 0) return `Today · ${full}`;
  if (days === 1) return `Yesterday · ${full}`;
  return full;
}

// Grouped in the order the rows arrive, which is newest first — sorting the
// keys separately would only risk disagreeing with the list.
function byDay(rows) {
  const groups = [];
  for (const row of rows) {
    const key = dayKey(row);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups;
}

// "Transfer out" tells you nothing you could not already see from the minus
// sign. The useful half is the account at the other end, which is the sibling
// row sharing this one's transfer_id.
function describe(row, rows) {
  if (row.category || row.description) return row.category || row.description;
  if (!row.transfer_id) return KIND_LABEL[row.kind];
  const other = rows.find((x) => x.transfer_id === row.transfer_id && x.id !== row.id);
  if (!other) return KIND_LABEL[row.kind];
  return row.kind === 'transfer_out' ? `To ${other.account_name}` : `From ${other.account_name}`;
}

// On a cross-currency transfer the two legs hold different amounts, and the one
// you are not looking at is the one you want to check.
//
// Returned in parts rather than as a finished sentence: where there is room for
// an element the figure goes through <Money>, so the eye turns it to dust like
// every other amount. Joined into a line of text it can only be a string, and
// there it merely masks.
function counterLeg(row, rows) {
  if (!row.transfer_id) return null;
  const other = rows.find((x) => x.transfer_id === row.transfer_id && x.id !== row.id);
  if (!other || other.currency === row.currency) return null;
  return { lead: row.kind === 'transfer_in' ? 'sent' : 'arrives as', ...other };
}

export default function ActivityList({
  month,
  accountsById,
  personsById,
  onChanged,
  readOnly = false,
  phone = false,
}) {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const [person, setPerson] = useState(null);
  const [query, setQuery] = useState('');
  const { money } = useDisplay();

  // Held outside the component, so coming back to Activity shows the month you
  // were already looking at instead of an empty card and a spinner.
  const { data, reload: load } = useLive(`transactions:${month}`, () =>
    listTransactions({ month })
  );
  const rows = data ?? [];
  const loading = data === undefined;

  async function remove(row) {
    const message = row.transfer_id
      ? 'Delete this transfer? Both sides of it are removed.'
      : 'Delete this entry?';
    if (!window.confirm(message)) return false;
    await deleteTransaction(row.id);
    load();
    onChanged();
    return true;
  }

  const people = Object.values(personsById);

  const needle = query.trim().toLowerCase();
  const visible = rows.filter((row) => {
    if (person && row.person_id !== person) return false;
    if (filter === 'transfers' && !row.transfer_id) return false;
    if (filter !== 'all' && filter !== 'transfers' && row.kind !== filter) return false;
    if (!needle) return true;
    // Searched over everything the row shows, so what you can read you can
    // find — including the person and the account, not just the words typed.
    return [
      describe(row, rows),
      row.category,
      row.description,
      row.account_name,
      personsById[row.person_id]?.name,
    ]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(needle));
  });

  const openRow = (row) =>
    setEditing({
      ...row,
      legs: row.transfer_id ? rows.filter((x) => x.transfer_id === row.transfer_id) : null,
    });

  const rowProps = (row, label) =>
    readOnly
      ? { className: 'txn' }
      : {
          className: 'txn tappable',
          onClick: () => openRow(row),
          role: 'button',
          tabIndex: 0,
          'aria-label': `Edit ${label}`,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openRow(row);
            }
          },
        };

  const actions = (row, label) =>
    !readOnly && (
      <span className="txn-acts" onClick={(e) => e.stopPropagation()}>
        <button
          className="icon-button small"
          title="Edit"
          aria-label={`Edit ${label}`}
          onClick={() => openRow(row)}
        >
          <Pencil />
        </button>
        <button
          className="icon-button small danger"
          title="Delete"
          aria-label={`Delete ${label}`}
          onClick={() => remove(row)}
        >
          <Trash />
        </button>
      </span>
    );

  const nothing = (
    <div className="txn empty">
      <span className="what muted">
        {loading
          ? 'Loading…'
          : needle
            ? `Nothing this month matches “${query.trim()}”.`
            : 'Nothing recorded this month yet.'}
      </span>
    </div>
  );

  const search = (
    <label className="act-search">
      <Search />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search entries"
        aria-label="Search entries"
      />
    </label>
  );

  return (
    <section>
      {/* The month, the search and the page's name belong on one line. On a
          phone the top bar is already full, so search stays on the page. */}
      {phone ? <div className="section-head">{search}</div> : <ToolbarSlot>{search}</ToolbarSlot>}

      <div className="filter-row">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? 'active' : ''}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        {/* Who spent it is the other question this list gets asked, and with
            two people it is one tap rather than a search. */}
        {people.length > 1 &&
          people.map((p) => (
            <button
              key={p.id}
              className={person === p.id ? 'active' : ''}
              onClick={() => setPerson(person === p.id ? null : p.id)}
            >
              {p.name}
            </button>
          ))}
      </div>

      {phone ? (
        // Grouped by day. A month of entries in one undivided list is a wall;
        // the headings are what let you find last Tuesday.
        <div className="txn-days">
          {byDay(visible).map((group) => (
            <div className="txn-day" key={group.key || 'undated'}>
              <h3 className="day-head">{dayLabel(group.key)}</h3>
              <div className="txn-list">
                {group.rows.map((row) => {
                  const label = describe(row, rows);
                  const Icon = iconForEntry(row);
                  return (
                    <div key={row.id} {...rowProps(row, label)}>
                      <span className={`tile ${toneForEntry(row.kind)}`}>
                        <Icon />
                      </span>
                      <span className="what">
                        <b>{label}</b>
                        <small>
                          {[
                            row.account_name,
                            personsById[row.person_id]?.name,
                            (() => {
                              const leg = counterLeg(row, rows);
                              return leg && `${leg.lead} ${money(leg.amount, leg.currency)}`;
                            })(),
                            row.created_by_username,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                      <span className={isCredit(row.kind) ? 'amt in' : 'amt'}>
                        <Money
                          amount={row.amount}
                          currency={row.currency}
                          prefix={isCredit(row.kind) ? '+' : '−'}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {visible.length === 0 && <div className="txn-list">{nothing}</div>}
        </div>
      ) : (
        // At a desk the width buys columns, and a column can be scanned
        // straight down in a way a stack of two-line rows cannot.
        <div className="txn-list txn-table" role="table">
          <div className="txn-head" role="row">
            <span role="columnheader">Date</span>
            <span role="columnheader">What</span>
            <span role="columnheader">Account</span>
            <span role="columnheader">Person</span>
            <span role="columnheader">Category</span>
            <span role="columnheader" className="r">
              Amount
            </span>
            <span />
          </div>
          {visible.map((row) => {
            const label = describe(row, rows);
            const Icon = iconForEntry(row);
            const counter = counterLeg(row, rows);
            // When there is no description of its own the title already *is*
            // the category, so repeating it in its own column says nothing.
            const category = row.description ? row.category : null;
            return (
              <div key={row.id} {...rowProps(row, label)} role="row">
                <span className="on">{when(row.entry_date || row.created_at)}</span>
                <span className="what">
                  <span className={`tile ${toneForEntry(row.kind)}`}>
                    <Icon />
                  </span>
                  <b>{label}</b>
                </span>
                <span className="col">{row.account_name}</span>
                <span className="col who">
                  {personsById[row.person_id]?.name}
                  {row.created_by_username && <small>by {row.created_by_username}</small>}
                </span>
                <span className="col">
                  {category ? <span className="chip">{category}</span> : null}
                </span>
                <span className={isCredit(row.kind) ? 'amt in' : 'amt'}>
                  <Money
                    amount={row.amount}
                    currency={row.currency}
                    prefix={isCredit(row.kind) ? '+' : '−'}
                  />
                  {counter && (
                    <small>
                      {counter.lead} <Money amount={counter.amount} currency={counter.currency} />
                    </small>
                  )}
                </span>
                {actions(row, label)}
              </div>
            );
          })}
          {visible.length === 0 && nothing}
        </div>
      )}

      {editing && (
        <TransactionEditModal
          entry={editing}
          accountsById={accountsById}
          month={month}
          onDelete={async (row) => {
            if (await remove(row)) setEditing(null);
          }}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            load();
            await onChanged();
          }}
        />
      )}
    </section>
  );
}
