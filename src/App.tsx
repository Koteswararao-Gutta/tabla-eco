// Routes. Owned by the foundation. Each area's screen lives in its own folder.
import { HashRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { PageHeader } from '@shared/ui';
import type { ScreenId } from '@shared/data';
import MenuTv from './tv-menu';
import MusicTv from './tv-music';
import Kitchen from './kitchen';
import ManagerShell from './manager/ManagerShell';

function TvRoute() {
  const { n } = useParams();
  if (n === '5') return <MusicTv />;
  if (n === '1' || n === '2' || n === '3' || n === '4') return <MenuTv screenId={('tv' + n) as ScreenId} />;
  return <Navigate to="/" replace />;
}

function Home() {
  const links = [
    ['/tv/1', 'TV 1 (front, left)'],
    ['/tv/2', 'TV 2 (front, right)'],
    ['/tv/3', 'TV 3 (mirrors TV 1)'],
    ['/tv/4', 'TV 4 (mirrors TV 2)'],
    ['/tv/5', 'TV 5 (music)'],
    ['/kitchen', 'Kitchen tablet'],
    ['/manager', 'Manager app'],
  ];
  return (
    <main className="t-page">
      <PageHeader title="Tabla" sub="Open each screen in its own Chrome window. Changes in the manager app show on the others within seconds." />
      <div className="t-stack">
        {links.map(([to, label]) => (
          <a key={to} className="t-btn block" href={'#' + to} target="_blank" rel="noreferrer">
            {label}
          </a>
        ))}
        <Link className="t-btn ghost" to="/manager">Open the manager app here</Link>
      </div>
    </main>
  );
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tv/:n" element={<TvRoute />} />
        <Route path="/kitchen" element={<Kitchen />} />
        <Route path="/manager/*" element={<ManagerShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
