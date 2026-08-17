import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './AuthGate.jsx';
import { ToastProvider } from './utils/toast';
import { applyTheme, loadTheme } from './utils/theme';
import './index.css';

// Applied before the first render so the login screen honours the saved theme
// too — App keeps it in sync from there.
applyTheme(loadTheme());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Outside the auth gate, so a message can outlive the screen that
        raised it — signing out is itself worth confirming. */}
    <ToastProvider>
      <AuthGate />
    </ToastProvider>
  </React.StrictMode>
);
