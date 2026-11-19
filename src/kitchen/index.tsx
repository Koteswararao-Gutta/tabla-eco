// Kitchen tablet: PIN first, then the open catering orders, updating by themselves.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScreenSurface } from '@shared/ui';
import { deviceValue, setDeviceValue, store, useCollection, useHeartbeat, useNow, useSingleton, type CateringOrder, type WithId } from '@shared/data';
import { byDueAsc, countdown, dayLabel, groupByDayUpcomingFirst, isSoon, itemLines, timeLabel } from '../manager/catering/orders';
import { PIN_LENGTH, expectedPin, isUnlocked, pinFingerprint, press } from './pin';
import { CHIME_REPEAT_MS, ackKey, ackPatch, chime, dueReminders, onSoundChange, soundIsOn, wakeAudio, type KitchenOrder } from './reminder';
import './kitchen.css';

type Order = WithId<CateringOrder>;
const UNDO_MS = 6000;
/** "Show all orders" goes back to the open orders after this long with no touch. */
export const ALL_ORDERS_IDLE_MS = 3 * 60_000;
/** Remembered on this tablet only (not synced): a fingerprint of the PIN it was unlocked with. */
const UNLOCK_KEY = 'kitchenUnlock';

export default function Kitchen() {
  useHeartbeat('kitchen');
  const pin = expectedPin(useSingleton('settings'));
  // Stays unlocked through reloads and restarts, until someone taps Lock or the manager changes the PIN.
  const [saved, setSaved] = useState(() => deviceValue(UNLOCK_KEY));
  const unlocked = isUnlocked(saved, pin);
  const remember = (value: string | null) => {
    setDeviceValue(UNLOCK_KEY, value);
    setSaved(value);
  };

  // Browsers keep sound muted until the screen is touched: any tap wakes it for the chime.
  useEffect(() => {
    window.addEventListener('pointerdown', wakeAudio, true);
    window.addEventListener('keydown', wakeAudio, true);
    return () => {
      window.removeEventListener('pointerdown', wakeAudio, true);
      window.removeEventListener('keydown', wakeAudio, true);
    };
  }, []);

  const orders = useCollection('orders');
  const now = useNow(15_000);
  // The heads-up runs on every kitchen view, locked or not. Its chime lives here, so locking or
  // unlocking never replays it or restarts the 45 s repeat.
  const reminders = useHeadsUp(orders, now);
  const banner = <HeadsUp reminders={reminders} now={now} />;
  const soundNote = useSoundOn() ? null : (
    <span className="k-sound" role="status">
      Tap anywhere to turn on sound
    </span>
  );

  return (
    // ScreenSurface keeps the screen awake; .k-root turns it into a light page.
    <ScreenSurface testId="kitchen">
      <div className="k-root">
        {pin === undefined ? null : unlocked ? (
          <Board orders={orders} now={now} banner={banner} note={soundNote} onLock={() => remember(null)} />
        ) : (
          <div className={'k-lock' + (reminders.length ? ' has-remind' : '')}>
            {reminders.length > 0 && <div className="k-remind-over">{banner}</div>}
            <PinScreen pin={pin} note={soundNote} onUnlock={() => remember(pinFingerprint(pin))} />
          </div>
        )}
      </div>
    </ScreenSurface>
  );
}

// ---------- 1-hour heads-up ----------

/** Orders whose 1-hour heads-up is due, with a chime when a new one appears and again every 45 s
 *  until "Got it". Rings only while the kitchen is staffed (staff schedule hours); waits for those to load. */
function useHeadsUp(orders: Order[] | null, now: number): KitchenOrder[] {
  const staff = useSingleton('staffConfig');
  const reminders = staff === undefined ? [] : dueReminders(orders ?? [], now, staff);
  const remindIds = reminders.map(ackKey).join(',');
  const chimed = useRef(new Set<string>());
  useEffect(() => {
    const fresh = reminders.filter((o) => !chimed.current.has(ackKey(o)));
    fresh.forEach((o) => chimed.current.add(ackKey(o)));
    if (fresh.length) chime();
    if (!remindIds) return;
    const t = setInterval(chime, CHIME_REPEAT_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remindIds]);
  return reminders;
}

/** False while the browser keeps sound off (until someone taps the screen). */
function useSoundOn(): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const check = () => setOn(soundIsOn());
    const off = onSoundChange(check);
    check();
    return off;
  }, []);
  return on;
}

/** One banner row per due heads-up. "Got it" needs no PIN. */
function HeadsUp({ reminders, now }: { reminders: KitchenOrder[]; now: number }) {
  // "Got it" is saved on the order, so it holds after a reload and on every kitchen tablet. No PIN needed.
  const ack = (o: Order) => store.updateDoc('orders', o.id, ackPatch(o));
  if (reminders.length === 0) return null;
  return (
    <div className="k-remind" role="alert" data-testid="kitchen-reminder">
      {reminders.map((o) => (
        <div key={o.id} className="k-remind-row">
          <span className="k-remind-text">
            <b>{o.customerName}</b> {o.type === 'delivery' ? 'delivery' : 'pickup'} at {timeLabel(o.dueAt)}, {countdown(o.dueAt, now).text}
          </span>
          <button className="t-btn k-remind-btn" onClick={() => ack(o)}>
            Got it
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- PIN ----------

function PinScreen({ pin, note, onUnlock }: { pin: string; note: ReactNode; onUnlock: () => void }) {
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
    <div className="k-pin">
      <h1>Kitchen</h1>
      <p className="k-pin-sub">Enter the 4-digit PIN</p>
      <div key={wrong} className={'k-dots' + (wrong ? ' shake' : '')} aria-label={`${entry.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <i key={i} className={i < entry.length ? 'on' : ''} />
        ))}
      </div>
      <p className="k-pin-msg" role="status">
        {wrong > 0 && entry.length === 0 ? "That PIN didn't work. Please try again." : ' '}
      </p>
      <div className="k-keypad">
        {keys.map((k) => (
          <button
            key={k}
            className={'k-key' + (k.length > 1 ? ' k-key-fn' : '') + (k === 'back' ? ' k-key-back' : '')}
            onClick={() => key(k)}
            aria-label={k === 'back' ? 'Delete last digit' : k === 'clear' ? 'Clear' : k}
          >
            {k === 'back' ? '⌫' : k === 'clear' ? 'Clear' : k}
          </button>
        ))}
      </div>
      {note}
    </div>
  );
}

// ---------- orders ----------

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

function Board({ orders, now, banner, note, onLock }: { orders: Order[] | null; now: number; banner: ReactNode; note: ReactNode; onLock: () => void }) {
  const online = useOnline();
  const [showAll, setShowAll] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  // Each view opens at its top, not at the other view's scroll position.
  useEffect(() => {
    const root = board.current?.closest('.k-root');
    if (root) root.scrollTop = 0;
  }, [showAll]);
  // Left on "Show all orders"? After 3 minutes with no touch, back to the open orders.
  useEffect(() => {
    if (!showAll) return;
    let t = setTimeout(() => setShowAll(false), ALL_ORDERS_IDLE_MS);
    const touched = () => {
      clearTimeout(t);
      t = setTimeout(() => setShowAll(false), ALL_ORDERS_IDLE_MS);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'scroll'];
    events.forEach((e) => window.addEventListener(e, touched, true));
    return () => {
      clearTimeout(t);
      events.forEach((e) => window.removeEventListener(e, touched, true));
    };
  }, [showAll]);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const setStatus = (o: Order, status: CateringOrder['status']) => {
    const t = store.now();
    return store.updateDoc('orders', o.id, { status, completedAt: status === 'completed' ? t : null, updatedAt: t });
  };

  const complete = async (o: Order) => {
    await setStatus(o, 'completed');
    clearTimeout(timer.current);
    setUndo({ id: o.id, name: o.customerName });
    timer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const undoComplete = async () => {
    const o = undo && orders?.find((x) => x.id === undo.id);
    clearTimeout(timer.current);
    setUndo(null);
    if (o) await setStatus(o, 'open');
  };

  const open = (orders ?? []).filter((o) => o.status === 'open').sort(byDueAsc);

  return (
    <div className="k-board" ref={board}>
      <header className="k-bar">
        <div className="k-bar-title">
          <h1>{showAll ? 'All orders' : 'Open orders'}</h1>
          {!showAll && orders && <span className="k-count">{open.length}</span>}
          {!online && (
            <span className="t-badge bad k-offline" role="status">
              Offline: showing the last saved orders
            </span>
          )}
          {note}
        </div>
        <span className="k-clock">{timeLabel(now)}</span>
        {showAll ? (
          <button className="t-btn primary k-bar-btn" onClick={() => setShowAll(false)}>
            ← Back to open orders
          </button>
        ) : (
          <button className="t-btn k-bar-btn" onClick={() => setShowAll(true)}>
            Show all orders
          </button>
        )}
        <button className="t-btn k-bar-btn" onClick={onLock}>
          Lock
        </button>
      </header>
      {banner}

      {!orders ? null : showAll ? (
        <AllOrders orders={orders} now={now} onReopen={(o) => setStatus(o, 'open')} />
      ) : open.length === 0 ? (
        <div className="t-empty k-empty">
          No open orders right now.
          <br />
          New orders from the manager show up here by themselves.
        </div>
      ) : (
        <div className="k-grid">
          {open.map((o) => (
            <OrderCard key={o.id} order={o} now={now} onComplete={() => complete(o)} />
          ))}
        </div>
      )}

      {undo && (
        <div className="k-undo" role="status">
          <span className="k-undo-text">
            Marked completed: <b>{undo.name}</b>
          </span>
          <button className="t-btn accent" onClick={undoComplete}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

function OrderCard({ order: o, now, onComplete }: { order: Order; now: number; onComplete: () => void }) {
  const cd = countdown(o.dueAt, now);
  const day = dayLabel(o.dueAt, now);
  return (
    <article className={'k-card' + (isSoon(o, now) ? ' soon' : '')} data-testid="kitchen-order" aria-label={`Order for ${o.customerName}`}>
      <div className="k-card-top">
        <div>
          <div className="k-due">{timeLabel(o.dueAt)}</div>
          <div className="k-day">{day}</div>
        </div>
        <div className="k-card-right">
          <span className={'k-countdown' + (cd.late ? ' late' : '')}>{cd.text}</span>
          <span className={'t-badge k-type' + (o.type === 'delivery' ? ' accent' : '')}>{o.type === 'delivery' ? 'Delivery' : 'Pickup'}</span>
        </div>
      </div>

      <div className="k-who">
        <div className="k-name">{o.customerName}</div>
        <div className="k-phone">{o.phone}</div>
        {o.type === 'delivery' && o.address && <div className="k-address">{o.address}</div>}
        {!!o.people && <div className="k-people">{o.people} people</div>}
      </div>

      <ul className="k-items">
        {itemLines(o.items).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>

      {o.notes && <p className="k-notes">{o.notes}</p>}

      <button className="t-btn primary block k-done" onClick={onComplete}>
        Mark completed
      </button>
    </article>
  );
}

function AllOrders({ orders, now, onReopen }: { orders: Order[]; now: number; onReopen: (o: Order) => void }) {
  if (orders.length === 0) return <div className="t-empty k-empty">No orders yet.</div>;
  return (
    <div className="k-all">
      {groupByDayUpcomingFirst(orders, now).map((g) => (
        <section key={g.label} className="k-day-group" aria-label={g.label}>
          <h2>{g.label}</h2>
          <div className="k-rows">
            {g.orders.map((o) => (
              <div key={o.id} className={'k-row' + (o.status === 'completed' ? ' done' : '')} data-testid="kitchen-row">
                <span className="k-row-time">{timeLabel(o.dueAt)}</span>
                <span className="k-row-main">
                  <span className="k-row-head">
                    <span className="k-row-name">{o.customerName}</span>
                    <span className={'t-badge' + (o.type === 'delivery' ? ' accent' : '')}>{o.type === 'delivery' ? 'Delivery' : 'Pickup'}</span>
                  </span>
                  <span className="k-row-items">
                    {o.people ? `${o.people} people · ` : ''}
                    {itemLines(o.items).join(' · ')}
                  </span>
                </span>
                <span className="k-row-side">
                  {o.status === 'completed' ? (
                    <>
                      <span className="k-row-status good">
                        ✓ Completed{o.completedAt ? ` ${timeLabel(o.completedAt)}` : ''}
                      </span>
                      <button className="t-btn k-row-btn" onClick={() => onReopen(o)}>
                        Reopen
                      </button>
                    </>
                  ) : (
                    <span className="k-row-status">Open</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
