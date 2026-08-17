import { useCallback, useEffect, useState } from 'react';
import {
  listPasskeys,
  startPasskeyRegistration,
  finishPasskeyRegistration,
  removePasskey,
  newRecoveryCodes,
} from '../api/auth';
import { Shield, Trash } from './icons';
import { createPasskey, passkeysSupported, wasCancelled } from '../utils/passkey';
import { setLockAmounts } from '../api/auth';
import { UNLOCK_MINUTES } from '../utils/lock';

const when = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

// A sensible default label, so nobody has to name their own phone before they
// can use it. It is only a hint from the browser, and it is editable after.
function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}

// Recovery codes are shown once, at the moment they are made. Everything about
// this block is built to make that obvious — you cannot dismiss it without
// saying you have them.
function RecoveryCodes({ codes, onDone }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');

  return (
    <div className="card stack-sm recovery">
      <strong style={{ fontSize: '.9rem' }}>Save these recovery codes</strong>
      <span className="muted" style={{ fontSize: '.8rem' }}>
        This is the only time they are shown. Each works once, and they are the way back in if you
        lose your device — put them somewhere that is not this app.
      </span>

      <ol className="codes">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>

      <div className="row-tight">
        <button
          type="button"
          className="tiny"
          onClick={() => navigator.clipboard?.writeText(text).catch(() => {})}
        >
          Copy
        </button>
        <label className="row-tight" style={{ fontSize: '.82rem', gap: 6 }}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I’ve saved them
        </label>
        <button type="button" className="primary tiny" disabled={!saved} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

// Passkeys are the app's second factor. The password gets you as far as a
// challenge; the device signs it. Nothing here is a secret worth stealing —
// the server holds only public keys.
export default function PasskeySettings({ locked, onLockedChange }) {
  const [passkeys, setPasskeys] = useState(null);
  const [codesLeft, setCodesLeft] = useState(0);
  const [codes, setCodes] = useState(null);
  const [confirming, setConfirming] = useState(null); // { id, label } | 'codes'
  const [savingLock, setSavingLock] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const data = await listPasskeys();
    setPasskeys(data.passkeys);
    setCodesLeft(data.recoveryCodesLeft);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { challengeId, options } = await startPasskeyRegistration();
      const response = await createPasskey(options);
      const result = await finishPasskeyRegistration(challengeId, response, guessDeviceName());
      await load();
      // Only the first one comes with codes, which is also the moment the
      // account stops being openable by password alone.
      if (result.recoveryCodes) setCodes(result.recoveryCodes);
      else setNote('Passkey added.');
    } catch (err) {
      if (!wasCancelled(err)) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (confirming === 'codes') {
        const result = await newRecoveryCodes(password);
        setCodes(result.recoveryCodes);
      } else {
        const result = await removePasskey(confirming.id, password);
        setNote(
          result.passkeysLeft === 0
            ? 'That was your last passkey — your password is the only lock on this account again.'
            : 'Passkey removed.'
        );
      }
      setConfirming(null);
      setPassword('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />;
  }

  const on = passkeys && passkeys.length > 0;

  return (
    <div className="stack-sm">
      <div className="spread">
        <strong style={{ fontSize: '0.9rem' }}>Passkeys</strong>
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {on ? `On · ${codesLeft} recovery code${codesLeft === 1 ? '' : 's'} left` : 'Off'}
        </span>
      </div>

      <span className="muted" style={{ fontSize: '0.8rem' }}>
        {on
          ? 'Signing in asks for your password, then your face, fingerprint or device PIN. A passkey only works on this site, so it can’t be given away to a copy of it.'
          : 'Add one and signing in will ask for your face, fingerprint or device PIN after your password. Nothing to type, and nothing to install.'}
      </span>

      {!passkeysSupported() && (
        <div className="warn-banner">
          This browser can’t make passkeys. Open the app on your phone or a current desktop browser
          to add one.
        </div>
      )}

      {/* Only worth offering once there is a passkey to open it with. The
          server refuses to turn it on without one for the same reason. */}
      {on && (
        <label className="lock-amounts">
          <input
            type="checkbox"
            checked={Boolean(locked)}
            disabled={savingLock}
            onChange={async (e) => {
              const next = e.target.checked;
              setSavingLock(true);
              setError(null);
              try {
                await setLockAmounts(next);
                onLockedChange?.(next);
              } catch (err) {
                setError(err.message);
              } finally {
                setSavingLock(false);
              }
            }}
          />
          <span>
            <b>Ask before showing my amounts</b>
            <small>
              The eye asks for your face, fingerprint or device PIN before any figure appears, and
              hides them again after {UNLOCK_MINUTES} minutes. It follows your account, so it
              applies wherever you sign in. Everyone else in the household answers for themselves.
            </small>
          </span>
        </label>
      )}

      {passkeys && passkeys.length > 0 && (
        <div className="rows passkey-rows">
          {passkeys.map((key) => (
            <div className="passkey-row" key={key.id}>
              <span className="tile">
                <Shield />
              </span>
              <span className="what">
                <b>{key.label}</b>
                <small>
                  {[
                    when(key.created_at) && `added ${when(key.created_at)}`,
                    key.last_used_at ? `last used ${when(key.last_used_at)}` : 'not used yet',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <button
                className="icon-button small danger"
                title="Remove"
                aria-label={`Remove ${key.label}`}
                onClick={() => {
                  setConfirming(key);
                  setNote(null);
                  setError(null);
                }}
              >
                <Trash />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirming && (
        <div className="stack-sm">
          <label className="field">
            {confirming === 'codes' ? 'Password, to make new codes' : `Password, to remove ${confirming.label}`}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
            <span className="muted">
              {confirming === 'codes'
                ? 'Your old codes stop working.'
                : 'Asked for so an unlocked laptop can’t quietly take this off your account.'}
            </span>
          </label>
          <div className="row-tight">
            <button
              type="button"
              className="tiny"
              onClick={() => {
                setConfirming(null);
                setPassword('');
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="button" className="tiny danger" onClick={confirm} disabled={busy}>
              {busy ? 'Working…' : confirming === 'codes' ? 'Make new codes' : 'Remove it'}
            </button>
          </div>
        </div>
      )}

      {!confirming && (
        <div className="row-tight">
          {passkeysSupported() && (
            <button type="button" className="tiny" onClick={add} disabled={busy}>
              {busy ? 'Waiting for your device…' : on ? 'Add another device' : 'Add a passkey'}
            </button>
          )}
          {on && (
            <button
              type="button"
              className="tiny subtle"
              onClick={() => {
                setConfirming('codes');
                setNote(null);
                setError(null);
              }}
            >
              New recovery codes
            </button>
          )}
        </div>
      )}

      {note && <div className="secondary" style={{ fontSize: '0.85rem' }}>{note}</div>}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
