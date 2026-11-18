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
}
