import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Things the app wants to say without stopping you.
//
// Everything here used to be either silent or a native alert. Silent is wrong
// for a write that succeeded — you are left wondering whether the tap landed —
// and an alert is wrong for anything that is not a question, because it takes
// the whole window hostage to say "done".
//
// The one that earns its keep is undo. A confirmation asked before every delete
// trains you to click through it without reading; the alternative is to do the
// thing and leave a way back for a few seconds. That is a better trade for an
// ordinary entry, which is one line you can retype. It is a worse trade for
// anything that erases history, so those still ask first — see ConfirmDialog.

const ToastContext = createContext(null);

// Long enough to notice and reach for, short enough that it is gone before it
// becomes furniture. Undo gets longer, because it is the one you have to read
// and then decide about.
const PLAIN_MS = 3200;
const UNDO_MS = 6000;

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  // Nothing here is a reason to keep a timer alive past the provider.
  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const timer of held.values()) clearTimeout(timer);
      held.clear();
    };
  }, []);

  const show = useCallback(
    (message, options = {}) => {
      const id = nextId++;
      const { onUndo, tone = 'plain' } = options;
      const ms = onUndo ? UNDO_MS : PLAIN_MS;
      setToasts((list) => [...list, { id, message, tone, onUndo, expiresAt: Date.now() + ms }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ms)
      );
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// A live region, so the message reaches somebody using a screen reader without
// moving their focus — which is the whole point of a toast rather than a dialog.
function Toasts({ toasts, dismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} dismiss={dismiss} />
      ))}
    </div>
  );
}

function Toast({ toast, dismiss }) {
  const { id, message, tone, onUndo, expiresAt } = toast;
  return (
    <div className={`toast toast-${tone}`}>
      <span className="toast-text">{message}</span>
      {onUndo && (
        <button
          className="toast-undo"
          onClick={() => {
            dismiss(id);
            onUndo();
          }}
        >
          Undo
          {/* The bar is the deadline made visible. Without it "Undo" is a
              button that silently stops working. */}
          <Countdown until={expiresAt} total={UNDO_MS} />
        </button>
      )}
      <button className="toast-close" onClick={() => dismiss(id)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

function Countdown({ until, total }) {
  const [left, setLeft] = useState(() => Math.max(0, until - Date.now()));
  useEffect(() => {
    const tick = setInterval(() => setLeft(Math.max(0, until - Date.now())), 100);
    return () => clearInterval(tick);
  }, [until]);
  return <i className="toast-countdown" style={{ transform: `scaleX(${left / total})` }} />;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  // A no-op rather than a throw: something rendered outside the provider in a
  // test should not take the screen down over a message nobody was going to
  // read.
  return ctx ?? { show: () => undefined, dismiss: () => undefined };
}
