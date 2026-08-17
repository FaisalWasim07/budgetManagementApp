import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { createTransfer } from '../api/transactions';
import { listSubscriptions } from '../api/subscriptions';
import { useLive } from '../utils/live';
import { isRunning, perMonth } from '../utils/recurring';
import { Money, useDisplay } from '../utils/display';
import { formatNumber } from '../utils/currency';
import { Plus, Trash } from './icons';

// Both accounts carry their own rate into the household's primary currency, so
// going from one to the other is just via that: AED per PKR divided by AED per
// whatever you are sending. Null when either side has no rate, which is a real
// state — a currency the app has never managed to fetch.
function convertBetween(amount, from, to) {
  const fromRate = from?.rate?.rate;
  const toRate = to?.rate?.rate;
  if (!(amount > 0) || fromRate == null || toRate == null || !toRate) return null;
  const converted = (amount * fromRate) / toRate;
  // Cents matter on a hundred; on a hundred thousand rupees they are noise, and
  // an estimate carrying two decimals looks more certain than it is.
  return converted >= 1000 ? Math.round(converted) : Math.round(converted * 100) / 100;
}

// Rounded to cents on the way out of a percentage, or 30% of 30,000 arrives as
// 8999.999999999998 and the total refuses to match the balance it plainly fits.
const round2 = (n) => Math.round(n * 100) / 100;

let nextKey = 1;
const blankRow = (toId = '') => ({ key: nextKey++, toId: String(toId), amount: '', toAmount: '', own: false });

// Money out of one account and into one or more others.
//
// The several-destinations case is not a different feature: it is the same
// transfer repeated, and it is how a salary actually gets allocated — some to
// savings, some put aside, some left where it is. Doing that as four separate
// trips through this dialog meant re-picking the source four times and adding
// the total up in your head to know whether it fitted.
export default function TransferModal({ accounts, month, onClose, onSaved }) {
  const [fromId, setFromId] = useState(accounts[0]?.id ?? '');
  const [rows, setRows] = useState(() => [blankRow(accounts[1]?.id ?? '')]);
  // What the shares are shares *of*. Nothing here is sent or stored — it only
  // decides what the percentages are measured against, and it resets every time
  // the dialog opens.
  const [basisKind, setBasisKind] = useState('balance');
  const [customBasis, setCustomBasis] = useState('');
  // Type the amount, or type the share and let it work the amount out.
  const [mode, setMode] = useState('amount');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { money } = useDisplay();

  // Under the key every other screen reads, so this costs nothing if Home or
  // Recurring has already been open.
  const { data: subscriptions } = useLive(`subscriptions:${month}`, () =>
    listSubscriptions(month)
  );

  const from = useMemo(() => accounts.find((a) => a.id === Number(fromId)), [accounts, fromId]);
  const others = useMemo(
    () => accounts.filter((a) => a.id !== Number(fromId)),
    [accounts, fromId]
  );

  // Changing the source changes every arithmetic on screen, and can leave a row
  // pointing at the account the money is now coming out of.
  useEffect(() => {
    setRows((current) =>
      current.map((row) =>
        Number(row.toId) === Number(fromId)
          ? { ...row, toId: '', amount: row.amount, toAmount: '', own: false }
          : { ...row, toAmount: '', own: false }
      )
    );
  }, [fromId]);

  // Switching between amount and share rewrites what is already in the boxes
  // rather than reinterpreting it. Typing 5,000 and switching to shares should
  // show what 5,000 is a share of, not read 5,000 as five thousand per cent.
  const switchMode = (next) => {
    if (next === mode) return;
    setRows((current) =>
      current.map((row) => {
        const typed = Number(row.amount);
        if (!(typed > 0) || !(basis > 0)) return { ...row, amount: '' };
        return {
          ...row,
          amount: String(
            next === 'percent' ? round2((typed / basis) * 100) : round2((typed / 100) * basis)
          ),
        };
      })
    );
    setMode(next);
  };

  const setRow = (key, patch) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // Cards are allowed to go negative — that's borrowing, not an overdraft.
  const fromIsCredit = from?.type === 'credit';
  const available = from ? from.balance : 0;

  // The salary is whatever recurring income is paid *into* the account the
  // money is leaving — so there is never a question of which salary is meant,
  // and changing the source changes the figure with it. Same account, so same
  // currency: nothing to convert.
  const salary = (subscriptions ?? [])
    .filter(
      (item) =>
        item.account_id === Number(fromId) &&
        item.direction === 'income' &&
        isRunning(item, month)
    )
    .reduce((sum, item) => sum + perMonth(item), 0);

  const basis =
    basisKind === 'salary' ? salary : basisKind === 'custom' ? Number(customBasis) || 0 : available;
  const share = (value) => (basis > 0 ? (value / basis) * 100 : null);
  // A share of nothing is not a share, and neither is a share of a balance the
  // eye is currently hiding — though the percentage itself gives no amount away,
  // so it stays visible.
  const canShare = basis > 0;

  const legs = rows.map((row) => {
    const to = accounts.find((a) => a.id === Number(row.toId));
    // In percent mode the box holds a share and the amount is worked out from
    // the basis; in amount mode it is the amount itself. One canonical figure
    // either way, so everything downstream is unchanged.
    const typed = Number(row.amount) || 0;
    const amount = mode === 'percent' ? round2((typed / 100) * basis) : typed;
    const crossCurrency = Boolean(from && to && from.currency !== to.currency);
    const estimate = crossCurrency ? convertBetween(amount, from, to) : null;
    return { row, to, amount, crossCurrency, estimate };
  });

  // The estimate fills the arriving amount until you type your own, and then it
  // leaves it alone — the bank's number always wins over the app's guess.
  useEffect(() => {
    for (const leg of legs) {
      if (leg.crossCurrency && !leg.row.own) {
        const next = leg.estimate == null ? '' : String(leg.estimate);
        if (leg.row.toAmount !== next) setRow(leg.row.key, { toAmount: next });
      }
    }
    // legs is rebuilt every render; the values that matter are inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, fromId]);

  // The total is the figure that has to fit. Four amounts that are each
  // affordable on their own are not the same as four amounts that are
  // affordable together, and it is the second one that decides.
  const total = legs.reduce((sum, leg) => sum + leg.amount, 0);
  const overdrawn = !fromIsCredit && total > available;
  const remaining = available - total;

  const chosen = legs.filter((leg) => leg.to).map((leg) => leg.to.id);
  const duplicated = new Set(chosen).size !== chosen.length;
  const missingArrival = legs.some(
    (leg) => leg.amount > 0 && leg.crossCurrency && !(Number(leg.row.toAmount) > 0)
  );
  const nothingToSend = !legs.some((leg) => leg.to && leg.amount > 0);
  // A row you added and have not finished blocks the send. Sending anyway and
  // quietly leaving it out is the worst of the options: you asked for four
  // destinations and got three, and nothing said so.
  const unfinished = legs.some((leg) => !leg.to || !(leg.amount > 0));
  const blocked = overdrawn || duplicated || nothingToSend || unfinished || missingArrival;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (nothingToSend) {
      setError('Pick an account and an amount greater than zero.');
      return;
    }
    if (unfinished) {
      setError('Every row needs an account and an amount. Fill it in, or remove the row.');
      return;
    }
    if (duplicated) {
      setError('The same account is listed twice. Put it in one row, or remove one.');
      return;
    }
    if (overdrawn) {
      setError(
        `That comes to ${money(total, from.currency)}, and ${from.name} only has ` +
          `${money(available, from.currency)}. Reduce a row, or move money in first.`
      );
      return;
    }
    if (missingArrival) {
      setError('Enter how much arrives for every account in another currency.');
      return;
    }

    setBusy(true);
    try {
      await createTransfer({
        from_account_id: Number(fromId),
        month,
        to: legs
          .filter((leg) => leg.to && leg.amount > 0)
          .map((leg) => ({
            account_id: leg.to.id,
            amount: leg.amount,
            ...(leg.crossCurrency ? { to_amount: Number(leg.row.toAmount) } : {}),
          })),
      });
      onClose();
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // The source carries its balance, because that is the figure everything else
  // on screen is measured against. A destination does not: in a column this
  // narrow the balance pushed the account's own name out of view, and the name
  // is the part you are picking by.
  const sourceLabel = (a) =>
    `${a.personName} · ${a.name} (${a.currency}) — ${money(a.balance, a.currency, { compact: true })}`;
  const label = (a) => `${a.personName} · ${a.name} (${a.currency})`;

  return (
    <Modal title="Move money between accounts" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span className="label">From</span>
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {sourceLabel(a)}
              </option>
            ))}
          </select>
          {from && (
            <span className="muted">
              {fromIsCredit
                ? 'Credit card — moving off it adds to what you owe.'
                : `Available: ${money(available, from.currency)}`}
            </span>
          )}
        </label>

        {/* Shown against, not sent: this only decides what the shares below are
            measured against, and it is gone when the dialog closes. */}
        <div className="basis">
          <div className="seg three" role="group" aria-label="Show shares of">
            <button
              type="button"
              className={basisKind === 'balance' ? 'active' : ''}
              aria-pressed={basisKind === 'balance'}
              onClick={() => setBasisKind('balance')}
            >
              This balance
            </button>
            <button
              type="button"
              className={basisKind === 'salary' ? 'active' : ''}
              aria-pressed={basisKind === 'salary'}
              disabled={!(salary > 0)}
              title={
                salary > 0
                  ? undefined
                  : 'No recurring income is paid into this account, so there is no salary to measure against.'
              }
              onClick={() => setBasisKind('salary')}
            >
              Salary
            </button>
            <button
              type="button"
              className={basisKind === 'custom' ? 'active' : ''}
              aria-pressed={basisKind === 'custom'}
              onClick={() => setBasisKind('custom')}
            >
              Custom
            </button>
          </div>

          <div className="basis-figure">
            {basisKind === 'custom' ? (
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={customBasis}
                aria-label="Figure to measure shares against"
                placeholder={`Figure in ${from?.currency ?? ''}`}
                onChange={(e) => setCustomBasis(e.target.value)}
              />
            ) : (
              <span className="muted">
                Shares of{' '}
                <b>
                  <Money amount={basis} currency={from?.currency} compact />
                </b>
                {basisKind === 'salary' && ' — the recurring income paid into this account'}
              </span>
            )}
          </div>
        </div>

        <div className="seg two enter-as" role="group" aria-label="Enter as">
          <button
            type="button"
            className={mode === 'amount' ? 'active' : ''}
            aria-pressed={mode === 'amount'}
            onClick={() => switchMode('amount')}
          >
            Enter amounts
          </button>
          <button
            type="button"
            className={mode === 'percent' ? 'active' : ''}
            aria-pressed={mode === 'percent'}
            disabled={!canShare}
            onClick={() => switchMode('percent')}
          >
            Enter shares
          </button>
        </div>

        <div className="split-rows">
          {legs.map(({ row, to, amount, crossCurrency, estimate }) => (
            <div className="split-row" key={row.key}>
              <div className="split-main">
                <select
                  value={row.toId}
                  aria-label="To account"
                  onChange={(e) => setRow(row.key, { toId: e.target.value, own: false })}
                >
                  <option value="">Which account?</option>
                  {others.map((a) => (
                    <option key={a.id} value={a.id}>
                      {label(a)}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="split-amount"
                  placeholder="0"
                  aria-label={
                    mode === 'percent'
                      ? `Share to send${to ? ` to ${to.name}` : ''}`
                      : `Amount to send${to ? ` to ${to.name}` : ''}`
                  }
                  value={row.amount}
                  onChange={(e) => setRow(row.key, { amount: e.target.value })}
                />

                {/* The other half of the pair: type an amount and read the
                    share, or type a share and read the amount. */}
                <span className="split-share">
                  {mode === 'percent' ? (
                    amount > 0 && <Money amount={amount} currency={from?.currency} compact />
                  ) : canShare && amount > 0 ? (
                    `${Math.round(share(amount))}%`
                  ) : null}
                </span>

                {/* Only once there is more than one — a lone row has nothing to
                    be removed from. */}
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="icon-button small danger"
                    title="Remove"
                    aria-label={`Remove ${to ? to.name : 'this row'}`}
                    onClick={() => setRows((c) => c.filter((r) => r.key !== row.key))}
                  >
                    <Trash />
                  </button>
                )}
              </div>

              {crossCurrency && (
                <label className="field split-arriving">
                  <span className="label">Arriving in {to.currency}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={row.toAmount}
                    aria-label={`Amount arriving in ${to.name}`}
                    onChange={(e) => setRow(row.key, { toAmount: e.target.value, own: true })}
                  />
                  <span className="muted">
                    {estimate == null
                      ? `No ${from.currency}→${to.currency} rate, so enter what actually lands.`
                      : 'Estimated at today’s rate. Change it to what your bank gave you.'}
                    {Number(row.amount) > 0 && Number(row.toAmount) > 0 && (
                      <>
                        {' '}
                        1 {from.currency} ={' '}
                        <strong>
                          {formatNumber(Number(row.toAmount) / Number(row.amount))} {to.currency}
                        </strong>
                        .
                      </>
                    )}
                  </span>
                </label>
              )}
            </div>
          ))}
        </div>

        {others.length > rows.length && (
          <button
            type="button"
            className="subtle add-destination"
            onClick={() => setRows((c) => [...c, blankRow()])}
          >
            <Plus size={14} /> Add another account
          </button>
        )}

        {/* What it comes to, and what is left. The second number is the one you
            are really deciding about. */}
        {from && (
          <div className={overdrawn ? 'split-total over' : 'split-total'}>
            <span className="k">Sending</span>
            <b>
              <Money amount={total} currency={from.currency} compact />
            </b>
            {canShare && total > 0 && (
              <span className="of-basis">
                {Math.round(share(total))}% of{' '}
                {basisKind === 'salary' ? 'salary' : basisKind === 'custom' ? 'that' : 'the balance'}
              </span>
            )}
            <span className="rest">
              {overdrawn ? (
                <>
                  <Money amount={total - available} currency={from.currency} compact /> more than{' '}
                  {from.name} has
                </>
              ) : (
                <>
                  <Money amount={remaining} currency={from.currency} compact /> stays
                </>
              )}
            </span>
          </div>
        )}

        {/* Only once something has been entered — saying it over an untouched
            form would be telling you off for having just opened it. */}
        {unfinished && total > 0 && (
          <span className="muted">Every row needs an account and an amount.</span>
        )}
        {duplicated && (
          <div className="error-text">The same account is listed twice.</div>
        )}
        {error && <div className="error-text">{error}</div>}

        <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || blocked}>
            {busy ? (
              <>
                <span className="spinner on-button" aria-hidden="true" /> Saving…
              </>
            ) : (
              'Transfer'
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
