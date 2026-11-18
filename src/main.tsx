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
