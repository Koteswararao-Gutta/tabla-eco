// Manager > More (☰): manager-only tools behind the manager PIN: Payments, and Statistics next.
import { useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { saveSingleton, useSingleton } from '@shared/data';
import { Field, PageHeader } from '@shared/ui';
import { expectedPin } from '../../kitchen/pin';
import { useManagerLock } from '../lock';
import { expectedManagerPin } from '../lock/pin';
import Payments from './Payments';
import './more.css';

export default function More() {
  return (
    <Routes>
      <Route index element={<MoreHome />} />
      <Route path="payments" element={<Payments />} />
      <Route path="*" element={<Navigate to="/manager/more" replace />} />
    </Routes>
  );
}

function MoreHome() {
  const { lockNow } = useManagerLock();
  return (
    <main className="t-page">
      <PageHeader title="More" sub="Manager only. Front staff can't open this without the PIN." />
      <div className="t-stack">
        <Link className="t-card mo-link" to="payments">
          <span>
            <h2 className="mo-h2">Payments</h2>
            <span className="mo-note">Each day's catering orders, paid or unpaid.</span>
          </span>
          <span className="mo-chev" aria-hidden="true">›</span>
        </Link>
        <section className="t-card mo-soon" data-testid="statistics">
          <h2 className="mo-h2">Statistics</h2>
          <p className="mo-note">This week's catering orders and their total, Monday to Sunday.</p>
          <span className="t-badge">Coming soon</span>
        </section>
        <ManagerPin />
        <button className="t-btn block" onClick={lockNow}>Lock now</button>
      </div>
    </main>
  );
}

function ManagerPin() {
  const settings = useSingleton('settings');
  const { keepOpen } = useManagerLock();
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<'' | 'saving' | 'saved' | 'invalid' | 'kitchen' | 'error'>('');
  if (settings === undefined) return <p className="t-sub">Loading…</p>;
  const current = expectedManagerPin(settings);

  const save = async () => {
    if (!/^\d{4}$/.test(pin)) return setStatus('invalid');
    if (pin === expectedPin(settings)) return setStatus('kitchen');
    setStatus('saving');
    try {
      keepOpen(pin); // this phone stays open; other phones ask for the new PIN
      await saveSingleton('settings', { restaurantName: 'Tabla', kitchenPin: '1234', ...(settings ?? {}), managerPin: pin });
      setPin('');
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <section className="t-card t-stack">
      <h2 className="mo-h2">Manager PIN</h2>
      <p className="mo-note">Screens, Staff and More ask for this PIN. Catering stays open for everyone.</p>
      <p className="mo-current">Current PIN <strong data-testid="manager-pin">{current}</strong></p>
      <Field label="New PIN (4 digits)">
        <input
          className="t-input mo-pin"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={pin}
          aria-invalid={status === 'invalid' || status === 'kitchen'}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
            setStatus('');
          }}
        />
      </Field>
      {status === 'invalid' && <p className="mo-error" role="alert">The PIN must be exactly 4 digits.</p>}
      {status === 'kitchen' && <p className="mo-error" role="alert">That's the kitchen PIN. Pick a different one.</p>}
      {status === 'error' && <p className="mo-error" role="alert">Could not save. Try again.</p>}
      {status === 'saved' && <p className="mo-ok" role="status">PIN changed. Other phones will ask for the new PIN.</p>}
      <button className="t-btn primary block" onClick={save} disabled={status === 'saving'}>Change PIN</button>
    </section>
  );
}
