const webpush = require('web-push');
const db = require('../db/pool');

// Sending a notification to a phone that is not currently running the app.
//
// The keys are a VAPID pair: the public half is handed to the browser when it
// subscribes and is baked into the subscription, the private half signs every
// send. They are read from the environment and never committed — this repo is
// public, and a leaked private key lets anyone push into every device that
// ever subscribed.
//
// Not configured is a normal state, not an error. The app runs perfectly well
// without notifications, so everything here degrades to "off" rather than
// throwing at boot and taking the whole server down over an unset variable.

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
// The push services want a way to contact whoever is sending. mailto: or a URL.
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@thebayt.app';

const configured = Boolean(PUBLIC_KEY && PRIVATE_KEY);
if (configured) webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);

const isConfigured = () => configured;
const publicKey = () => PUBLIC_KEY;

// Re-subscribing the same browser is an update, not a second row: the endpoint
// is the browser's identity and the keys are rotated with it. Coming back after
// a failure clears the failure, because it plainly works again.
async function save(userId, { endpoint, keys, label }) {
  await db.run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, label)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           label = EXCLUDED.label,
           failed_at = NULL`,
    [userId, endpoint, keys.p256dh, keys.auth, label ?? null]
  );
}

const remove = (userId, endpoint) =>
  db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, endpoint]);

const list = (userId) =>
  db.all(
    `SELECT id, endpoint, label, created_at, last_sent_at, failed_at
     FROM push_subscriptions WHERE user_id = ? ORDER BY created_at`,
    [userId]
  );

// Whether this browser is already registered, so the panel can say "on" without
// the endpoint itself ever being displayed.
const has = async (userId, endpoint) =>
  Boolean(
    await db.get('SELECT 1 FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [
      userId,
      endpoint,
    ])
  );

// Sends to every device one person has registered.
//
// A push service answering 404 or 410 is telling us the endpoint is gone for
// good — the app was deleted, or the browser rotated it. Those rows are dropped
// rather than retried forever; anything else is recorded and left alone, since
// a service having a bad ten minutes is not a reason to forget a device.
async function sendTo(userId, payload) {
  if (!configured) return { sent: 0, failed: 0, skipped: 'not configured' };

  const subs = await db.all(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    [userId]
  );
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          // Urgency and TTL: a daily summary is worth holding for a few hours
          // if the phone is off, and is not worth waking a sleeping radio for.
          { TTL: payload.ttl ?? 6 * 60 * 60, urgency: payload.urgency ?? 'normal' }
        );
        await db.run('UPDATE push_subscriptions SET last_sent_at = now(), failed_at = NULL WHERE id = ?', [
          sub.id,
        ]);
        sent += 1;
      } catch (err) {
        failed += 1;
        const gone = err.statusCode === 404 || err.statusCode === 410;
        if (gone) {
          await db.run('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
        } else {
          await db.run('UPDATE push_subscriptions SET failed_at = now() WHERE id = ?', [sub.id]);
        }
      }
    })
  );

  return { sent, failed };
}

module.exports = { isConfigured, publicKey, save, remove, list, has, sendTo };
