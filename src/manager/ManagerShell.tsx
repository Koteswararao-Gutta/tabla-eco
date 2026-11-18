// Manager app frame: the three tabs. Owned by the foundation; each tab lives in its own folder.
import { Navigate, Route, Routes } from 'react-router-dom';
import { TabBar } from '@shared/ui';
import Screens from './screens';
import Catering from './catering';
import Staff from './staff';

export default function ManagerShell() {
  return (
    <>
      <Routes>
        <Route index element={<Navigate to="screens" replace />} />
        <Route path="screens/*" element={<Screens />} />
        <Route path="catering/*" element={<Catering />} />
        <Route path="staff/*" element={<Staff />} />
      </Routes>
      <TabBar tabs={[{ to: '/manager/screens', label: 'Screens' }, { to: '/manager/catering', label: 'Catering' }, { to: '/manager/staff', label: 'Staff' }]} />
    </>
  );
}
