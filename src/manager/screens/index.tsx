// Manager app, Screens tab: tiles for every screen, then one page per screen.
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { isOnline, useCollection, useNow, type ScreenId } from '@shared/data';
import { PageHeader, Tile } from '@shared/ui';
import { SCREEN_IDS, screenName, tileLine } from './logic';
import MenuTvPage from './MenuTvPage';
import MusicPage from './MusicPage';
import KitchenPage from './KitchenPage';
import './screens.css';

export default function Screens() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path=":id" element={<ScreenRoute />} />
      <Route path="*" element={<Navigate to="/manager/screens" replace />} />
    </Routes>
  );
}

function Home() {
  const screens = useCollection('screens');
  const now = useNow(5000);
  const nav = useNavigate();
  return (
    <main className="t-page sc-page">
      <PageHeader title="Screens" sub="Tap a screen to change what it shows." />
      <div className="t-grid2 sc-tiles">
        {SCREEN_IDS.map((id) => {
          const s = screens?.find((x) => x.id === id);
          return (
            <Tile
              key={id}
              testId={'tile-' + id}
              name={screenName(id)}
              sub={tileLine({ id, mirrorOf: s?.mirrorOf })}
              online={isOnline(s?.lastSeen, now)}
              onClick={() => nav('/manager/screens/' + id)}
            />
          );
        })}
      </div>
    </main>
  );
}

function ScreenRoute() {
  const id = useParams().id as ScreenId;
  if (!SCREEN_IDS.includes(id)) return <Navigate to="/manager/screens" replace />;
  if (id === 'tv5') return <MusicPage />;
  if (id === 'kitchen') return <KitchenPage />;
  return <MenuTvPage tv={id} />;
}
