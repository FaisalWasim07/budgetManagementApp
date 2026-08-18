// The service worker exists for one reason: a phone cannot be sent a
// notification without one. It receives pushes and opens the app when you tap
// them, and it does nothing else.
//
// In particular it does NOT cache. A service worker that serves an app shell
// from cache is the standard way to end up with a phone quietly running a
// three-week-old build while every other device has the current one — and the
// debugging for that is miserable, because the server is serving the right
// thing and the phone is lying about it. Every request goes to the network,
// exactly as it did before this file existed.

// Take over straight away rather than waiting for every tab to close. There is
// only ever one of these and it has no cached state to migrate.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  // A push with no readable body still has to show something: on iOS a push
  // that arrives and shows nothing counts against the app and the system
  // eventually stops delivering them.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Bayt', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Bayt';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Same tag replaces rather than stacks, so a daily message cannot pile
      // up into a column of near-identical rows on a phone left alone.
      tag: payload.tag || 'bayt',
      renotify: Boolean(payload.renotify),
      data: { url: payload.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;

  // Focus the app if it is already open rather than opening a second copy of
  // it — on a phone that would leave two entries in the app switcher.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

// A subscription can be rotated by the browser without anyone asking. If that
// happens the old endpoint is dead and the server would keep pushing into a
// void, so the app re-registers the new one the next time it is opened — see
// the subscribe call in the notifications panel, which runs on every load.
self.addEventListener('pushsubscriptionchange', () => {
  // Nothing useful can be done from here without credentials, and the panel
  // re-subscribes on open, so this exists to be explicit that the case is
  // known rather than overlooked.
});
