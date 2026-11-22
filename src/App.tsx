// Routes. Owned by the foundation. Each area's screen lives in its own folder.
import { lazy } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { PageHeader, SaveFailedBanner } from '@shared/ui';
import type { ScreenId } from '@shared/data';
import { LazyScreen } from './LazyScreen';

// Each screen's code loads only when that screen opens, so a TV never downloads the manager app and the
// phone never downloads the TV code. The service worker keeps every part for offline start-up.
const MenuTv = lazy(() => import('./tv-menu'));
const MusicTv = lazy(() => import('./tv-music'));
const Kitchen = lazy(() => import('./kitchen'));
const ManagerShell = lazy(() => import('./manager/ManagerShell'));

function TvRoute() {
  const { n } = useParams();
  let screen;
  if (n === '5') screen = <MusicTv />;
  else if (n === '1' || n === '2' || n === '3' || n === '4') screen = <MenuTv screenId={('tv' + n) as ScreenId} />;
  else return <Navigate to="/" replace />;
  // While the TV's code arrives: a plain black screen, never a white flash.
  return <LazyScreen fallback={<div className="t-screen" />}>{screen}</LazyScreen>;
}

function Home() {
  const links = [
    ['/tv/1', 'TV 1 (front, left)'],
    ['/tv/2', 'TV 2 (front, right)'],
    ['/tv/3', 'TV 3 (mirrors TV 1)'],
    ['/tv/4', 'TV 4 (mirrors TV 2)'],
    ['/tv/5', 'TV 5 (music)'],
    ['/kitchen', 'Kitchen tablet'],
    ['/front', 'Front app (front staff)'],
    ['/manager', 'Manager app'],
  ];
  return (
    <main className="t-page">
      <PageHeader logo title="Tabla" sub="Open each screen in its own Chrome window. Changes in the manager app show on the others within seconds." />
      <div className="t-stack">
        {links.map(([to, label]) => (
          <a key={to} className="t-btn block" href={'#' + to} target="_blank" rel="noreferrer">
            {label}
          </a>
        ))}
      </div>
    </main>
  );
}

/** The red "Not saved" banner, once for the whole app. TVs never show it. */
function SaveFailed() {
  return <SaveFailedBanner hidden={useLocation().pathname.startsWith('/tv/')} />;
}

export function App() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tv/:n" element={<TvRoute />} />
        <Route path="/kitchen" element={<LazyScreen fallback={<div />}><Kitchen /></LazyScreen>} />
        <Route path="/front/*" element={<LazyScreen fallback={<div />}><ManagerShell mode="front" /></LazyScreen>} />
        <Route path="/manager/*" element={<LazyScreen fallback={<div />}><ManagerShell mode="manager" /></LazyScreen>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SaveFailed />
    </HashRouter>
  );
}
