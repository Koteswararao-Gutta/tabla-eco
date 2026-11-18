// Manager app frame: the three tabs. Owned by the foundation; each tab lives in its own folder.
import { Navigate, Route, Routes } from 'react-router-dom';
import { OfflineBanner, TabBar } from '@shared/ui';
import Screens from './screens';
import Catering from './catering';
import Staff from './staff';

export default function ManagerShell() {
  return (
    <>
      <Routes>
        <Route index element={<Navigate to="catering" replace />} />
        <Route path="screens/*" element={<Screens />} />
        <Route path="catering/*" element={<Catering />} />
        <Route path="staff/*" element={<Staff />} />
      </Routes>
      <OfflineBanner />
      <TabBar tabs={[{ to: '/manager/catering', label: 'Catering' }, { to: '/manager/screens', label: 'Screens' }, { to: '/manager/staff', label: 'Staff' }]} />
    </>
  );
}
