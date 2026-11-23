// Approved devices: once the manager locks the app (More > Devices), a phone, tablet or TV that isn't approved
// sees this screen instead of the app, and enters the restaurant code once. While it's not known yet (starting,
// or offline), the app shows as usual: an approved device must never be stopped by a slow connection.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { store, useDeviceAccess } from '@shared/data';
import logoUrl from './brand/tabla-logo.webp';
import './access.css';

const MAX = 10;
const MIN = 6;

export function AccessGate({ children }: { children: ReactNode }) {
  const access = useDeviceAccess();
  return access === 'needs-code' ? <CodeScreen /> : <>{children}</>;
}

function CodeScreen() {
  const [entry, setEntry] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'checking' | 'done'>('idle');
  const first = useRef<HTMLButtonElement>(null);

  // A TV remote moves between buttons: start on "1" (not on touch screens, where it would only show a ring).
  useEffect(() => {
    if (!matchMedia('(pointer: coarse)').matches) first.current?.focus();
  }, []);

  const send = useCallback(async () => {
    if (entry.length < MIN || state !== 'idle') return;
    setState('checking');
    setMsg(null);
    try {
      await store.enterDeviceCode(entry);
      setState('done');
      // Start the app fresh, so every list loads now that the device is approved.
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      setEntry('');
      setMsg((e as Error).message);
      setState('idle');
    }
  }, [entry, state]);

  const press = useCallback(
    (k: string) => {
      if (state !== 'idle') return;
      setMsg(null);
      if (k === 'back') setEntry((v) => v.slice(0, -1));
      else if (k === 'clear') setEntry('');
      else setEntry((v) => (v.length < MAX ? v + k : v));
    },
    [state],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Escape') press('clear');
      else if (e.key === 'Enter' && !(e.target as HTMLElement)?.matches?.('button')) void send();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, send]);

  if (state === 'done') {
    return (
      <main className="t-access" data-testid="access-done">
        <img className="t-logo t-access-logo" src={logoUrl} alt="Tabla Indian Restaurant" draggable={false} />
        <h1>This device is approved</h1>
        <p className="t-access-sub">Opening the app…</p>
      </main>
    );
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  return (
    <main className="t-access" data-testid="access-code">
      <img className="t-logo t-access-logo" src={logoUrl} alt="Tabla Indian Restaurant" draggable={false} />
      <h1>Enter the restaurant code</h1>
      <p className="t-access-sub">Only needed once on this phone, tablet or TV. Ask the manager for the code.</p>
      <div className="t-access-dots" aria-label={`${entry.length} digits entered`}>
        {Array.from({ length: Math.max(MIN, entry.length) }, (_, i) => (
          <i key={i} className={i < entry.length ? 'on' : ''} />
        ))}
      </div>
      <p className="t-access-msg" role="status">
        {state === 'checking' ? 'Checking…' : msg ?? ' '}
      </p>
      <div className="t-access-pad">
        {keys.map((k, i) => (
          <button
            key={k}
            ref={i === 0 ? first : undefined}
            className={'t-access-key' + (k.length > 1 ? ' fn' : '')}
            onClick={() => press(k)}
            disabled={state !== 'idle'}
            aria-label={k === 'back' ? 'Delete last digit' : k === 'clear' ? 'Clear' : k}
          >
            {k === 'back' ? '⌫' : k === 'clear' ? 'Clear' : k}
          </button>
        ))}
      </div>
      <button className="t-btn accent t-access-ok" onClick={() => void send()} disabled={entry.length < MIN || state !== 'idle'} data-testid="access-ok">
        OK
      </button>
    </main>
  );
}
