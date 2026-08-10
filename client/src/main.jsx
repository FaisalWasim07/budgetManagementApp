import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './AuthGate.jsx';
import { applyTheme, loadTheme } from './utils/theme';
import './index.css';

// Applied before the first render so the login screen honours the saved theme
// too — App keeps it in sync from there.
applyTheme(loadTheme());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>
);
