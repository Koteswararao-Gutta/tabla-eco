// Tabla service worker.
// 1. Keeps the app opening when the internet is down: the page and its built files are cached.
// 2. Shows the 1-hour catering reminders sent by the server, even when the app is closed.
const CACHE = 'tabla-shell-v2';
// The two pages: the manager app, TVs and kitchen at the top folder, and the front app's own page in front/.
const PAGES = ['', 'front/'];

// On install, keep a copy of the page and the built files it names, so the very next reload works offline.
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    Promise.all(
      PAGES.map((p) => {
        const url = new URL(p, self.registration.scope).href;
        return fetch(url, { cache: 'no-cache' })
          .then(async (res) => {
            if (!res.ok || res.redirected) return;
            const cache = await caches.open(CACHE);
            await cache.put(url, res.clone());
            await keepShellAssets(cache, res);
          })
          .catch(() => {});
      }),
    ),
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
  // Each page is kept under its own folder's address (the front app's page is front/).
  const page = rel === 'front' || rel.startsWith('front/') ? 'front/' : '';
  if (req.mode === 'navigate' || rel === page || rel === page + 'index.html') {
    event.respondWith(networkFirst(event, new URL(page, scope).href));
    return;
  }
  // Built files have the version in their name, so a cached copy never goes stale.
  if (rel.startsWith('assets/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Icons and the manifest: network first, cached copy when offline.
  if (/^(icon-(\w+-)?\d+\.png|(front\/)?manifest\.webmanifest)$/.test(rel)) event.respondWith(networkFirst(event));
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
      // Every route of a page lives after the #, so keep one copy per page under its folder's address.
      event.waitUntil(cache.put(shellKey || req, copy).catch(() => {}));
      if (shellKey) event.waitUntil(keepShellAssets(cache, res.clone()));
      return res;
    }
    // A bad answer (e.g. GitHub's error page during a deploy, or a 404): use the kept copy when there is one,
    // so a TV reloading at 4 AM never shows an error page.
    const kept = await cache.match(shellKey || req, { ignoreSearch: true });
    return kept || res;
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
    // them all).
    if (!complete) return;
    for (const key of await cache.keys()) {
      const p = new URL(key.url).pathname;
      const i = p.indexOf('/assets/');
      if (i < 0) continue;
      const name = p.slice(i + 1);
      // Without the list nothing is dropped: the page names only the entry file, and other files share its
      // name pattern (e.g. the catering code, shared by the kitchen and the phones).
      if (listed && !used.has(name)) await cache.delete(key);
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

// Which phone app this is ('front' or 'manager'), as the page last said. Kept in the cache so it survives
// the worker being stopped.
const APP_KEY = new URL('tabla-app', self.registration.scope).href;
self.addEventListener('message', (event) => {
  const app = event.data && event.data.app;
  if (app !== 'front' && app !== 'manager') return;
  event.waitUntil(caches.open('tabla-app').then((c) => c.put(APP_KEY, new Response(app))).catch(() => {}));
});

// Alerts link to the manager app. On a front phone they open the front app's Catering instead: the front app
// never shows manager things (Screens, Staff, ☰).
async function linkFor(link) {
  let app = 'manager';
  try {
    const hit = await (await caches.open('tabla-app')).match(APP_KEY);
    if (hit) app = await hit.text();
  } catch {
    /* no record: the alert's own link */
  }
  return app === 'front' ? new URL('front/#/front/catering', self.registration.scope).href : link;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const given = (event.notification.data && event.notification.data.link) || './#/manager/catering';
  event.waitUntil(
    Promise.all([linkFor(given), self.clients.matchAll({ type: 'window', includeUncontrolled: true })]).then(([link, wins]) => {
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
