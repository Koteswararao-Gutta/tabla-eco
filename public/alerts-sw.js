// Shows the 1-hour catering reminders sent by the server, even when the app is closed.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = {};
  }
  const d = msg.data || msg.notification || {};
  const title = d.title || 'Tabla';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || 'A catering order is coming up.',
      tag: d.tag || 'tabla',
      renotify: true,
      requireInteraction: true,
      icon: './icon-192.png',
      data: { link: d.link || './#/manager/catering' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || './#/manager/catering';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(link).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
