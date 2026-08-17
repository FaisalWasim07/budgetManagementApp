import { useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import { Money } from './display';
import { createTransaction, deleteTransaction } from '../api/transactions';
import { useToast } from './toast';

// Removing an entry, and how much ceremony that deserves.
//
// Two screens list the same rows and both offered the same delete, so they held
// the same function twice and it drifted — the wording was already different in
// one of them. It lives here now, and so does the decision about which deletes
// are worth stopping for.
//
// An ordinary entry is a few fields you could type again in ten seconds, so it
// goes immediately and leaves an undo behind. A transfer is not: it is two rows
// in two accounts, and putting it back means recreating both sides in the right
// order with the right amounts, which an undo button has no business promising.
// So that one asks first, and says what it is about to take.
// Enough to recognise which one just went, so the undo is a decision rather
// than a reflex — the row itself is no longer on screen to check against.
const describeRow = (row) =>
  [row.category || row.description || null, row.account_name].filter(Boolean).join(' · ') ||
  'It can be put back for a few seconds.';

export function useEntryDelete({ reload, onChanged, afterDelete }) {
  const { show } = useToast();
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const done = () => {
    reload();
    onChanged?.();
    afterDelete?.();
  };

  // Returns true when the row is gone, false when a question is now on screen
  // instead — the editors use it to decide whether to close themselves.
  async function request(row, rows) {
    if (row.transfer_id) {
      setError(null);
      setPending({ row, legs: rows.filter((x) => x.transfer_id === row.transfer_id) });
      return false;
    }

    await deleteTransaction(row.id);
    done();
    show('Entry deleted', {
      body: describeRow(row),
      tone: 'removed',
      onUndo: async () => {
        // A new row rather than the old one restored: the ledger only ever
        // appends, and nothing anywhere refers to an entry by its id.
        await createTransaction({
          account_id: row.account_id,
          month: row.month,
          kind: row.kind,
          amount: row.amount,
          category: row.category ?? null,
          description: row.description ?? null,
          entry_date: row.entry_date ?? null,
        });
        reload();
        onChanged?.();
      },
    });
    return true;
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      // Deleting either leg takes both — the server pairs them by transfer_id —
      // so this is one call, not one per side.
      await deleteTransaction(pending.row.id);
      setPending(null);
      done();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const dialog = pending ? (
    <ConfirmDialog
      title="Delete this transfer?"
      busy={busy}
      error={error}
      onCancel={() => setPending(null)}
      onConfirm={confirm}
      detail={
        <>
          <span>Both sides are removed, and this one cannot be undone.</span>
          {pending.legs.map((leg) => (
            <span className="confirm-line" key={leg.id}>
              <span>
                {leg.kind === 'transfer_out' ? 'Out of' : 'Into'} <b>{leg.account_name}</b>
              </span>
              {/* Through Money, so it stays dust while the eye is hiding
                  figures rather than spelling the amount out past the lock. */}
              <Money amount={leg.amount} currency={leg.currency} />
            </span>
          ))}
        </>
      }
    />
  ) : null;

  return { request, dialog };
}
