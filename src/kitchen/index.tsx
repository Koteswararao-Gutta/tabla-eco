// Kitchen tablet: PIN first, then the open catering orders, updating by themselves.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Logo, ScreenSurface, Segmented, Sheet } from '@shared/ui';
import { deviceValue, setDeviceValue, store, useCollection, useHeartbeat, useNow, useSingleton, type CateringOrder, type WithId } from '@shared/data';
import { byDueAsc, countdown, dayLabel, EDITED_BY_LABEL, groupByDayUpcomingFirst, isSoon, itemLines, lastEdit, timeLabel } from '../manager/catering/orders';
import { EditHistory, EditOrderSheet, ItemList } from '../manager/catering';
import { orderLines } from '../manager/catering/lines';
import { TagsSheet } from '../manager/catering/TagsSheet';
import { PIN_LENGTH, expectedPin, isUnlocked, pinFingerprint, press } from './pin';
import { useToastBridge } from './toastBridge';
import { useBrowserFullscreen } from './fullscreen';
import { KitchenNotice } from './notice';
import { ackPatch, dueReminders, onSoundChange, soundIsOn, staffedAt, wakeAudio, type KitchenOrder } from './reminder';
import { Alarm } from './Alarm';
import { PrepView } from './Prep';
import { CalendarView, DayGroups } from './views';
import './kitchen.css';

type Order = WithId<CateringOrder>;
const UNDO_MS = 6000;
/** Two taps on an order card this close together complete it; one tap opens its options. */
export const DOUBLE_TAP_MS = 350;
/** "Show all orders" goes back to the open orders after this long with no touch. */
export const ALL_ORDERS_IDLE_MS = 3 * 60_000;
/** Remembered on this tablet only (not synced): a fingerprint of the PIN it was unlocked with. */
const UNLOCK_KEY = 'kitchenUnlock';

export default function Kitchen() {
  useHeartbeat('kitchen');
  const toastError = useToastBridge();
  useBrowserFullscreen();
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
  // The heads-up runs on every kitchen view, locked or not. Its alarm lives here, so locking or
  // unlocking never restarts it. It rings only while the kitchen is staffed (staff schedule hours).
  const staff = useSingleton('staffConfig');
  const reminders = staff === undefined ? [] : dueReminders(orders ?? [], now, staff);
  const alarmOn = reminders.length > 0 && staffedAt(now, staff);
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
        <KitchenNotice ordersLoaded={orders !== null} toastError={toastError} />
        <Alarm reminders={reminders} now={now} on={alarmOn} />
      </div>
    </ScreenSurface>
  );
}

// ---------- 1-hour heads-up ----------

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

/** One banner row per due heads-up (under the alarm, and on its own after hours). "Got it" needs no PIN. */
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

function Board({ orders, now, banner, note, onLock }: { orders: Order[] | null; now: number; banner: ReactNode; note: ReactNode; onLock: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<'list' | 'calendar' | 'prep'>('list');
  const away = showAll || view !== 'list';
  const backToList = () => {
    setShowAll(false);
    setView('list');
  };
  const board = useRef<HTMLDivElement>(null);
  // The top bar's height, for views that keep something stuck just under it (Prep's day picker).
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => board.current?.style.setProperty('--k-bar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Each view opens at its top, not at the other view's scroll position.
  useEffect(() => {
    const root = board.current?.closest('.k-root');
    if (root) root.scrollTop = 0;
  }, [showAll, view]);
  // Left on "Show all orders" or the calendar? After 3 minutes with no touch, back to the open orders list.
  useEffect(() => {
    if (!away) return;
    let t = setTimeout(backToList, ALL_ORDERS_IDLE_MS);
    const touched = () => {
      clearTimeout(t);
      t = setTimeout(backToList, ALL_ORDERS_IDLE_MS);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'scroll'];
    events.forEach((e) => window.addEventListener(e, touched, true));
    return () => {
      clearTimeout(t);
      events.forEach((e) => window.removeEventListener(e, touched, true));
    };
  }, [away]);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const setStatus = (o: Order, status: CateringOrder['status']) => {
    const t = store.now();
    return store.updateDoc('orders', o.id, { status, completedAt: status === 'completed' ? t : null, updatedAt: t });
  };

  const showUndo = (o: Order) => {
    clearTimeout(timer.current);
    setUndo({ id: o.id, name: o.customerName });
    timer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };
  const complete = async (o: Order) => {
    await setStatus(o, 'completed');
    showUndo(o);
  };

  // "Edit" on a card: the order is read from the live list, so a change made elsewhere shows at once;
  // if it is deleted elsewhere, the sheet closes.
  const [editing, setEditing] = useState<string | null>(null);
  const editOrder = editing ? orders?.find((o) => o.id === editing) ?? null : null;
  const [tagsFor, setTagsFor] = useState<Order | null>(null);
  // One tap on a card: its options (complete, edit, print tags). Read live, so it closes if the order goes.
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  const optionsOrder = optionsFor ? orders?.find((o) => o.id === optionsFor && o.status === 'open') ?? null : null;

  const undoComplete = async () => {
    const o = undo && orders?.find((x) => x.id === undo.id);
    clearTimeout(timer.current);
    setUndo(null);
    if (o) await setStatus(o, 'open');
  };

  const open = (orders ?? []).filter((o) => o.status === 'open').sort(byDueAsc);

  return (
    <div className="k-board" ref={board}>
      <header className="k-bar" ref={bar}>
        <div className="k-bar-title">
          <Logo className="k-logo" />
          <h1>{showAll ? 'All orders' : view === 'calendar' ? 'Calendar' : view === 'prep' ? 'Prep' : 'Open orders'}</h1>
          {!showAll && view === 'list' && orders && <span className="k-count">{open.length}</span>}
          {note}
        </div>
        <span className="k-clock">{timeLabel(now)}</span>
        {!showAll && (
          <Segmented
            label="View"
            value={view}
            options={[
              { value: 'list', label: 'List' },
              { value: 'calendar', label: 'Calendar' },
              { value: 'prep', label: 'Prep' },
            ]}
            onChange={setView}
          />
        )}
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
      ) : view === 'prep' ? (
        <PrepView orders={orders} now={now} />
      ) : view === 'calendar' ? (
        <CalendarView orders={orders} now={now} onOpen={(o) => setOptionsFor(o.id)} />
      ) : open.length === 0 ? (
        <div className="t-empty k-empty">
          No open orders right now.
          <br />
          New orders from the manager show up here by themselves.
        </div>
      ) : (
        <DayGroups orders={open} now={now} card={(o) => <OrderCard key={o.id} order={o} now={now} onTap={() => setOptionsFor(o.id)} onDoubleTap={() => complete(o)} />} />
      )}

      {optionsOrder && (
        <OrderOptions
          order={optionsOrder}
          now={now}
          onClose={() => setOptionsFor(null)}
          onComplete={() => {
            setOptionsFor(null);
            complete(optionsOrder);
          }}
          onEdit={() => {
            setOptionsFor(null);
            setEditing(optionsOrder.id);
          }}
          onTags={() => {
            setOptionsFor(null);
            setTagsFor(optionsOrder);
          }}
        />
      )}
      {tagsFor && <TagsSheet order={tagsFor} now={now} onClose={() => setTagsFor(null)} />}
      {editOrder && <EditOrderSheet key={editOrder.id} order={editOrder} now={now} by="kitchen" onClose={() => setEditing(null)} onCompleted={showUndo} />}

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

/** One tap opens the order's options; a double tap marks it completed (Undo shows after). */
function useTaps(onTap: () => void, onDoubleTap: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const taps = useRef({ onTap, onDoubleTap });
  taps.current = { onTap, onDoubleTap };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return; // "Changed by…" has its own tap
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
      taps.current.onDoubleTap();
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      taps.current.onTap();
    }, DOUBLE_TAP_MS);
  };
}

function OrderCard({ order: o, now, onTap, onDoubleTap }: { order: Order; now: number; onTap: () => void; onDoubleTap: () => void }) {
  const cd = countdown(o.dueAt, now);
  const day = dayLabel(o.dueAt, now);
  const last = lastEdit(o);
  const [showChanges, setShowChanges] = useState(false);
  const tap = useTaps(onTap, onDoubleTap);
  return (
    <article
      className={'k-card k-tappable' + (isSoon(o, now) ? ' soon' : '')}
      data-testid="kitchen-order"
      aria-label={`Order for ${o.customerName}`}
      tabIndex={0}
      onClick={tap}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onTap();
        }
      }}
    >
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

      <ItemList lines={orderLines(o)} className="k-items" />

      {o.notes && <p className="k-notes">{o.notes}</p>}

      {last && (
        <button className="k-changed" aria-expanded={showChanges} onClick={() => setShowChanges(!showChanges)}>
          ✎ Changed by {EDITED_BY_LABEL[last.by] ?? 'someone'}, {dayLabel(last.at, now) === 'Today' ? '' : `${dayLabel(last.at, now)} `}
          {timeLabel(last.at)}
          <span className="k-changed-more">{showChanges ? 'Hide' : 'See changes'}</span>
        </button>
      )}
      {last && showChanges && <EditHistory history={o.history} now={now} />}

      <p className="k-tap-hint">Tap for options · Double-tap to complete</p>
    </article>
  );
}

function OrderOptions(props: { order: Order; now: number; onClose: () => void; onComplete: () => void; onEdit: () => void; onTags: () => void }) {
  const o = props.order;
  return (
    <Sheet open title={o.customerName} onClose={props.onClose}>
      <p className="k-opt-when">
        {dayLabel(o.dueAt, props.now)}, {timeLabel(o.dueAt)} · {o.type === 'delivery' ? 'Delivery' : 'Pickup'}
      </p>
      <button type="button" className="t-btn primary block k-opt" onClick={props.onComplete}>
        ✓ Mark completed
      </button>
      <button type="button" className="t-btn block k-opt" onClick={props.onEdit}>
        Edit order
      </button>
      <button type="button" className="t-btn block k-opt" onClick={props.onTags}>
        🏷️ Print name tags
      </button>
      <button type="button" className="t-btn ghost block k-opt" onClick={props.onClose}>
        Close
      </button>
    </Sheet>
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
