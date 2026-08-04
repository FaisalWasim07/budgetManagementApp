import { useCallback, useEffect, useState } from 'react';
import {
  listSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
} from '../api/subscriptions';
import { useDisplay } from '../utils/display';
import { formatMonth } from '../utils/month';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const emptyForm = (month) => ({
  account_id: '',
  name: '',
  amount: '',
  cycle: 'monthly',
  billing_month: String(Number(month.split('-')[1])),
  start_month: month,
  category: '',
});

export default function Subscriptions({ summary, month, onChanged }) {
  const [subs, setSubs] = useState([]);
  const [form, setForm] = useState(emptyForm(month));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { money } = useDisplay();

  const accounts = summary.persons.flatMap((p) =>
    p.accounts.map((a) => ({ ...a, personName: p.name }))
  );

  const load = useCallback(() => {
    listSubscriptions(month).then(setSubs);
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setForm((f) => ({ ...f, start_month: month }));
  }, [month]);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function add(e) {
    e.preventDefault();
    setError(null);
    const accountId = Number(form.account_id || accounts[0]?.id);
    const amount = Number(form.amount);
    if (!accountId) {
      setError('Create an account first — a subscription has to come out of one.');
      return;
    }
    if (!form.name.trim()) {
      setError('Give the subscription a name.');
      return;
    }
    if (!(amount > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      await createSubscription({
        account_id: accountId,
        name: form.name.trim(),
        amount,
        cycle: form.cycle,
        billing_month: form.cycle === 'yearly' ? Number(form.billing_month) : null,
        start_month: form.start_month,
        category: form.category.trim() || null,
      });
      setForm(emptyForm(month));
      load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(sub) {
    await updateSubscription(sub.id, { is_active: sub.is_active ? 0 : 1 });
    load();
    onChanged();
  }

  async function remove(sub) {
    if (!window.confirm(`Delete "${sub.name}"? This removes it from every month.`)) return;
    await deleteSubscription(sub.id);
    load();
    onChanged();
  }

  const monthlyEquivalent = (s) => (s.cycle === 'yearly' ? s.amount / 12 : s.amount);
  const activeSubs = subs.filter((s) => s.is_active);
  const dueThisMonth = activeSubs.filter((s) => s.dueThisMonth);
  const dueTotal = dueThisMonth.reduce((sum, s) => sum + s.amount, 0);

  return (
    <div className="stack">
      <div className="tiles">
        <div className="tile hero">
          <span className="label">Charged in {formatMonth(month)}</span>
          <span className="value">{dueThisMonth.length}</span>
          <span className="sub">
            of {activeSubs.length} active subscription{activeSubs.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="tile">
          <span className="label">Mixed currencies</span>
          <span className="value" style={{ fontSize: '1rem' }}>
            {[...new Set(dueThisMonth.map((s) => s.currency))].join(', ') || '—'}
          </span>
          <span className="sub">totals shown per account currency below</span>
        </div>
      </div>

      <section className="card stack">
        <h2>Add a subscription</h2>
        <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
          These come out of the chosen account automatically every month — you don't re-enter them.
          They show up in the dashboard totals and reduce that account's balance.
        </p>
        <form className="row" onSubmit={add}>
          <label className="field grow">
            Name
            <input type="text" placeholder="e.g. Netflix" value={form.name} onChange={set('name')} />
          </label>
          <label className="field">
            Amount
            <input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} />
          </label>
          <label className="field grow">
            Paid from
            <select value={form.account_id} onChange={set('account_id')}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.personName} · {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Billing
            <select value={form.cycle} onChange={set('cycle')}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          {form.cycle === 'yearly' && (
            <label className="field">
              Billed in
              <select value={form.billing_month} onChange={set('billing_month')}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Starts
            <input type="month" value={form.start_month} onChange={set('start_month')} />
          </label>
          <label className="field grow">
            Category
            <input type="text" placeholder="optional" value={form.category} onChange={set('category')} />
          </label>
          <button className="primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-end' }}>
            Add
          </button>
        </form>
        {error && <div className="error-text">{error}</div>}
      </section>

      <section className="card stack">
        <div className="spread">
          <h2>Your subscriptions</h2>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {dueThisMonth.length > 0 &&
              `Due this month: ${dueThisMonth
                .reduce((acc, s) => {
                  const found = acc.find((x) => x.currency === s.currency);
                  if (found) found.total += s.amount;
                  else acc.push({ currency: s.currency, total: s.amount });
                  return acc;
                }, [])
                .map((x) => money(x.total, x.currency))
                .join(' + ')}`}
          </span>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Paid from</th>
                <th className="num">Amount</th>
                <th>Billing</th>
                <th className="num">Per month</th>
                <th>This month</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.5 }}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.category && <span className="muted"> · {s.category}</span>}
                  </td>
                  <td>
                    {s.person_name} · {s.account_name}
                  </td>
                  <td className="num">{money(s.amount, s.currency)}</td>
                  <td>
                    {s.cycle === 'yearly'
                      ? `Yearly (${MONTH_NAMES[(s.billing_month || 1) - 1]})`
                      : 'Monthly'}
                  </td>
                  <td className="num muted">{money(monthlyEquivalent(s), s.currency)}</td>
                  <td>
                    {!s.is_active ? (
                      <span className="badge">paused</span>
                    ) : s.dueThisMonth ? (
                      <span className="badge">charged</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <div className="row-tight">
                      <button className="subtle tiny" onClick={() => toggleActive(s)}>
                        {s.is_active ? 'Pause' : 'Resume'}
                      </button>
                      <button className="subtle tiny danger" onClick={() => remove(s)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {subs.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No subscriptions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {dueTotal > 0 && (
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Yearly subscriptions only count in their billing month, but the “per month” column shows
            what they average out to.
          </span>
        )}
      </section>
    </div>
  );
}
