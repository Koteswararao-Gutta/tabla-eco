// Manager lock: Screens, Staff and More ask for the manager PIN. Catering never does (front staff use it).
// After the PIN they stay open on this phone for 10 minutes, counted again from each touch.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { deviceValue, setDeviceValue, store, useNow, useSingleton } from '@shared/data';
import { PIN_LENGTH, press } from '../../kitchen/pin';
import { UNLOCK_MS, expectedManagerPin, unlockValue, unlockedUntil } from './pin';
import './lock.css';

/** Remembered on this phone only: a fingerprint of the PIN and when the tabs lock again. */
const UNLOCK_KEY = 'managerUnlock';
/** A touch extends the time at most this often (saves writing on every tap). */
const TOUCH_EVERY_MS = 15_000;

interface LockControls {
  /** Lock the manager tabs again right away. */
  lockNow: () => void;
  /** After changing the PIN on this phone: stay open with the new one. */
  keepOpen: (newPin: string) => void;
}
const Controls = createContext<LockControls>({ lockNow: () => {}, keepOpen: () => {} });
/** Inside a locked area: lock now, or stay open after a PIN change. */
export const useManagerLock = () => useContext(Controls);

export function ManagerLock({ area, children }: { area: string; children: ReactNode }) {
  const pin = expectedManagerPin(useSingleton('settings'));
  const [saved, setSaved] = useState(() => deviceValue(UNLOCK_KEY));
  const now = useNow(5000);
  const until = unlockedUntil(saved, pin, now);
  const open = until > 0;

  const remember = useCallback((value: string | null) => {
    setDeviceValue(UNLOCK_KEY, value);
    setSaved(value);
  }, []);

  // Another tab or a reload may have unlocked or locked meanwhile.
  useEffect(() => {
    const sync = () => setSaved(deviceValue(UNLOCK_KEY));
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  // While open, using the screen keeps it open.
  useEffect(() => {
    if (!open || pin === undefined) return;
    let last = store.now();
    const touched = () => {
      const t = store.now();
      if (t - last < TOUCH_EVERY_MS) return;
      last = t;
      remember(unlockValue(pin, t + UNLOCK_MS));
    };
    const events = ['pointerdown', 'keydown', 'wheel'];
    events.forEach((e) => window.addEventListener(e, touched, true));
    return () => events.forEach((e) => window.removeEventListener(e, touched, true));
  }, [open, pin, remember]);

  if (pin === undefined) return null;
  if (!open) return <PinPad area={area} pin={pin} onUnlock={() => remember(unlockValue(pin, store.now() + UNLOCK_MS))} />;
  const controls: LockControls = {
    lockNow: () => remember(null),
    keepOpen: (newPin) => remember(unlockValue(newPin, store.now() + UNLOCK_MS)),
  };
  return <Controls.Provider value={controls}>{children}</Controls.Provider>;
}

function PinPad({ area, pin, onUnlock }: { area: string; pin: string; onUnlock: () => void }) {
  const [entry, setEntry] = useState('');
  const [wrong, setWrong] = useState(0); // bumps to restart the shake

  const key = useCallback(
    (k: string) => {
      const next = press(entry, k);
      if (next.length < PIN_LENGTH) return setEntry(next);
      if (next === pin) return onUnlock();
      setWrong((w) => w + 1);
      setEntry('');
    },
    [pin, entry, onUnlock],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) key(e.key);
      else if (e.key === 'Backspace') key('back');
      else if (e.key === 'Escape') key('clear');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  return (
    <main className="t-page ml-page" data-testid="manager-lock">
      <h1>{area}</h1>
      <p className="ml-sub">Enter the manager PIN</p>
      <div key={wrong} className={'ml-dots' + (wrong ? ' shake' : '')} aria-label={`${entry.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <i key={i} className={i < entry.length ? 'on' : ''} />
        ))}
      </div>
      <p className="ml-msg" role="status">
        {wrong > 0 && entry.length === 0 ? "That PIN didn't work. Please try again." : ' '}
      </p>
      <div className="ml-keypad">
        {keys.map((k) => (
          <button
            key={k}
            className={'ml-key' + (k.length > 1 ? ' ml-key-fn' : '')}
            onClick={() => key(k)}
            aria-label={k === 'back' ? 'Delete last digit' : k === 'clear' ? 'Clear' : k}
          >
            {k === 'back' ? '⌫' : k === 'clear' ? 'Clear' : k}
          </button>
        ))}
      </div>
    </main>
  );
}
