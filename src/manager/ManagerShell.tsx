// Front app and manager app frame: the tabs. Owned by the foundation; each tab lives in its own folder.
// Front app (#/front, for front staff): Catering only, with no tab bar.
// Manager app (#/manager): everything in the front app, plus Screens, Staff and More (☰).
import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { OfflineBanner, TabBar } from '@shared/ui';
import Catering from './catering';
import { AppModeProvider, type AppMode } from './mode';
import { LazyScreen } from '../LazyScreen';

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
        {!front && <Route path="screens/*" element={<LazyScreen fallback={null}><Screens /></LazyScreen>} />}
        <Route path="catering/*" element={<Catering />} />
        {!front && <Route path="staff/*" element={<LazyScreen fallback={null}><Staff /></LazyScreen>} />}
        {!front && <Route path="more/*" element={<LazyScreen fallback={null}><More /></LazyScreen>} />}
        <Route path="*" element={<Navigate to={base + '/catering'} replace />} />
      </Routes>
      <OfflineBanner />
      {/* The front app is Catering only, so it has no tab bar. */}
      {!front && (
        <TabBar
          tabs={[
            { to: base + '/catering', label: 'Catering' },
            { to: base + '/screens', label: 'Screens' },
            { to: base + '/staff', label: 'Staff' },
            { to: base + '/more', label: '☰', name: 'More', narrow: true },
          ]}
        />
      )}
    </AppModeProvider>
  );
}
