// Tabla service worker.
// 1. Keeps the app opening when the internet is down: the page and its built files are cached.
// 2. Shows the 1-hour catering reminders sent by the server, even when the app is closed.
const CACHE = 'tabla-shell-v2';

// On install, keep a copy of the page and the built files it names, so the very next reload works offline.
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    fetch(self.registration.scope, { cache: 'no-cache' })
      .then(async (res) => {
        if (!res.ok || res.redirected) return;
        const cache = await caches.open(CACHE);
        await cache.put(self.registration.scope, res.clone());
        await keepShellAssets(cache, res);
      })
      .catch(() => {}),
  );
});
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tabla-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

// Only our own files are cached. Firebase, Google, YouTube and everything else go straight to the network.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  const rel = url.pathname.slice(scope.pathname.length);

  // The page itself: always try the network first so a new version shows at once; fall back to the copy.
  if (req.mode === 'navigate' || rel === '' || rel === 'index.html') {
    event.respondWith(networkFirst(event, scope.href));
    return;
  }
  // Built files have the version in their name, so a cached copy never goes stale.
  if (rel.startsWith('assets/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Icons and the manifest: network first, cached copy when offline.
  if (/^(icon-\d+\.png|manifest\.webmanifest)$/.test(rel)) event.respondWith(networkFirst(event));
});

async function networkFirst(event, shellKey) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  try {
    // no-cache: skip the browser's own copy (GitHub Pages lets it keep the page for 10 minutes), so a
    // new version shows on the next open. The server still answers "not changed" cheaply when it isn't.
    const res = shellKey ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : await fetch(req);
    if (res.ok && !res.redirected) {
      const copy = res.clone();
      // Every route is the same page (routes live after the #), so keep one copy under the app's address.
      event.waitUntil(cache.put(shellKey || req, copy).catch(() => {}));
      if (shellKey) event.waitUntil(keepShellAssets(cache, res.clone()));
    }
    return res;
  } catch (err) {
    const hit = (await cache.match(shellKey || req, { ignoreSearch: true })) || (await cache.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

// After a new page arrives, fetch the built files it names and drop the old entry files, so the cache stays small.
async function keepShellAssets(cache, res) {
  try {
    const html = await res.text();
    const used = new Set(Array.from(html.matchAll(/assets\/[^"'\s)]+/g), (m) => m[0]));
    if (!used.size) return;
    const scope = self.registration.scope;
    // Each screen's code is a separate file loaded when that screen opens. Keep them all now, so a TV
    // that has opened once still starts offline (its first load may happen before this worker is running).
    let listed = false;
    try {
      const list = await fetch(new URL('asset-manifest.json', scope).href, { cache: 'no-cache' });
      if (list.ok) {
        const all = new Set();
        for (const e of Object.values(await list.json())) {
          for (const f of [e.file, ...(e.css || []), ...(e.assets || [])]) if (typeof f === 'string' && f.startsWith('assets/')) all.add(f);
        }
        // Use the list only when it belongs to this page (a deploy can land between the two downloads).
        if ([...used].every((n) => all.has(n))) {
          for (const f of all) used.add(f);
          listed = true;
        }
      }
    } catch {
      /* no list: screens' files are still kept the first time each one opens */
    }
    let complete = true;
    for (const name of used) {
      const url = new URL(name, scope).href;
      if (!(await cache.match(url))) await cache.add(url).catch(() => (complete = false));
    }
    // Only once every file of the new version is kept: drop the files of older versions (each deploy renames
    // them all). Without the list, only old entry files go, since the page names nothing else.
    if (!complete) return;
    for (const key of await cache.keys()) {
      const p = new URL(key.url).pathname;
      const i = p.indexOf('/assets/');
      if (i < 0) continue;
      const name = p.slice(i + 1);
      if (!used.has(name) && (listed || /^assets\/index-/.test(name))) await cache.delete(key);
    }
  } catch {
    /* keeping old files is harmless */
  }
}
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
