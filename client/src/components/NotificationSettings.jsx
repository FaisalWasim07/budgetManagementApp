import { useCallback, useEffect, useState } from 'react';
import { current, disable, enable, getDevices, sendTest, support } from '../utils/push';
import { useToast } from '../utils/toast';

// Turning notifications on, and — when they will not turn on — saying exactly
// why in terms of this device rather than in general.
//
// The diagnostics are not decoration. iOS refuses web push outside an installed
// web app, and it refuses it quietly: permission simply never resolves to
// granted, with nothing in the interface to say what went wrong. So the panel
// reads what the device reports and puts it on screen.
export default function NotificationSettings() {
  const [on, setOn] = useState(false);
  const [devices, setDevices] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [caps, setCaps] = useState(() => support());
  const { show } = useToast();

  const load = useCallback(async () => {
    setCaps(support());
    try {
      const [sub, data] = await Promise.all([current(), getDevices()]);
      setOn(Boolean(sub));
      setDevices(data.devices);
      setConfigured(data.configured);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const result = await enable();
      if (!result.ok) {
        setError(
          result.permission === 'denied'
            ? 'Your device refused. Allow notifications for Bayt in its settings, then try again.'
            : 'Nothing was granted, so nothing changed.'
        );
      } else {
        show('Notifications on', { tone: 'success', body: 'This device will be told things.' });
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      await disable();
      show('Notifications off', { tone: 'info', body: 'This device will not be told anything.' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    try {
      await sendTest();
      show('Test sent', { tone: 'success', body: 'It should arrive in a moment.' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-sm">
      <div className="spread">
        <strong style={{ fontSize: '0.9rem' }}>Notifications</strong>
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {on ? 'On for this device' : 'Off for this device'}
        </span>
      </div>

      <span className="muted" style={{ fontSize: '0.82rem' }}>
        Reminders about what is due and what a month came to. Each device answers separately, so
        turning it on here says nothing about your other ones.
      </span>

      {!configured && (
        <div className="warn-banner">
          The server has no notification keys set, so nothing can be sent yet.
        </div>
      )}

      {caps.blocker && <div className="warn-banner">{caps.blocker}</div>}

      {error && <div className="error-text">{error}</div>}

      <div className="row-tight">
        {on ? (
          <>
            <button type="button" onClick={turnOff} disabled={busy}>
              Turn off
            </button>
            {/* The only way to prove the whole chain — key, subscription, push
                service, worker, and the phone's own settings — without waiting
                days for a real one. */}
            <button type="button" className="primary" onClick={test} disabled={busy}>
              Send a test
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={turnOn}
            // Never disabled by a blocker alone: on a device that reports
            // oddly, the attempt and its error are more informative than a
            // greyed-out button.
            disabled={busy || !configured}
          >
            Turn on for this device
          </button>
        )}
      </div>

      {devices && devices.length > 0 && (
        <div className="rows">
          {devices.map((device) => (
            <div className="passkey-row" key={device.id}>
              <span className="what">
                <b>{device.label || 'A device'}</b>
                <small>
                  {device.failed_at
                    ? 'Stopped accepting notifications — turn them on again on that device.'
                    : device.last_sent_at
                      ? `Last sent ${new Date(device.last_sent_at).toLocaleDateString()}`
                      : 'Nothing sent yet'}
                </small>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* What this device actually reports. Folded away, because it only
          matters when something is not working — and then it matters a lot. */}
      <details className="tuck">
        <summary>What this device supports</summary>
        <div className="rows" style={{ fontSize: '0.82rem' }}>
          <Row label="Opened from the Home Screen" value={caps.standalone} />
          <Row label="Service workers" value={caps.serviceWorker} />
          <Row label="Push" value={caps.pushManager} />
          <Row label="Notifications" value={caps.notification} />
          <Row label="Secure connection" value={caps.secure} />
          <div className="spread">
            <span className="muted">Permission</span>
            <span>{caps.permission}</span>
          </div>
        </div>
      </details>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="spread">
      <span className="muted">{label}</span>
      <span style={{ color: value ? 'var(--pos)' : 'var(--neg)' }}>{value ? 'yes' : 'no'}</span>
    </div>
  );
}
