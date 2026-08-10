import { useCallback, useEffect, useState } from 'react';
import App from './App';
import Login from './pages/Login';
import { getAuthStatus } from './api/auth';
import { UNAUTHORIZED_EVENT } from './api/client';

// Decides which of the two things the app can be: the login screen, or the
// budget. Nothing inside App has to think about signing in, and no data
// request is made until there is a session.
export default function AuthGate() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const check = useCallback(async () => {
    try {
      setStatus(await getAuthStatus());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  // A session that expires mid-use drops straight back to the login form
  // rather than leaving the page half-broken.
  useEffect(() => {
    const onUnauthorized = () => setStatus((s) => (s ? { ...s, user: null } : s));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (error) {
    return (
      <div className="auth-screen">
        <div className="card stack auth-card">
          <h1>Can’t reach the server</h1>
          <span className="secondary">{error}</span>
          <button className="primary" onClick={check}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="auth-screen">
        <div className="card row-tight auth-card">
          <span className="spinner" aria-hidden="true" />
          <span className="secondary">Starting up…</span>
        </div>
      </div>
    );
  }

  if (!status.user) {
    return (
      <Login
        needsSetup={status.needsSetup}
        onSignedIn={(user) => setStatus({ needsSetup: false, user })}
      />
    );
  }

  return <App user={status.user} onSignedOut={() => setStatus({ ...status, user: null })} />;
}
