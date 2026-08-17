import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Bang, Bulb, Check, Cross } from '../components/icons';

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
const PLAIN_MS = 3600;
const UNDO_MS = 6000;
// Must match the exit transition in the stylesheet.
const EXIT_MS = 200;

// Four kinds, each with a glyph that says what it is before the words do.
const TONES = {
  success: Check,
  info: Bulb,
  warn: Bang,
  error: Cross,
};

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  // Marked on the way out and removed a beat later. Appearing with an
  // animation and then vanishing without one is what made these feel like
  // they were being cut off rather than leaving.
  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    const off = setTimeout(() => {
      timers.current.delete(`out:${id}`);
      setToasts((list) => list.filter((t) => t.id !== id));
    }, EXIT_MS);
    timers.current.set(`out:${id}`, off);
  }, []);

  // Nothing here is a reason to keep a timer alive past the provider.
  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const timer of held.values()) clearTimeout(timer);
      held.clear();
    };
  }, []);

  // `title` is the line in bold; `body` is the sentence under it. Both, because
  // a toast that says only "Deleted" makes you work out what was deleted, and
  // one that says only the sentence has nothing to catch the eye.
  const show = useCallback(
    (title, options = {}) => {
      const id = nextId++;
      const { body = null, onUndo, tone = 'info' } = options;
      const ms = onUndo ? UNDO_MS : PLAIN_MS;
      setToasts((list) => [
        ...list,
        { id, title, body, tone: TONES[tone] ? tone : 'info', onUndo, life: ms },
      ]);
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
  const { id, title, body, tone, onUndo, life, leaving } = toast;
  const Glyph = TONES[tone];
  return (
    <div
      className={`toast toast-${tone}${leaving ? ' leaving' : ''}`}
      style={{ '--toast-life': `${life}ms` }}
    >
      <span className="toast-badge">
        <Glyph />
      </span>
      <span className="toast-text">
        <b>{title}</b>
        {body && <small>{body}</small>}
      </span>
      {onUndo && (
        <button
          className="toast-undo"
          onClick={() => {
            dismiss(id);
            onUndo();
          }}
        >
          Undo
        </button>
      )}
      <button className="toast-close" onClick={() => dismiss(id)} aria-label="Dismiss">
        <Cross size={15} />
      </button>
      {/* How long is left, as a hairline along the bottom edge. Pure CSS: it
          used to be a bar inside the Undo button driven by a 100ms interval,
          which re-rendered the toast sixty times to animate two pixels. */}
      <i className="toast-life" aria-hidden="true" />
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  // A no-op rather than a throw: something rendered outside the provider in a
  // test should not take the screen down over a message nobody was going to
  // read.
  return ctx ?? { show: () => undefined, dismiss: () => undefined };
}
