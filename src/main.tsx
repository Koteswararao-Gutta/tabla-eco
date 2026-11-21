import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { seedIfEmpty } from '@shared/seed/seed';
import { ErrorBoundary, TimeZoneNote } from '@shared/ui';

// Test-only: `?crash` makes the app throw while drawing, to check the crash screen (local builds only).
const crashTest = import.meta.env.VITE_STORE === 'local' && new URLSearchParams(location.search).has('crash');
function Crash(): never {
  throw new Error('Test crash');
}

seedIfEmpty().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        {crashTest ? <Crash /> : <App />}
        <TimeZoneNote />
      </ErrorBoundary>
    </StrictMode>,
  );
});

// Offline start-up: the service worker keeps a copy of the app so a reload without internet still opens it.
// Production builds only (the dev server changes files constantly). Same file as the push reminders use.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./alerts-sw.js').catch(() => {});
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
      const latest = html.match(/assets\/index-[\w-]+\.js/)?.[0];
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
    if (!location.hash.startsWith('#/manager') || !hiddenAt || Date.now() - hiddenAt < 60_000) return;
    touchedAt = 0; // coming back to the app is not a tap on it
    void loadNewVersion();
  });
}
