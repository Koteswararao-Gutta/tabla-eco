// Kitchen tablet: change its 4-digit PIN, or open it.
import { useState } from 'react';
import { saveSingleton, updateSingleton, useSingleton } from '@shared/data';
import { Field } from '@shared/ui';
import { isPin } from './logic';
import { ScreenPage } from './parts';

export default function KitchenPage() {
  const settings = useSingleton('settings');
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<'' | 'saving' | 'saved' | 'invalid' | 'error'>('');
  const current = settings?.kitchenPin ?? '1234';

  const save = async () => {
    if (!isPin(pin)) return setStatus('invalid');
    setStatus('saving');
    try {
      // Only the PIN changes; the rest of settings is left as stored.
      if (settings) await updateSingleton('settings', { kitchenPin: pin });
      else await saveSingleton('settings', { restaurantName: 'Tabla', kitchenPin: pin });
      setPin('');
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <ScreenPage id="kitchen" sub="The tablet in the kitchen shows catering orders.">
      {settings === undefined ? (
        <p className="t-sub">Loading…</p>
      ) : (
        <div className="t-stack">
          <section className="t-card t-stack">
            <h2 className="sc-h2">Kitchen PIN</h2>
            <p className="sc-note">The kitchen tablet asks for this PIN.</p>
            <p className="sc-current">Current PIN <strong data-testid="current-pin">{current}</strong></p>
            <Field label="New PIN (4 digits)">
              <input
                className="t-input sc-pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                aria-invalid={status === 'invalid'}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                  setStatus('');
                }}
              />
            </Field>
            {status === 'invalid' && <p className="sc-error" role="alert">The PIN must be exactly 4 digits.</p>}
            {status === 'error' && <p className="sc-error" role="alert">Could not save. Try again.</p>}
            {status === 'saved' && <p className="sc-ok" role="status">PIN changed.</p>}
            <button className="t-btn primary block" onClick={save} disabled={status === 'saving'}>Change PIN</button>
          </section>
          <a className="t-btn block" href="#/kitchen" target="_blank" rel="noreferrer">Open the kitchen screen</a>
        </div>
      )}
    </ScreenPage>
  );
}
