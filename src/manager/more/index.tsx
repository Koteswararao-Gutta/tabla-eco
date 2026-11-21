// Manager > More (☰): manager-only tools: Payments and Statistics. Only the manager app has this tab;
// the front app (#/front) has no ☰.
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { PageHeader } from '@shared/ui';
import Payments from './Payments';
import Statistics from './Statistics';
import './more.css';

export default function More() {
  return (
    <Routes>
      <Route index element={<MoreHome />} />
      <Route path="payments" element={<Payments />} />
      <Route path="statistics" element={<Statistics />} />
      <Route path="*" element={<Navigate to="/manager/more" replace />} />
    </Routes>
  );
}

function MoreHome() {
  return (
    <main className="t-page">
      <PageHeader title="More" sub="Manager tools. The front app doesn't have these." />
      <div className="t-stack">
        <Link className="t-card mo-link" to="payments">
          <span>
            <h2 className="mo-h2">Payments</h2>
            <span className="mo-note">Each day's catering orders, paid or unpaid.</span>
          </span>
          <span className="mo-chev" aria-hidden="true">›</span>
        </Link>
        <Link className="t-card mo-link" to="statistics" data-testid="statistics">
          <span>
            <h2 className="mo-h2">Statistics</h2>
            <span className="mo-note">This week's catering orders and total, Monday to Sunday.</span>
          </span>
          <span className="mo-chev" aria-hidden="true">›</span>
        </Link>
      </div>
    </main>
  );
}
