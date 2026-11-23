// Manager > More (☰): manager-only tools: Analytics, Export, Catering prices and Devices. Only the manager app has this tab;
// the front app (#/front) has no ☰.
import { Link, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@shared/ui';
import Analytics from './Analytics';
import Prices from './Prices';
import Export from './Export';
import Devices from './Devices';
import './more.css';

export default function More() {
  return (
    <Routes>
      <Route index element={<MoreHome />} />
      <Route path="analytics" element={<Analytics />} />
      {/* Old links (Payments for a day, Statistics for a week) open the same dates in Analytics. */}
      <Route path="payments" element={<OldLink kind="day" />} />
      <Route path="statistics" element={<OldLink kind="week" />} />
      <Route path="prices" element={<Prices />} />
      <Route path="export" element={<Export />} />
      <Route path="devices" element={<Devices />} />
      <Route path="*" element={<Navigate to="/manager/more" replace />} />
    </Routes>
  );
}

function MoreHome() {
  return (
    <main className="t-page">
      <PageHeader title="More" sub="Manager tools. The front app doesn't have these." />
      <div className="t-stack">
        <Link className="t-card mo-link" to="analytics" data-testid="analytics">
          <span>
            <h2 className="mo-h2">Analytics</h2>
            <span className="mo-note">Catering sales, money collected and owed, how customers paid, who took it, top dishes. Any week, month, year or dates.</span>
          </span>
          <span className="mo-chev" aria-hidden="true">›</span>
        </Link>
        <Link className="t-card mo-link" to="export" data-testid="export">
          <span>
            <h2 className="mo-h2">Export</h2>
            <span className="mo-note">Download catering orders for a month, a year or any dates, as a spreadsheet file.</span>
          </span>
          <span className="mo-chev" aria-hidden="true">›</span>
        </Link>
        <Link className="t-card mo-link" to="prices" data-testid="prices">
          <span>
            <h2 className="mo-h2">Catering prices</h2>
            <span className="mo-note">Tray prices used for catering estimates.</span>
          </span>
          <span className="mo-chev" aria-hidden="true">›</span>
        </Link>
        <Link className="t-card mo-link" to="devices" data-testid="devices">
          <span>
            <h2 className="mo-h2">Devices</h2>
            <span className="mo-note">Which phones, tablets and TVs can open the app. The restaurant code and the lock.</span>
          </span>
          <span className="mo-chev" aria-hidden="true">›</span>
        </Link>
      </div>
    </main>
  );
}

function OldLink({ kind }: { kind: 'day' | 'week' }) {
  const [params] = useSearchParams();
  const d = params.get(kind) ?? '';
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(d);
  const to = kind === 'day' ? (ok ? `?r=dates&from=${d}&to=${d}` : '?r=dates') : '?r=week' + (ok ? '&d=' + d : '');
  return <Navigate to={'/manager/more/analytics' + to} replace />;
}
