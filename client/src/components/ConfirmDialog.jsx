import Modal from './Modal';

// A question the app asks in its own voice.
//
// window.confirm can only take a string, so every one of these used to read
// "Delete this entry?" and leave you to remember which entry you had tapped. It
// also announces the site's hostname on a phone, blocks the thread while it is
// up, cannot colour the dangerous button as dangerous, and cannot sit over an
// editor that is already open.
//
// The detail is the reason this exists rather than the styling. Passing
// elements rather than a sentence means an amount can go through <Money>, so it
// stays dust while the eye is hiding figures — a native dialog would have to
// choose between saying nothing and spelling the number out past the lock.
//
// Not every destructive thing needs one. Deleting a single ordinary entry is
// one line you could retype, so that one happens and leaves an undo behind; a
// dialog in front of everything is a dialog nobody reads. These are for the
// ones that take something you cannot type back: both halves of a transfer, or
// a recurring item's whole history.
export default function ConfirmDialog({
  title,
  detail,
  confirmLabel = 'Delete',
  destructive = true,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal className="confirm" title={title} onClose={busy ? () => {} : onCancel}>
      {detail && <div className="confirm-detail">{detail}</div>}
      {error && <div className="error-text">{error}</div>}
      <div className="confirm-actions">
        {/* Cancel first in the DOM, so the safe answer is the one a keyboard
            reaches first and the one already focused. */}
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={destructive ? 'primary danger-solid' : 'primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
