// Manager app frame: the three tabs. Owned by the foundation; each tab lives in its own folder.
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { OfflineBanner, TabBar } from '@shared/ui';
import Catering from './catering';

// Catering is the first tab, so it comes with the app; Screens and Staff load when first opened.
const Screens = lazy(() => import('./screens'));
const Staff = lazy(() => import('./staff'));

export default function ManagerShell() {
  return (
    <>
      <Routes>
        <Route index element={<Navigate to="catering" replace />} />
        <Route path="screens/*" element={<Suspense fallback={null}><Screens /></Suspense>} />
        <Route path="catering/*" element={<Catering />} />
        <Route path="staff/*" element={<Suspense fallback={null}><Staff /></Suspense>} />
      </Routes>
      <OfflineBanner />
      <TabBar tabs={[{ to: '/manager/catering', label: 'Catering' }, { to: '/manager/screens', label: 'Screens' }, { to: '/manager/staff', label: 'Staff' }]} />
    </>
  );
}
