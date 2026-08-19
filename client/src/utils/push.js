import { get, post } from '../api/client';

// Turning notifications on, and working out whether this device can have them.
//
// The awkward one is iOS. Safari will happily tell you Notification exists and
// then refuse permission, because on iPhone web push is only delivered to a web
// app that has been added to the Home Screen — never to a tab. So the panel
// reports what the device actually says rather than guessing from the browser
// name, and support() is what it reads.

export const getKey = () => get('/push/key');
export const getDevices = () => get('/push/devices');
// Sends what today would really send, and hands back the words so the panel
// can show them too.
export const preview = () => post('/push/preview', {});

// Standalone means "launched from the Home Screen rather than in a tab".
// Chrome and the standards use a media query; iOS Safari has its own flag and
// has had it far longer.
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const isApple = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPads report as desktop Safari but have a touchscreen, which desktop Macs
  // do not.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Everything the panel needs to explain itself, read from this device rather
// than assumed. Deliberately returns the raw answers as well as a verdict, so a
// device that behaves unexpectedly can be diagnosed from what it reported.
export function support() {
  const serviceWorker = 'serviceWorker' in navigator;
  const pushManager = 'PushManager' in window;
  const notification = 'Notification' in window;
  const standalone = isStandalone();
  const apple = isApple();
  const permission = notification ? Notification.permission : 'unsupported';

  // Secure context, because service workers refuse to register without one.
  const secure = window.isSecureContext;

  let blocker = null;
  if (!secure) blocker = 'This page is not on a secure connection.';
  else if (!serviceWorker || !pushManager || !notification) {
    blocker = apple && !standalone
      ? 'On an iPhone, notifications only work once Bayt is on your Home Screen. Open it in Safari, tap Share, then Add to Home Screen.'
      : 'This browser cannot do notifications.';
  } else if (apple && !standalone) {
    blocker =
      'Open Bayt from your Home Screen rather than a Safari tab — iPhones only deliver notifications to an installed web app.';
  } else if (permission === 'denied') {
    blocker =
      'Notifications are blocked for this app in your device settings. Allow them there and come back.';
  }

  return { serviceWorker, pushManager, notification, standalone, apple, permission, secure, blocker };
}

// base64url, which is how the VAPID public key travels, to the bytes
// pushManager.subscribe wants.
function toBytes(base64url) {
  const padded = (base64url + '==='.slice((base64url.length + 3) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const registerWorker = () =>
  navigator.serviceWorker.register('/sw.js', { scope: '/' });

// Whatever this browser currently has, or null. Read rather than created, so
// the panel can show the real state without asking for permission as a side
// effect of rendering.
export async function current() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

// A name for this device in the list, guessed from the user agent. Only ever
// shown to the person it belongs to, and only so they can tell one row from
// another — nothing is matched on it.
function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) return 'Android phone';
  if (/mac/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows PC';
  return 'This device';
}

// The whole chain: permission, worker, subscription, and telling the server.
//
// requestPermission must be reached from a real tap — browsers refuse it
// otherwise, and iOS refuses it silently — so this is only ever called from a
// click handler, never from an effect.
export async function enable() {
  const { key, configured } = await getKey();
  if (!configured || !key) {
    throw new Error('Notifications are not set up on the server yet.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, permission };

  const reg = await registerWorker();
  // A worker that is registered but not yet active cannot be subscribed to.
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      // Required to be true by every browser that implements it: a push must
      // result in something visible. The service worker always shows one.
      userVisibleOnly: true,
      applicationServerKey: toBytes(key),
    }));

  const json = sub.toJSON();
  await post('/push/subscribe', {
    endpoint: json.endpoint,
    keys: json.keys,
    label: deviceLabel(),
  });
  return { ok: true, permission };
}

export async function disable() {
  const sub = await current();
  if (!sub) return;
  const { endpoint } = sub.toJSON();
  // Told first, so a browser that refuses to unsubscribe locally still stops
  // being sent to.
  await post('/push/unsubscribe', { endpoint });
  await sub.unsubscribe().catch(() => {});
}

// Called on every load for a browser that already has one: a subscription can
// be rotated by the browser without asking, and the server would go on pushing
// into an endpoint nobody is listening to.
export async function refresh() {
  try {
    if (Notification?.permission !== 'granted') return;
    const sub = await current();
    if (!sub) return;
    const json = sub.toJSON();
    await post('/push/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
      label: deviceLabel(),
    });
  } catch {
    // Never worth interrupting the app over. The panel is where this is
    // diagnosed, and it reads the live state rather than trusting this.
  }
}
