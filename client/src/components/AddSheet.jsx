import { useEffect, useRef, useState } from 'react';
import { createTransaction, createTransfer, listCategories } from '../api/transactions';
import { convertBetween } from './TransferModal';
import { useLive } from '../utils/live';
import { Exchange } from './icons';
import { useScrollLock } from '../utils/scrollLock';
import { useToast } from '../utils/toast';
import { useDisplay } from '../utils/display';

// Money moved between two of your own accounts is the third choice at the top
// rather than a button under Save. Under Save it came after the whole form,
// and people filled the form in as "Received" into savings before ever seeing
// it. A move to one account is done here; splitting across several, or by
// share of a salary, is the full dialog, a tap away.
const MOVE = 'transfer';

// The phone half of entering money: thumb at the bottom of the screen, the
// amount the biggest thing on it, and one tap to save. Also what "Add to this
// account" opens on any size of screen, since it already knows the account.
export default function AddSheet({
  open,
  accounts,
  month,
  defaultAccountId,
  onClose,
  onSaved,
  onMove,
}) {
  const [kind, setKind] = useState('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [category, setCategory] = useState('');
  // True once "New category…" is picked: the dropdown then stands aside for a
  // box to type one into.
  const [typing, setTyping] = useState(false);
  // Every category used before, most used first, per kind. Live, so one
  // typed into this sheet is in the list the next time it opens.
  const { data: used } = useLive('categories', listCategories);
  const [description, setDescription] = useState('');
  // Moving: where it goes, and, between currencies, what arrives. The arriving
  // figure follows today's rate until it is typed over, because the bank's
  // number always wins over the app's guess.
  const [toId, setToId] = useState('');
  const [arriving, setArriving] = useState('');
  const [ownArriving, setOwnArriving] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { show } = useToast();
  // Through the same formatter the screen uses, so a confirmation cannot spell
  // out a figure the eye is currently hiding.
  const { money } = useDisplay();
  const amountField = useRef(null);
  const newCategoryField = useRef(null);
  const sheetRef = useRef(null);
  // The sheet slides over the page; the page must not slide with it.
  useScrollLock(open);

  // Each opening starts clean, on whichever account it was opened from.
  useEffect(() => {
    if (!open) return;
    setAmount('');
    setCategory('');
    setTyping(false);
    setDescription('');
    setError(null);
    setArriving('');
    setOwnArriving(false);
    setAccountId(String(defaultAccountId ?? accounts[0]?.id ?? ''));
    // Waited out rather than done immediately: focusing mid-slide makes some
    // browsers scroll to the element and fight the transition.
    const focus = setTimeout(() => amountField.current?.focus(), 220);
    return () => clearTimeout(focus);
  }, [open, defaultAccountId, accounts]);

  // Whatever opened the sheet gets the keyboard back when it closes — usually
  // the + in the tab bar, which is where you would want to be to add another.
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    return () => opener?.focus?.({ preventScroll: true });
  }, [open]);

  // The same Tab loop the dialogs use. The sheet stays in the DOM when closed,
  // but `visibility: hidden` takes it out of the tab order, so this only ever
  // applies while it is open.
  const trapTab = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = [
      ...(sheetRef.current?.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) ?? []),
    ].filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const escape = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, onClose]);

  const account = accounts.find((a) => a.id === Number(accountId)) ?? accounts[0];
  const NEW = '__new';
  const choices = used?.[kind] ?? [];

  const moving = kind === MOVE;
  const others = accounts.filter((a) => a.id !== account?.id);
  // Savings first as the place money goes, since that is where most moves go.
  const defaultTo = (others.find((a) => a.type === 'savings') ?? others[0])?.id;
  const to = others.find((a) => a.id === Number(toId)) ?? others.find((a) => a.id === defaultTo);
  const crossCurrency = Boolean(moving && account && to && account.currency !== to.currency);
  const estimate = crossCurrency ? convertBetween(Number(amount), account, to) : null;
  const arrivingValue = crossCurrency ? (ownArriving ? arriving : estimate == null ? '' : String(estimate)) : '';
  // Cards may go below zero: moving off one is borrowing, not an overdraft.
  const overdrawn = moving && account && account.type !== 'credit' && Number(amount) > account.balance;

  // Switching between spent and received swaps the list, so a category picked
  // from one is not left selected against the other.
  const switchKind = (next) => {
    if (next === kind) return;
    setKind(next);
    setError(null);
    if (!typing) setCategory('');
  };

  const pickCategory = (value) => {
    if (value === NEW) {
      setTyping(true);
      setCategory('');
      setTimeout(() => newCategoryField.current?.focus(), 0);
    } else {
      setTyping(false);
      setCategory(value);
    }
  };

  async function save() {
    setError(null);
    const value = Number(amount);
    if (!account) {
      setError('Add an account first.');
      return;
    }
    if (!(value > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (moving) {
      await move(value);
      return;
    }
    setBusy(true);
    try {
      await createTransaction({
        account_id: account.id,
        month,
        kind,
        amount: value,
        category: category.trim() || null,
        description: description.trim() || null,
      });
      // Closed as soon as the entry is recorded. Waiting for the figures to be
      // recomputed as well kept the sheet up for the length of four round
      // trips, which on a slow connection is a form that looks frozen. The
      // refresh runs behind it, with the top bar's spinner saying so.
      onClose();
      onSaved();
      // After onClose, not before: the sheet sliding away and the confirmation
      // arriving at the same moment is what makes the tap feel finished.
      show(kind === 'income' ? 'Money in, recorded' : 'Spending recorded', {
        tone: 'success',
        body: [money(value, account.currency), account.name, description.trim() || category.trim()]
          .filter(Boolean)
          .join(' · '),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function move(value) {
    if (!to) {
      setError('Pick the account the money goes to.');
      return;
    }
    if (overdrawn) {
      setError(
        `${account.name} has ${money(account.balance, account.currency)}. ` +
          'Move less, or move money into it first.'
      );
      return;
    }
    if (crossCurrency && !(Number(arrivingValue) > 0)) {
      setError(`Enter how much arrives in ${to.name}, in ${to.currency}.`);
      return;
    }
    setBusy(true);
    try {
      await createTransfer({
        from_account_id: account.id,
        month,
        description: description.trim() || null,
        to: [
          {
            account_id: to.id,
            amount: value,
            ...(crossCurrency ? { to_amount: Number(arrivingValue) } : {}),
          },
        ],
      });
      onClose();
      onSaved();
      show('Money moved', {
        tone: 'success',
        body: [`${money(value, account.currency)} from ${account.name} to ${to.name}`, description.trim()]
          .filter(Boolean)
          .join(' · '),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && <div className="sheet-scrim" onClick={onClose} />}
      <div
        className={open ? 'sheet open' : 'sheet'}
        ref={sheetRef}
        onKeyDown={trapTab}
        role="dialog"
        aria-modal="true"
        aria-label="Add money"
        aria-hidden={!open}
      >
        <div className="grabber" />

        <div className="seg" role="group" aria-label="What happened">
          <button
            className={kind === 'expense' ? 'active' : ''}
            aria-pressed={kind === 'expense'}
            onClick={() => switchKind('expense')}
          >
            Spent
          </button>
          <button
            className={kind === 'income' ? 'active' : ''}
            aria-pressed={kind === 'income'}
            onClick={() => switchKind('income')}
          >
            Received
          </button>
          <button
            className={moving ? 'active' : ''}
            aria-pressed={moving}
            onClick={() => switchKind(MOVE)}
            disabled={accounts.length < 2}
            title={accounts.length < 2 ? 'Moving money needs a second account.' : undefined}
          >
            Moved
          </button>
        </div>

        <div className="amount-field">
          <div className="cur">{account?.currency ?? ''}</div>
          <input
            ref={amountField}
            className="num"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            aria-label="Amount"
          />
        </div>

        <label className="field">
          <span className="label">{kind === 'income' ? 'Into' : 'From'}</span>
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setOwnArriving(false);
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.personName} · {a.name} ({a.currency})
                {moving ? ` — ${money(a.balance, a.currency, { compact: true })}` : ''}
              </option>
            ))}
          </select>
          {moving && account && (
            <span className={overdrawn ? 'muted over' : 'muted'}>
              {account.type === 'credit'
                ? 'Credit card: moving off it adds to what you owe.'
                : overdrawn
                  ? `More than the ${money(account.balance, account.currency)} it has`
                  : `Available: ${money(account.balance, account.currency)}`}
            </span>
          )}
        </label>

        {moving && (
          <>
            <label className="field" style={{ marginTop: 14 }}>
              <span className="label">To</span>
              <select
                value={to?.id ?? ''}
                onChange={(e) => {
                  setToId(e.target.value);
                  setOwnArriving(false);
                }}
                aria-label="To account"
              >
                {others.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.personName} · {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </label>
            {crossCurrency && (
              <label className="field" style={{ marginTop: 14 }}>
                <span className="label">Arriving in {to.currency}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={arrivingValue}
                  onChange={(e) => {
                    setArriving(e.target.value.replace(/[^\d.]/g, ''));
                    setOwnArriving(true);
                  }}
                  aria-label={`Amount arriving in ${to.name}`}
                />
                <span className="muted">
                  {estimate == null && !ownArriving
                    ? `No ${account.currency}→${to.currency} rate, so enter what actually lands.`
                    : 'At today’s rate. Change it to what your bank gave you.'}
                </span>
              </label>
            )}
          </>
        )}

        {/* A dropdown, the same shape as the account above it, rather than a
            row of six chips and a box: the chips only ever held this month's
            top six, and anything older had to be typed again from memory.
            Typing a new one is the last choice in the list. */}
        {!moving && (
        <label className="field" style={{ marginTop: 14 }}>
          <span className="label">Category</span>
          <select
            value={typing ? NEW : category}
            onChange={(e) => pickCategory(e.target.value)}
            aria-label="Category"
          >
            <option value="">No category</option>
            {choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={NEW}>New category…</option>
          </select>
        </label>
        )}
        {!moving && typing && (
          <div className="new-category">
            <input
              ref={newCategoryField}
              type="text"
              placeholder={kind === 'income' ? 'e.g. Salary' : 'e.g. Groceries'}
              value={category}
              maxLength={60}
              onChange={(e) => setCategory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              aria-label="New category"
            />
            <button
              type="button"
              className="subtle tiny"
              onClick={() => {
                setTyping(false);
                setCategory('');
              }}
            >
              Back to list
            </button>
          </div>
        )}

        {/* What it was, in your words. The category groups it; this is how you
            recognise it again in Activity a month from now, so it is what
            Activity shows as the entry's name. One line, because a sheet you
            fill in at a till is no place for a paragraph. */}
        <label className="field" style={{ marginTop: 14 }}>
          <span className="label">
            Description <span className="optional">optional</span>
          </span>
          <input
            type="text"
            placeholder={
              moving ? 'e.g. November savings' : kind === 'income' ? 'e.g. November invoice' : 'e.g. Weekly shop at Carrefour'
            }
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            aria-label="Description"
          />
        </label>

        {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}

        <button
          className="primary"
          onClick={save}
          disabled={busy}
          style={{ width: '100%', marginTop: 16, padding: '12px' }}
        >
          {busy ? (
            <>
              <span className="spinner on-button" aria-hidden="true" /> Saving…
            </>
          ) : moving ? (
            'Move'
          ) : (
            'Save'
          )}
        </button>

        {/* One account at a time here. Several at once, or by share of a
            salary, is the full dialog. */}
        {moving && (
          <button
            type="button"
            className="move-split"
            onClick={() => {
              onClose();
              onMove();
            }}
          >
            <Exchange />
            Split across several accounts
          </button>
        )}
      </div>
    </>
  );
}
