import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { seedIfEmpty } from '@shared/seed/seed';

seedIfEmpty().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

// Offline start-up: the service worker keeps a copy of the app so a reload without internet still opens it.
// Production builds only (the dev server changes files constantly). Same file as the push reminders use.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./alerts-sw.js').catch(() => {});
  });
  // A phone app can stay open in the background for days. When it comes back to the front, check for a
  // newer version and load it, unless a sheet is open (the person may be halfway through an order).
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') return void (hiddenAt = Date.now());
    if (!location.hash.startsWith('#/manager')) return; // TVs and the kitchen (PIN) are left alone
    if (!hiddenAt || Date.now() - hiddenAt < 60_000 || document.querySelector('[role="dialog"]')) return;
    try {
      const html = await (await fetch('./', { cache: 'no-cache' })).text();
      const latest = html.match(/assets\/index-[\w-]+\.js/)?.[0];
      const current = [...document.scripts].some((s) => latest && s.src.endsWith(latest));
      if (latest && !current && !document.querySelector('[role="dialog"]')) location.reload();
    } catch {
      /* offline: keep the running version */
    }
  });
}
