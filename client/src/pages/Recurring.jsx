import { useCallback, useEffect, useState } from 'react';
import {
  listSubscriptions,
  deleteSubscription,
  stopSubscription,
  resumeSubscription,
} from '../api/subscriptions';
import RecurringFormModal from '../components/RecurringFormModal';
import RecurringYear from '../components/RecurringYear';
import { Money, useDisplay } from '../utils/display';
import { formatMonth } from '../utils/month';
import { convert, dueIn, hasEnded, perMonth, startsLater } from '../utils/recurring';
import { Pencil, Plus, Trash, Wallet } from '../components/icons';
import { iconForCategory } from '../utils/categoryIcon';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// What one item costs a month, in the household's own currency, or null when
// there is no rate to convert it with.
const monthlyPrimary = (item, rate) => convert(perMonth(item), rate);

function Row({ item, rate, currency, month, readOnly, onEdit, onStop, onResume, onDelete }) {
  const { money } = useDisplay();
  const ended = hasEnded(item, month);
  const later = startsLater(item, month);
  const yearly = item.cycle === 'yearly';
  const income = item.direction === 'income';
  const monthly = monthlyPrimary(item, rate);

  // An end date that has not arrived yet is the useful half: it says this is
  // already accounted for and will stop on its own.
  const endsLater = item.end_month && !ended && item.end_month >= month;

  const detail = [
    `${item.personName ?? item.person_name} · ${item.accountName ?? item.account_name}`,
    item.category,
    yearly ? `every ${MONTH_NAMES[(item.billing_month || 1) - 1]}` : 'every month',
    endsLater ? `until ${formatMonth(item.end_month)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Recurring income is nearly always a salary, so that is the fallback
  // rather than the generic tag.
  const Icon = iconForCategory(item.category || item.name, { fallback: income ? Wallet : null }) ||
    iconForCategory(item.name);

  return (
    <div className={ended ? 'txn ended' : 'txn'}>
      <span className={income ? 'tile in' : 'tile'}>
        <Icon />
      </span>
      <span className="what">
        <b>{item.name}</b>
        <small>
          {detail}
          {ended && ` · stopped ${item.end_month ? formatMonth(item.end_month) : ''}`}
          {later && ` · starts ${formatMonth(item.start_month)}`}
        </small>
      </span>

      <span className={income ? 'amt in' : 'amt'}>
        <Money amount={item.amount} currency={item.currency} compact />
        {/* A yearly renewal and a monthly subscription are only comparable per
            month, so the yearly ones carry their own translation. */}
        {yearly && (
          <span className="sub">
            <Money amount={perMonth(item)} currency={item.currency} compact /> a month
          </span>
        )}
        {!yearly && monthly == null && <span className="sub">no rate</span>}
      </span>

      {!readOnly && (
        <span className="txn-acts">
          <button
            className="icon-button small"
            title="Edit"
            aria-label={`Edit ${item.name}`}
            onClick={() => onEdit(item)}
          >
            <Pencil />
          </button>
          {ended ? (
            <button className="tiny subtle" onClick={() => onResume(item)}>
              Restart
            </button>
          ) : (
            <button className="tiny subtle" onClick={() => onStop(item)}>
              Stop
            </button>
          )}
          <button
            className="icon-button small danger"
            title="Delete"
            aria-label={`Delete ${item.name}`}
            onClick={() => onDelete(item)}
          >
            <Trash />
          </button>
        </span>
      )}
    </div>
  );
}

export default function Recurring({ summary, month, onChanged, readOnly = false }) {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const { money } = useDisplay();

  const currency = summary.primaryCurrency;
  const accounts = summary.persons.flatMap((p) =>
    p.accounts.map((a) => ({ ...a, personName: p.name }))
  );
  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const rateFor = (item) => accountsById[item.account_id]?.rate;

  const load = useCallback(() => {
    listSubscriptions(month).then(setItems, (err) => setError(err.message));
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (run) => {
    setError(null);
    try {
      await run();
      load();
      await onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  const stop = (item) =>
    window.confirm(
      item.start_month >= month
        ? `${item.name} hasn't been charged yet, so stopping it removes it. Go ahead?`
        : `Stop ${item.name} from ${formatMonth(month)}? Earlier months keep it.`
    ) && act(() => stopSubscription(item.id, month));

  const resume = (item) => act(() => resumeSubscription(item.id, month));

  const remove = (item) =>
    window.confirm(
      `Delete ${item.name} completely? This erases it from every month it ever charged — ` +
        `to keep those, use Stop instead.`
    ) && act(() => deleteSubscription(item.id));

  const running = items.filter((i) => !hasEnded(i, month));
  const out = running.filter((i) => i.direction !== 'income');
  const income = running.filter((i) => i.direction === 'income');
  const done = items.filter((i) => hasEnded(i, month));

  const byCost = (a, b) =>
    (monthlyPrimary(b, rateFor(b)) ?? 0) - (monthlyPrimary(a, rateFor(a)) ?? 0);
  out.sort(byCost);
  income.sort(byCost);

  // Totals are per month, with yearly items averaged into them. Anything the
  // household has no exchange rate for is counted separately rather than
  // silently left out of a figure that claims to be everything.
  const total = (list) =>
    list.reduce(
      (sum, item) => {
        const value = monthlyPrimary(item, rateFor(item));
        if (value == null) return { ...sum, missing: sum.missing + 1 };
        return { ...sum, amount: sum.amount + value };
      },
      { amount: 0, missing: 0 }
    );

  const outTotal = total(out);
  const inTotal = total(income);
  const dueNow = out.filter((i) => dueIn(i, month));

  return (
    <>
      {/* No heading: the sidebar and the top bar both already say Recurring,
          and on a phone the tab bar does. */}
      <div className="section-head">
        <span />
        {!readOnly && accounts.length > 0 && (
          <button className="primary tiny" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add recurring
          </button>
        )}
      </div>

      <div className="hero recurring-hero">
        <div>
          <p className="label">Going out</p>
          <p className="value">
            <Money amount={outTotal.amount} currency={currency} compact />
            <span className="per"> a month</span>
          </p>
          {/* The figure that actually changes behaviour. Nobody cancels over
              AED 56 a month; they cancel over AED 672 a year. */}
          <p className="delta">
            <strong>
              <Money amount={outTotal.amount * 12} currency={currency} compact />
            </strong>{' '}
            a year
            {income.length > 0 && (
              <>
                {' · '}
                <Money amount={inTotal.amount} currency={currency} compact /> a month coming in
              </>
            )}
          </p>
        </div>
      </div>

      {(outTotal.missing > 0 || inTotal.missing > 0) && (
        <div className="warn-banner">
          {outTotal.missing + inTotal.missing} item
          {outTotal.missing + inTotal.missing === 1 ? '' : 's'} sit in a currency with no exchange
          rate, so they aren’t in these totals.
        </div>
      )}

      {error && <div className="card error-text">{error}</div>}

      {/* Outgoings only. Salary is the same every month and would flatten the
          shape it exists to show. */}
      <RecurringYear items={out} rateFor={rateFor} currency={currency} month={month} />

      <div className="recurring-lists">
      <section>
        <div className="section-head">
          <h2>Going out</h2>
          <span className="muted" style={{ fontSize: '.8rem' }}>
            {out.length === 0
              ? 'nothing yet'
              : `${dueNow.length} of ${out.length} charge in ${formatMonth(month).split(' ')[0]}` +
                (dueNow.length ? ` · ${money(
                  dueNow.reduce((s, i) => s + (convert(i.amount, rateFor(i)) || 0), 0),
                  currency,
                  { compact: true }
                )}` : '')}
          </span>
        </div>

        <div className="txn-list">
          {out.map((item) => (
            <Row
              key={item.id}
              item={item}
              rate={rateFor(item)}
              currency={currency}
              month={month}
              readOnly={readOnly}
              onEdit={setEditing}
              onStop={stop}
              onResume={resume}
              onDelete={remove}
            />
          ))}
          {out.length === 0 && (
            <div className="txn empty">
              <span className="what muted">
                Nothing going out on repeat. Subscriptions, rent, school fees — anything you’d
                otherwise re-type every month.
              </span>
            </div>
          )}
        </div>
      </section>

      {income.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Coming in</h2>
            <span className="muted" style={{ fontSize: '.8rem' }}>
              {income.length} item{income.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="txn-list">
            {income.map((item) => (
              <Row
                key={item.id}
                item={item}
                rate={rateFor(item)}
                currency={currency}
                month={month}
                readOnly={readOnly}
                onEdit={setEditing}
                onStop={stop}
                onResume={resume}
                onDelete={remove}
              />
            ))}
          </div>
        </section>
      )}
      </div>

      {/* Stopped items stay visible but out of the way: they are the record of
          what you used to pay, and they are how you restart something. */}
      {done.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="muted">Stopped</h2>
            <span className="muted" style={{ fontSize: '.8rem' }}>
              still counted in the months they ran
            </span>
          </div>
          <div className="txn-list">
            {done.map((item) => (
              <Row
                key={item.id}
                item={item}
                rate={rateFor(item)}
                currency={currency}
                month={month}
                readOnly={readOnly}
                onEdit={setEditing}
                onStop={stop}
                onResume={resume}
                onDelete={remove}
              />
            ))}
          </div>
        </section>
      )}

      {(adding || editing) && (
        <RecurringFormModal
          item={editing}
          accounts={accounts}
          categories={[...new Set(items.map((i) => i.category).filter(Boolean))]}
          month={month}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={async () => {
            load();
            await onChanged();
          }}
        />
      )}
    </>
  );
}
