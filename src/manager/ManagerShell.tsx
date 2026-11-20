// Manager app frame: the tabs. Owned by the foundation; each tab lives in its own folder.
// Catering is open to everyone (front staff take orders and payments). Screens, Staff and More
// (the ☰ button) ask for the manager PIN first.
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { OfflineBanner, TabBar } from '@shared/ui';
import Catering from './catering';
import { ManagerLock } from './lock';

// Catering is the first tab, so it comes with the app; the others load when first opened.
const Screens = lazy(() => import('./screens'));
const Staff = lazy(() => import('./staff'));
const More = lazy(() => import('./more'));

export default function ManagerShell() {
  return (
    <>
      <Routes>
        <Route index element={<Navigate to="catering" replace />} />
        <Route path="screens/*" element={<ManagerLock area="Screens"><Suspense fallback={null}><Screens /></Suspense></ManagerLock>} />
        <Route path="catering/*" element={<Catering />} />
        <Route path="staff/*" element={<ManagerLock area="Staff"><Suspense fallback={null}><Staff /></Suspense></ManagerLock>} />
        <Route path="more/*" element={<ManagerLock area="More"><Suspense fallback={null}><More /></Suspense></ManagerLock>} />
      </Routes>
      <OfflineBanner />
      <TabBar
        tabs={[
          { to: '/manager/catering', label: 'Catering' },
          { to: '/manager/screens', label: 'Screens' },
          { to: '/manager/staff', label: 'Staff' },
          { to: '/manager/more', label: '☰', name: 'More', narrow: true },
        ]}
      />
    </>
  );
}
