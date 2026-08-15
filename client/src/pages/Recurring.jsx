import { useCallback, useEffect, useState } from 'react';
import {
  listSubscriptions,
  deleteSubscription,
  stopSubscription,
  resumeSubscription,
} from '../api/subscriptions';
import RecurringFormModal from '../components/RecurringFormModal';
import RecurringYear from '../components/RecurringYear';
import { Money } from '../utils/display';
import { formatMonth } from '../utils/month';
import { convert, dueIn, hasEnded, perMonth, startsLater } from '../utils/recurring';
import ToolbarSlot from '../components/ToolbarSlot';
import { Pencil, Plus, Trash, Wallet } from '../components/icons';
import { iconForCategory } from '../utils/categoryIcon';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// What one item costs a month, in the household's own currency, or null when
// there is no rate to convert it with.
const monthlyPrimary = (item, rate) => convert(perMonth(item), rate);

function Row({ item, rate, currency, month, readOnly, phone, onEdit, onStop, onResume, onDelete }) {
  const ended = hasEnded(item, month);
  const later = startsLater(item, month);
  const yearly = item.cycle === 'yearly';
  const income = item.direction === 'income';
  const monthly = monthlyPrimary(item, rate);

  // An end date that has not arrived yet is the useful half: it says this is
  // already accounted for and will stop on its own.
  const endsLater = item.end_month && !ended && item.end_month >= month;

  // Everything except the cycle, which is set apart: a yearly renewal is the
  // one fact on the row you must not skim past, so it is coloured rather than
  // buried mid-sentence between the account and the end date.
  // The category is already the icon on the left, and repeating it here was
  // costing the line the room the cycle needs — "once a year, Nove…" is worse
  // than no category at all.
  const detail = `${item.personName ?? item.person_name} · ${
    item.accountName ?? item.account_name
  }`;

  // Recurring income is nearly always a salary, so that is the fallback
  // rather than the generic tag.
  const Icon = iconForCategory(item.category || item.name, { fallback: income ? Wallet : null }) ||
    iconForCategory(item.name);

  // A phone draws no buttons on the row — there is no width for three of them —
  // so the row itself has to be the way in. Without this there was no way to
  // edit, stop or delete a recurring item on a phone at all.
  const tappable = !readOnly && phone;
  const open = () => onEdit(item);

  return (
    <div
      className={`txn${ended ? ' ended' : ''}${tappable ? ' tappable' : ''}`}
      {...(tappable
        ? {
            onClick: open,
            role: 'button',
            tabIndex: 0,
            'aria-label': `Edit ${item.name}`,
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
              }
            },
          }
        : {})}
    >
      <span className={income ? 'tile in' : 'tile'}>
        <Icon />
      </span>
      <span className="what">
        <b>{item.name}</b>
        <small>
          {detail}
          {' · '}
          {yearly ? (
            <b className="cycle">once a year, {MONTH_NAMES[(item.billing_month || 1) - 1]}</b>
          ) : (
            'every month'
          )}
          {endsLater && ` · until ${formatMonth(item.end_month)}`}
          {ended && ` · stopped ${item.end_month ? formatMonth(item.end_month) : ''}`}
          {later && ` · starts ${formatMonth(item.start_month)}`}
        </small>
      </span>

      <span className={income ? 'amt in' : 'amt'}>
        <Money
          amount={item.amount}
          currency={item.currency}
          compact
          prefix={income ? '+' : '−'}
        />
        {/* A yearly renewal and a monthly subscription are only comparable per
            month, so the yearly ones carry their own translation. */}
        {yearly && (
          <span className="sub">
            ≈<Money amount={perMonth(item)} currency={item.currency} compact /> / mo
          </span>
        )}
        {!yearly && monthly == null && <span className="sub">no rate yet</span>}
      </span>

      {!readOnly && (
        <span className="txn-acts" onClick={(e) => e.stopPropagation()}>
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

export default function Recurring({ summary, month, onChanged, readOnly = false, phone = false }) {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

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

  // How much of a month's income is spoken for before a single loose purchase.
  // The whole point of the screen in one number.
  const spokenFor =
    inTotal.amount > 0 ? Math.round((outTotal.amount / inTotal.amount) * 100) : null;
  // Yearly items averaged across the twelve months they sit in — the part of
  // the monthly commitment that isn't actually charged monthly.
  const yearlySpread = out
    .filter((i) => i.cycle === 'yearly')
    .reduce((sum, i) => sum + (monthlyPrimary(i, rateFor(i)) ?? 0), 0);

  const addButton = (
    <button className="primary add-top" onClick={() => setAdding(true)}>
      <Plus size={16} /> Add item
    </button>
  );

  return (
    <>
      {/* No heading: the sidebar and the top bar both already say Recurring,
          and on a phone the tab bar does. The action sits in the top bar at a
          desk; a phone's bar has no room, so there it stays on the page. */}
      {!readOnly && accounts.length > 0 && (
        phone ? (
          <div className="section-head">
            <span />
            {addButton}
          </div>
        ) : (
          <ToolbarSlot>{addButton}</ToolbarSlot>
        )
      )}

      <div className="hero recurring-hero">
        <div>
          <p className="label">Committed every month</p>
          <p className="value">
            <Money amount={outTotal.amount} currency={currency} compact />
          </p>
          {/* The figure that actually changes behaviour: not what the
              subscriptions cost, but how much of the month they have already
              taken. */}
          <p className="delta">
            {income.length > 0 ? (
              <>
                against{' '}
                <strong className="up">
                  <Money amount={inTotal.amount} currency={currency} compact />
                </strong>{' '}
                that arrives
                {spokenFor != null && ` — ${spokenFor}% spoken for before you spend anything`}
              </>
            ) : (
              <>
                <strong>
                  <Money amount={outTotal.amount * 12} currency={currency} compact />
                </strong>{' '}
                a year
              </>
            )}
          </p>
        </div>

        {yearlySpread > 0 && (
          <div className="yearly">
            <span className="k">Yearly items, spread</span>
            <span className="v">
              <Money amount={yearlySpread} currency={currency} compact /> / mo
            </span>
          </div>
        )}
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
      <section className="txn-list">
        <div className="panel-h">
          Goes out
          {/* The figure goes through <Money> rather than into the sentence,
              so it turns to dust with every other amount when the eye shuts. */}
          <small>
            {out.length === 0 ? (
              'nothing yet'
            ) : (
              <>
                {dueNow.length} of {out.length} charge in {formatMonth(month).split(' ')[0]}
                {dueNow.length > 0 && (
                  <>
                    {' · '}
                    <Money
                      amount={dueNow.reduce((s, i) => s + (convert(i.amount, rateFor(i)) || 0), 0)}
                      currency={currency}
                      compact
                    />
                  </>
                )}
              </>
            )}
          </small>
        </div>

        <div>
          {out.map((item) => (
            <Row
              key={item.id}
              item={item}
              rate={rateFor(item)}
              currency={currency}
              month={month}
              readOnly={readOnly}
              phone={phone}
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
        <section className="txn-list">
          <div className="panel-h">
            Comes in
            <small>
              {income.length} item{income.length === 1 ? '' : 's'} ·{' '}
              <Money amount={inTotal.amount} currency={currency} compact />
            </small>
          </div>
          <div>
            {income.map((item) => (
              <Row
                key={item.id}
                item={item}
                rate={rateFor(item)}
                currency={currency}
                month={month}
                readOnly={readOnly}
                phone={phone}
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
        <section className="txn-list">
          <div className="panel-h">
            Stopped
            <small>still counted in the months they ran</small>
          </div>
          <div>
            {done.map((item) => (
              <Row
                key={item.id}
                item={item}
                rate={rateFor(item)}
                currency={currency}
                month={month}
                readOnly={readOnly}
                phone={phone}
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
          onStop={stop}
          onResume={resume}
          onDelete={remove}
          stopped={Boolean(editing && hasEnded(editing, month))}
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
