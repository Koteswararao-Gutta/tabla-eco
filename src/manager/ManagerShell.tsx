// Front app and manager app frame: the tabs. Owned by the foundation; each tab lives in its own folder.
// Front app (#/front, for front staff): Catering, and Screens to look at only.
// Manager app (#/manager): everything in the front app, Screens can be changed, plus Staff and More (☰).
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { OfflineBanner, TabBar } from '@shared/ui';
import Catering from './catering';
import { AppModeProvider, type AppMode } from './mode';

// Catering is the first tab, so it comes with the app; the others load when first opened.
const Screens = lazy(() => import('./screens'));
const Staff = lazy(() => import('./staff'));
const More = lazy(() => import('./more'));

export default function ManagerShell({ mode = 'manager' }: { mode?: AppMode }) {
  const base = '/' + mode;
  const front = mode === 'front';
  return (
    <AppModeProvider value={mode}>
      <Routes>
        <Route index element={<Navigate to="catering" replace />} />
        <Route path="screens/*" element={<Suspense fallback={null}><Screens /></Suspense>} />
        <Route path="catering/*" element={<Catering />} />
        {!front && <Route path="staff/*" element={<Suspense fallback={null}><Staff /></Suspense>} />}
        {!front && <Route path="more/*" element={<Suspense fallback={null}><More /></Suspense>} />}
        <Route path="*" element={<Navigate to={base + '/catering'} replace />} />
      </Routes>
      <OfflineBanner />
      <TabBar
        tabs={
          front
            ? [
                { to: base + '/catering', label: 'Catering' },
                { to: base + '/screens', label: 'Screens' },
              ]
            : [
                { to: base + '/catering', label: 'Catering' },
                { to: base + '/screens', label: 'Screens' },
                { to: base + '/staff', label: 'Staff' },
                { to: base + '/more', label: '☰', name: 'More', narrow: true },
              ]
        }
      />
    </AppModeProvider>
  );
}
