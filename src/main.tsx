import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isFrontPage, store, swUrl } from '@shared/data';
import { seedIfEmpty } from '@shared/seed/seed';
import { ErrorBoundary, TimeZoneNote } from '@shared/ui';

// Test-only: `?crash` makes the app throw while drawing, to check the crash screen (local builds only).
const crashTest = import.meta.env.VITE_STORE === 'local' && new URLSearchParams(location.search).has('crash');
function Crash(): never {
  throw new Error('Test crash');
}

function draw() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        {crashTest ? <Crash /> : <App />}
        <TimeZoneNote />
      </ErrorBoundary>
    </StrictMode>,
  );
}

// Live app: draw at once. A first start without internet must never wait on the database (it would stay
// blank). Screens already cope with empty data, and sample data (only ever written into a brand-new, empty
// database) shows up by itself when it lands.
// Local preview and tests: the sample data is in this browser and ready at once, so it is written first.
if (store.mode === 'local') void seedIfEmpty().finally(draw);
else {
  draw();
  seedIfEmpty().catch((e) => console.warn('sample data check', e));
}

// Offline start-up: the service worker keeps a copy of the app so a reload without internet still opens it.
// Production builds only (the dev server changes files constantly). Same file as the push reminders use.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl())
      .then(async () => {
        // Tell the worker which phone app this is, so tapping a catering alert opens this app
        // (a front phone must never land in the manager app).
        const app = isFrontPage() || location.hash.startsWith('#/front') ? 'front' : location.hash.startsWith('#/manager') ? 'manager' : null;
        if (app) (await navigator.serviceWorker.ready).active?.postMessage({ app });
      })
      .catch(() => {});
  });
  // When a new version is out (after a merge), load it, but never in someone's way: not while a sheet,
  // the kitchen alarm or a text box is open, and not within 2 minutes of a tap.
  let touchedAt = 0;
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => (touchedAt = Date.now()), true);
  const busy = () =>
    Date.now() - touchedAt < 120_000 ||
    !!document.querySelector('[role="dialog"], [role="alertdialog"]') ||
    !!document.activeElement?.matches('input, textarea, select');
  const loadNewVersion = async () => {
    if (busy() || !navigator.onLine) return;
    try {
      const html = await (await fetch('./', { cache: 'no-cache' })).text();
      // The page's own start-up file (named after the page entry; both pages share it).
      const latest = html.match(/<script[^>]+src="[^"]*(assets\/[\w-]+\.js)"/)?.[1];
      const current = [...document.scripts].some((s) => latest && s.src.endsWith(latest));
      if (latest && !current && !busy()) location.reload();
    } catch {
      /* offline: keep the running version */
    }
  };
  // The kitchen tablet stays open all day, so it looks every 5 minutes.
  // TVs keep their nightly reload (the Android app, 4 AM) so the menu never flickers during service.
  setInterval(() => {
    if (location.hash.startsWith('#/kitchen') && document.visibilityState === 'visible') void loadNewVersion();
  }, 5 * 60_000);
  // A phone app can stay open in the background for days: look when it comes back after a minute or more.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return void (hiddenAt = Date.now());
    if (!/^#\/(manager|front)/.test(location.hash) || !hiddenAt || Date.now() - hiddenAt < 60_000) return;
    touchedAt = 0; // coming back to the app is not a tap on it
    void loadNewVersion();
  });
}
