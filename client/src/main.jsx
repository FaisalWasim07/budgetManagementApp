import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './AuthGate.jsx';
import { ToastProvider } from './utils/toast';
import { refresh, registerWorker } from './utils/push';
import { applyTheme, loadTheme } from './utils/theme';
import './index.css';
// Utility classes only, scoped to client/src/vendor/bklit — see that file's
// own comment for why this is safe to import globally despite living beside
// a hand-written CSS system: it carries no reset, and Tailwind v4 only
// generates a class the moment something under vendor/bklit actually uses it.
import './vendor/bklit/tailwind.css';

// Applied before the first render so the login screen honours the saved theme
// too — App keeps it in sync from there.
applyTheme(loadTheme());

// Registered on every load, not only when notifications are switched on: the
// worker is what receives a push, and a browser that already agreed to them
// needs it back in place before the next one arrives. Failing is fine — the
// app has never depended on it for anything else, and the settings panel is
// where a real problem gets diagnosed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    registerWorker()
      // A subscription can be rotated by the browser without asking anyone, so
      // whatever this device holds now is re-sent to the server. Cheap, and it
      // is the difference between notifications quietly stopping one day and
      // them continuing to work.
      .then(() => refresh())
      .catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Outside the auth gate, so a message can outlive the screen that
        raised it — signing out is itself worth confirming. */}
    <ToastProvider>
      <AuthGate />
    </ToastProvider>
  </React.StrictMode>,
);
