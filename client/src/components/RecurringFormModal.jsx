import { useState } from 'react';
import Modal from './Modal';
import { createSubscription, updateSubscription } from '../api/subscriptions';
import { useDisplay } from '../utils/display';
import { currentMonth, formatMonth, shiftMonth } from '../utils/month';
import { perMonth } from '../utils/recurring';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// One form for both jobs. Adding and editing ask for the same eight things, and
// two forms that must stay in step is one form too many.
export default function RecurringFormModal({
  item,
  accounts,
  categories = [],
  month,
  onClose,
  onSaved,
}) {
  const editing = Boolean(item);
  const { money } = useDisplay();

  const [form, setForm] = useState(() => ({
    direction: item?.direction ?? 'expense',
    name: item?.name ?? '',
    amount: item ? String(item.amount) : '',
    account_id: String(item?.account_id ?? accounts[0]?.id ?? ''),
    cycle: item?.cycle ?? 'monthly',
    billing_month: String(item?.billing_month || Number(month.split('-')[1])),
    category: item?.category ?? '',
    end_month: item?.end_month ?? '',
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const account = accounts.find((a) => a.id === Number(form.account_id)) ?? accounts[0];

  // Only a change to what it costs starts a new period; renaming it or filing
  // it under a different category is a correction to a label and applies to
  // every month at once.
  const changesMoney =
    editing &&
    (Number(form.amount) !== item.amount ||
      Number(form.account_id) !== item.account_id ||
      form.direction !== item.direction ||
      form.cycle !== item.cycle);
  const hasHistory = editing && item.start_month < month;

  // Last month is the floor. Ending an item last month means it no longer
  // runs from now on — the same thing Stop does — and every month it charged
  // keeps its charge. Anything earlier would take money back out of months
  // already recorded.
  const thisMonth = currentMonth();
  const earliestEnd = shiftMonth(thisMonth, -1);
  const endTooEarly = form.end_month && form.end_month < earliestEnd;
  const endBeforeStart =
    form.end_month && editing && form.end_month < item.start_month;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const amount = Number(form.amount);
    if (!account) {
      setError('Add an account first — recurring money has to come out of one.');
      return;
    }
    if (!form.name.trim()) {
      setError('Give it a name.');
      return;
    }
    if (!(amount > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (endTooEarly) {
      setError(
        `The earliest it can end is ${formatMonth(earliestEnd)} — anything before that has already been charged.`
      );
      return;
    }
    if (endBeforeStart) {
      setError(`It cannot end before it starts, in ${formatMonth(item.start_month)}.`);
      return;
    }

    const body = {
      account_id: account.id,
      name: form.name.trim(),
      direction: form.direction,
      amount,
      cycle: form.cycle,
      billing_month: form.cycle === 'yearly' ? Number(form.billing_month) : null,
      category: form.category.trim() || null,
      end_month: form.end_month || null,
    };

    setBusy(true);
    try {
      if (editing) await updateSubscription(item.id, body, month);
      else await createSubscription({ ...body, start_month: month });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${item.name}` : 'Add something recurring'}
      onClose={onClose}
    >
      <form className="stack" onSubmit={submit}>
        <div className="seg two" role="group" aria-label="Direction" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={form.direction === 'expense' ? 'active' : ''}
            aria-pressed={form.direction === 'expense'}
            onClick={() => setForm((f) => ({ ...f, direction: 'expense' }))}
          >
            Going out
          </button>
          <button
            type="button"
            className={form.direction === 'income' ? 'active' : ''}
            aria-pressed={form.direction === 'income'}
            onClick={() => setForm((f) => ({ ...f, direction: 'income' }))}
          >
            Coming in
          </button>
        </div>

        <div className="amount-field">
          <div className="cur">{account?.currency ?? ''}</div>
          <input
            className="num"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') }))}
            aria-label="Amount"
            autoFocus
          />
        </div>

        <label className="field">
          <span className="label">Name</span>
          <input
            type="text"
            placeholder={form.direction === 'income' ? 'e.g. Salary' : 'e.g. Netflix'}
            value={form.name}
            onChange={set('name')}
          />
        </label>

        <label className="field">
          <span className="label">{form.direction === 'income' ? 'Paid into' : 'Paid from'}</span>
          <select value={form.account_id} onChange={set('account_id')}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.personName} · {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </label>

        <div className="row">
          <label className="field grow">
            <span className="label">How often</span>
            <select value={form.cycle} onChange={set('cycle')}>
              <option value="monthly">Every month</option>
              <option value="yearly">Once a year</option>
            </select>
          </label>
          {form.cycle === 'yearly' && (
            <label className="field grow">
              <span className="label">Billed in</span>
              <select value={form.billing_month} onChange={set('billing_month')}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* Optional, and the only way to say "this runs until" without having
            to remember to press Stop when the month arrives. */}
        <label className="field">
          <span className="label">Runs until</span>
          <input
            type="month"
            value={form.end_month}
            min={editing ? item.start_month : earliestEnd}
            onChange={set('end_month')}
          />
          <span className="muted" style={{ fontSize: '.78rem' }}>
            {form.end_month
              ? `Charges through ${formatMonth(form.end_month)}, then stops.`
              : 'Leave empty and it runs until you stop it.'}
          </span>
        </label>

        <label className="field">
          <span className="label">Category</span>
          <input
            type="text"
            list="recurring-categories"
            placeholder="optional"
            value={form.category}
            onChange={set('category')}
          />
          <datalist id="recurring-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        {form.cycle === 'yearly' && Number(form.amount) > 0 && (
          <span className="muted" style={{ fontSize: '.8rem' }}>
            Works out to {money(perMonth({ cycle: 'yearly', amount: Number(form.amount) }), account?.currency, { compact: true })} a
            month, charged once in {MONTH_NAMES[Number(form.billing_month) - 1]}.
          </span>
        )}

        {/* Said before saving, not discovered afterwards: this is the whole
            point of the history-preserving rule and it should never be a
            surprise. */}
        {changesMoney && hasHistory && (
          <div className="warn-banner">
            This applies from <strong>{formatMonth(month)}</strong> onwards. Everything up to{' '}
            {formatMonth(shiftMonth(month, -1))} keeps {money(item.amount, item.currency)}, so your
            past totals don’t move.
          </div>
        )}

        {!editing && (
          <span className="muted" style={{ fontSize: '.8rem' }}>
            Starts in {formatMonth(month)}. It moves that account’s balance every month by itself —
            there’s nothing to re-enter.
          </span>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
