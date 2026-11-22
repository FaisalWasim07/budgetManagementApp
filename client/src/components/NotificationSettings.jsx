import { useCallback, useEffect, useState } from 'react';
import SettingsSection from './SettingsSection';
import { current, disable, enable, getDevices, preview, support } from '../utils/push';
import { useToast } from '../utils/toast';
import { Bell, Eye } from './icons';
import { deviceIcon } from './PasskeySettings';

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
  // The last preview, kept on screen: a notification in the corner of a desktop
  // is easy to miss, and this is also the answer to "what would it even say".
  const [shown, setShown] = useState(null);
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

  async function showToday() {
    setBusy(true);
    setError(null);
    try {
      const result = await preview();
      setShown(result);
      show(result.sent > 0 ? 'Sent to this device' : 'Nothing reached a device', {
        tone: result.sent > 0 ? 'success' : 'warn',
        body:
          result.sent > 0
            ? 'It should arrive in a moment.'
            : 'The message is below, but no device accepted it.',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      icon={<Bell />}
      title="Notifications"
      subtitle="Reminders about what is due and what a month came to."
      loading={devices === null}
      state={on ? 'On for this device' : 'Off for this device'}
      // The switch is for this device, and says so to a screen reader. Never
      // disabled by a blocker alone: on a device that reports oddly, the
      // attempt and its error say more than a greyed-out switch.
      action={
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Notifications on this device"
          className="switch"
          disabled={busy || devices === null || (!on && !configured)}
          onClick={on ? turnOff : turnOn}
        >
          <i />
        </button>
      }
    >
      {!configured && (
        <div className="warn-banner">
          The server has no notification keys set, so nothing can be sent yet.
        </div>
      )}

      {caps.blocker && <div className="warn-banner">{caps.blocker}</div>}

      {error && <div className="error-text">{error}</div>}

      {!on && (
        <span className="muted">
          The switch is for this device. Each of your devices answers for itself.
        </span>
      )}

      {((devices && devices.length > 0) || on) && (
        <div className="device-strip">
          {devices?.map((device) => (
            <div className="device-chip" key={device.id}>
              <span className="icon-tile soft round">{deviceIcon(device.label)}</span>
              <span className="what">
                <b>{device.label || 'A device'}</b>
                <small>
                  {device.failed_at
                    ? 'Stopped accepting them. Turn on again there.'
                    : device.last_sent_at
                      ? `Last sent ${new Date(device.last_sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                      : 'Nothing sent yet'}
                </small>
              </span>
            </div>
          ))}
          {/* Proves the whole chain (key, subscription, push service, worker,
              phone settings) and shows the real words, so it answers "does it
              work" and "what will it say" in one tap. */}
          {on && (
            <button type="button" className="pill-outline device-strip-action" onClick={showToday} disabled={busy}>
              <Eye size={16} />
              Preview today’s notification
            </button>
          )}
        </div>
      )}

      {shown && (
        <div className="preview-note">
          <small className="muted">
            {shown.scheduled
              ? 'This is what today would send.'
              : 'Nothing is scheduled for today. This is what the next one will say.'}
          </small>
          {shown.messages.map((message) => (
            <div className="preview-card" key={message.title}>
              <b>{message.title}</b>
              <small>{message.body}</small>
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
    </SettingsSection>
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
