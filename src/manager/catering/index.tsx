// Manager > Catering: open orders by day, history, an order summary, and a form sheet to add or edit an order.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Field, PageHeader, Segmented, Sheet, useSheetClose } from '@shared/ui';
import { store, useCollection, useDoc, useNow, useSingleton, type AlertState, type CateringOrder, type EditedBy, type OrderEdit, type OrderLine, type PayMethod, type ScannedOrder, type WithId } from '@shared/data';
import {
  amountError, amountInput, amountLabel, dayLabel, dayStart, describeChanges, parseAmount, EDITED_BY_LABEL, emptyForm, formFromOrder, formFromScan, fromInputs, groupOpen, history, itemLines, NAME_MAX, orderFields, sameDayOrders, shareText, telHref, timeLabel, validate, whatsappHref, withEdit,
  type FormErrors, type OrderForm,
} from './orders';
import { CalendarSheet } from './calendar';
import { ItemsEditor, lastUnit } from './ItemsEditor';
import { menuDishes, orderLines, qtyText, type Dish } from './lines';
import { TagsSheet } from './TagsSheet';
import { balance, depositError, depositTotal, isPaid, methodLabel, NO_PAY, PAY_METHODS, payFrom, payLabel, staffNames, unpaidDone, type Pay } from './pay';
import './catering.css';
import { Address } from './Address';
import { EstimateSheet, EstimatesList, type Estimate } from './Estimates';
import { orderFormFromEstimate } from './estimates';

type Order = WithId<CateringOrder>;
const UNDO_MS = 6000;

const SAVE_FAILED = 'Could not save. Please try again.';
const DELETE_FAILED = 'Could not delete. Please try again.';

const statusPatch = (status: CateringOrder['status']) => {
  const now = store.now();
  return { status, completedAt: status === 'completed' ? now : null, updatedAt: now };
};
const setOrderStatus = (id: string, status: CateringOrder['status']) => store.updateDoc('orders', id, statusPatch(status));

/** Runs one save at a time. On failure the button comes back and a plain message shows (as in Screens). */
function useSaver() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const run = async (fn: () => Promise<void>, failText = SAVE_FAILED) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError(failText);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export default function Catering() {
  const orders = useCollection('orders');
  // Manager only: what each order costs (orderAmounts/{order id}). The kitchen never loads this.
  const amounts = useCollection('orderAmounts');
  // Read once per snapshot, so each card gets the same Pay object until its payment changes.
  const pays = useMemo(() => (amounts ? new Map(amounts.map((a) => [a.id, payFrom(a)])) : null), [amounts]);
  const payOf = useCallback((id: string): Pay | undefined => (pays ? pays.get(id) ?? NO_PAY : undefined), [pays]);
  const now = useNow(30_000);
  // Cards only need the day (Today / Yesterday), so they don't redraw on every clock tick.
  const today = dayStart(now);
  const menu = useDoc('toastMenu', 'current');
  useStructureOldOrders(orders, menu === undefined ? undefined : menuDishes(menu));
  const [editing, setEditing] = useState<string | null>(null); // order id, 'new', or closed
  // "?order=<id>" (e.g. from More > Payments) opens that order.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get('order');
    if (!id) return;
    setEditing(id);
    setParams({}, { replace: true });
  }, [params, setParams]);
  const [deleting, setDeleting] = useState<Order | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // "Orders", "Unpaid" (finished by the kitchen, not yet paid) or "Estimates" (price quotes for customers).
  const [view, setView] = useState<'orders' | 'unpaid' | 'estimates'>('orders');
  const estimates = useCollection('estimates');
  const [estimateId, setEstimateId] = useState<string | null>(null); // estimate id, 'new', or closed
  const openEstimate = estimateId && estimateId !== 'new' ? estimates?.find((e) => e.id === estimateId) ?? null : null;
  const openEstimates = estimates ? estimates.filter((e) => e.status !== 'ordered').length : 0;
  // "Make order" from an estimate: the new-order form opens filled in from it.
  const [fromEstimate, setFromEstimate] = useState<Estimate | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [newDay, setNewDay] = useState<number | undefined>(undefined);
  // "Print tags": the order's tag sheet replaces its summary; closing it goes back to the order.
  const [tagsFor, setTagsFor] = useState<Order | null>(null);
  // "Marked completed" toast with Undo, for a few seconds.
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(doneTimer.current), []);
  const markedCompleted = (o: Order) => {
    clearTimeout(doneTimer.current);
    setDone({ id: o.id, name: o.customerName });
    doneTimer.current = setTimeout(() => setDone(null), UNDO_MS);
  };
  const undoCompleted = async () => {
    const id = done?.id;
    clearTimeout(doneTimer.current);
    setDone(null);
    if (id && orders?.some((o) => o.id === id)) await setOrderStatus(id, 'open').catch(() => {});
  };
  // Delete -> "Keep it" goes back to the order.
  const remove = useSaver();
  const keepIt = () => {
    if (deleting) setEditing(deleting.id);
    setDeleting(null);
    remove.setError('');
  };

  const groups = orders ? groupOpen(orders, now) : null;
  const past = orders ? history(orders) : [];
  // Read the order being edited from the live list, so a change made elsewhere (e.g. the kitchen
  // completing it) shows in the sheet at once. If it is deleted elsewhere, the sheet closes.
  const editOrder = editing && editing !== 'new' ? orders?.find((o) => o.id === editing) ?? null : null;
  const sheetOpen = editing === 'new' || !!editOrder;
  const openOrder = useCallback((o: Order) => setEditing(o.id), []);
  const openCount = groups ? groups.overdue.length + groups.today.length + groups.tomorrow.length + groups.later.length : 0;
  // A finished order stays in the list until it is paid.
  const unpaid = orders && amounts ? unpaidDone(orders, payOf) ?? [] : [];
  const owedTotal = unpaid.reduce((a, o) => a + (balance(payOf(o.id) ?? NO_PAY) ?? 0), 0);

  return (
    <main className="t-page c-page">
      <PageHeader
        logo
        title="Catering"
        action={
          <div className="c-head-actions">
            <button className="t-btn c-cal-btn" aria-label="Calendar" title="Calendar" onClick={() => setCalendar(true)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
                <path d="M3.5 10h17M8 3v4M16 3v4" />
              </svg>
            </button>
            {view === 'estimates' ? (
              <button className="t-btn accent" onClick={() => setEstimateId('new')}>
                + New estimate
              </button>
            ) : (
              <button
                className="t-btn accent"
                onClick={() => {
                  setNewDay(undefined);
                  setFromEstimate(null);
                  setEditing('new');
                }}
              >
                + New order
              </button>
            )}
          </div>
        }
      />

      <AlertsCard />

      <div className="c-filter" role="group" aria-label="Show">
        <button type="button" aria-pressed={view === 'orders'} onClick={() => setView('orders')}>
          Orders
        </button>
        <button type="button" aria-pressed={view === 'unpaid'} onClick={() => setView('unpaid')} data-testid="unpaid-filter">
          Unpaid
          {unpaid.length > 0 && (
            <span className="c-count" aria-label={`${unpaid.length} unpaid`}>
              {unpaid.length}
            </span>
          )}
        </button>
        <button type="button" aria-pressed={view === 'estimates'} onClick={() => setView('estimates')} data-testid="estimates-filter">
          Estimates
          {openEstimates > 0 && (
            <span className="c-count e-count" aria-label={`${openEstimates} open estimates`}>
              {openEstimates}
            </span>
          )}
        </button>
      </div>

      {view === 'estimates' ? (
        estimates && <EstimatesList estimates={estimates} now={now} onOpen={(e) => setEstimateId(e.id)} />
      ) : !groups ? null : view === 'unpaid' ? (
        <div className="t-stack" data-testid="unpaid-list">
          {unpaid.length === 0 ? (
            <div className="t-empty c-empty">Nothing to collect. Every completed order is paid.</div>
          ) : (
            owedTotal > 0 && (
              <p className="c-owed">
                <b>{amountLabel(owedTotal)}</b> still owed
              </p>
            )
          )}
          <Group orders={unpaid} today={today} payOf={payOf} showDate onOpen={openOrder} />
        </div>
      ) : (
        <div className="t-stack">
          {openCount === 0 && unpaid.length === 0 && (
            <div className="t-empty c-empty">
              No open orders.
              <br />
              Tap “+ New order” to add one.
            </div>
          )}
          <Group title="Not completed (earlier days)" orders={groups.overdue} today={today} payOf={payOf} showDate onOpen={openOrder} late />
          <Group title="Today" orders={groups.today} today={today} payOf={payOf} onOpen={openOrder} />
          <Group title="Tomorrow" orders={groups.tomorrow} today={today} payOf={payOf} onOpen={openOrder} />
          <Group title="Later" orders={groups.later} today={today} payOf={payOf} showDate onOpen={openOrder} />
          <Group title="Completed, unpaid" orders={unpaid} today={today} payOf={payOf} showDate onOpen={openOrder} />

          {past.length > 0 && (
            <button className="t-btn block c-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? 'Hide history' : `History (${past.length})`}
            </button>
          )}
          {showHistory && past.length > 0 && <Group title="History" orders={past} today={today} payOf={payOf} showDate onOpen={openOrder} />}
        </div>
      )}

      {calendar && orders && (
        <CalendarSheet
          orders={orders}
          now={now}
          onClose={() => setCalendar(false)}
          onOpen={(o) => {
            setCalendar(false);
            setEditing(o.id);
          }}
          onNew={(day) => {
            setCalendar(false);
            setNewDay(day);
            setEditing('new');
          }}
        />
      )}

      {(estimateId === 'new' || openEstimate) && (
        <EstimateSheet
          key={estimateId!}
          estimate={openEstimate}
          now={now}
          onClose={() => setEstimateId(null)}
          onCreated={(id) => setEstimateId(id)}
          onMakeOrder={(e) => {
            setEstimateId(null);
            setFromEstimate(e);
            setNewDay(undefined);
            setEditing('new');
          }}
          onOpenOrder={(id) => {
            setEstimateId(null);
            setEditing(id);
          }}
        />
      )}

      {sheetOpen && (
        <OrderSheet
          key={editing!}
          order={editOrder}
          pay={editOrder ? payOf(editOrder.id) : NO_PAY}
          day={newDay}
          now={now}
          fromEstimate={editing === 'new' ? fromEstimate ?? undefined : undefined}
          onClose={() => {
            setEditing(null);
            setFromEstimate(null);
          }}
          onCompleted={markedCompleted}
          onDelete={(o) => {
            setEditing(null);
            setDeleting(o);
          }}
          onPrintTags={(o) => {
            setEditing(null);
            setTagsFor(o);
          }}
        />
      )}

      {tagsFor && (
        <TagsSheet
          order={tagsFor}
          now={now}
          onClose={() => {
            if (orders?.some((o) => o.id === tagsFor.id)) setEditing(tagsFor.id);
            setTagsFor(null);
          }}
        />
      )}

      <Sheet open={!!deleting} title="Delete this order?" onClose={keepIt}>
        {deleting && (
          <>
            <p className="c-confirm">
              {deleting.customerName} · {dayLabel(deleting.dueAt, now)}, {timeLabel(deleting.dueAt)}. This can't be undone.
            </p>
            {remove.error && (
              <p className="c-err" role="alert">
                {remove.error}
              </p>
            )}
            <button
              className="t-btn block c-danger-solid"
              disabled={remove.busy}
              onClick={() =>
                remove.run(async () => {
                  await store.deleteDoc('orders', deleting.id);
                  await store.deleteDoc('orderAmounts', deleting.id).catch(() => {});
                  setDeleting(null);
                }, DELETE_FAILED)
              }
            >
              {remove.busy ? 'Deleting…' : 'Delete order'}
            </button>
            <button className="t-btn block ghost" onClick={keepIt}>
              Keep it
            </button>
          </>
        )}
      </Sheet>

      {done && (
        <div className="c-toast" role="status">
          <span className="c-toast-text">
            Marked completed: <b>{done.name}</b>
          </span>
          <button className="t-btn accent" onClick={undoCompleted}>
            Undo
          </button>
        </div>
      )}
    </main>
  );
}

/**
 * Once per order: an order saved before items were structured gets its `lines`, read from its text and
 * matched to the menu. Only `lines` is added: the text, the times and the history stay as they are, and
 * each line keeps its text as typed, so nothing people see changes. A line read by a guess is marked to check.
 * Waits for the orders and the menu to load; without a menu yet, it waits for one.
 */
function useStructureOldOrders(orders: Order[] | null | undefined, dishes: Dish[] | undefined) {
  const done = useRef(new Set<string>());
  useEffect(() => {
    if (!orders || !dishes || dishes.length === 0) return;
    for (const o of orders) {
      if (Array.isArray(o.lines) || done.current.has(o.id) || typeof o.items !== 'string') continue;
      done.current.add(o.id);
      const lines = orderLines({ items: o.items }, dishes);
      store.updateDoc('orders', o.id, { lines }).catch(() => done.current.delete(o.id));
    }
  }, [orders, dishes]);
}

/** The order's items for reading: quantity first, then the dish and its note. A line kept as typed reads as typed. */
export function ItemList({ lines, className, showChecks }: { lines: OrderLine[]; className: string; showChecks?: boolean }) {
  return (
    <ul className={className}>
      {lines.map((l, i) => {
        const check = showChecks && l.check ? <span className="t-badge c-check-badge">Check</span> : null;
        const extra = l.extra ? <span className="t-badge accent c-extra-badge">Extra</span> : null;
        if (l.text && (l.check || !l.dishId)) {
          return (
            <li key={i}>
              {l.text}
              {check && <> {check}</>}
            </li>
          );
        }
        const q = qtyText(l);
        return (
          <li key={i}>
            {q && <b className="c-qty-text">{q}</b>}
            {q && ' '}
            {l.name}
            {l.note.trim() && <span className="c-item-note"> · {l.note.trim()}</span>}
            {extra && <> {extra}</>}
            {check && <> {check}</>}
          </li>
        );
      })}
    </ul>
  );
}

/** Offers the 1-hour phone alerts on this device, or says why it can't. */
function AlertsCard() {
  const [state, setState] = useState<AlertState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    store.alertState().then((s) => live && setState(s), () => live && setState('unsupported'));
    return () => {
      live = false;
    };
  }, []);

  if (!state || state === 'unsupported') return null;
  if (state === 'on') return <p className="c-alerts-on" data-testid="alerts">✓ This phone gets an alert 1 hour before each order.</p>;
  return (
    <div className="c-alerts" data-testid="alerts">
      {state === 'off' && (
        <>
          <p>Get a phone alert 1 hour before each order.</p>
          <button
            className="t-btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setState(await store.turnOnAlerts().catch((): AlertState => 'off'));
              setBusy(false);
            }}
          >
            Turn on alerts
          </button>
        </>
      )}
      {state === 'needs-home-screen' && (
        <p>To get alerts on iPhone, first add this app to your Home Screen: tap Share, then “Add to Home Screen”. Then open it from there.</p>
      )}
      {state === 'blocked' && <p>Alerts are blocked on this phone. To turn them on, allow notifications for this app in the phone’s settings.</p>}
    </div>
  );
}

/** A list of order cards. Without a title (the Unpaid tab) it shows no header. */
function Group(props: { title?: string; orders: Order[]; today: number; showDate?: boolean; late?: boolean; payOf: (id: string) => Pay | undefined; onOpen: (o: Order) => void }) {
  if (props.orders.length === 0) return null;
  return (
    <section className="c-group" aria-label={props.title ?? 'Unpaid'}>
      {props.title && <h2 className={'c-group-title' + (props.late ? ' late' : '')}>{props.title}</h2>}
      <div className="t-stack">
        {props.orders.map((o) => (
          <OrderCard key={o.id} order={o} pay={props.payOf(o.id)} today={props.today} showDate={props.showDate} onOpen={props.onOpen} />
        ))}
      </div>
    </section>
  );
}

/** Manager list card. The kitchen has its own cards (src/kitchen), which never show the amount. */
const OrderCard = memo(function OrderCard({ order: o, pay, today, showDate, onOpen }: { order: Order; pay?: Pay; today: number; showDate?: boolean; onOpen: (o: Order) => void }) {
  const n = itemLines(o.items).length;
  const unpaidBadge = o.status === 'completed' && !!pay && !isPaid(pay);
  // A completed, unpaid order says "Unpaid" once, in its badge; the grey line keeps only the amount.
  const payText = unpaidBadge && depositTotal(pay) === 0 ? amountLabel(pay.amount) : payLabel(pay);
  const bits = [o.people ? `${o.people} people` : null, `${n} item${n === 1 ? '' : 's'}`, payText || null].filter(Boolean);
  return (
    <button className={'c-card' + (o.status === 'completed' ? ' done' : '')} onClick={() => onOpen(o)} data-testid="order-card">
      <span className="c-card-top">
        <span className="c-time">
          {showDate && <span className="c-date">{dayLabel(o.dueAt, today)} · </span>}
          {timeLabel(o.dueAt)}
        </span>
        {o.status === 'completed' ? (
          <span className="c-badges">
            <span className="t-badge good">✓ Completed</span>
            {unpaidBadge && <span className="t-badge bad">Unpaid</span>}
          </span>
        ) : (
          <span className={'t-badge' + (o.type === 'delivery' ? ' accent' : '')}>{o.type === 'delivery' ? 'Delivery' : 'Pickup'}</span>
        )}
      </span>
      <span className="c-name">{o.customerName}</span>
      <span className="c-meta">{bits.join(' · ')}</span>
    </button>
  );
});

/** `onDelete` is left out where deleting isn't offered (the kitchen tablet). `by` is who saves (default: Manager).
 *  `pay` (manager only): the order's saved amount and paid, undefined while loading. Those boxes show only when `by` is Manager. */
type SheetProps = { order: Order | null; pay?: Pay; day?: number; now: number; onClose: () => void; onCompleted: (o: Order) => void; onDelete?: (o: Order) => void; onPrintTags?: (o: Order) => void; by?: EditedBy;
  /** A new order made from a confirmed estimate: the form starts filled in from it, with its total as the amount. */
  fromEstimate?: Estimate };

/** An existing order opens on its summary first; "Edit" switches to the form. A new order opens on the form.
 *  Once the form has anything typed, scanned or pasted, closing the sheet asks first. */
function OrderSheet(props: SheetProps) {
  const { order } = props;
  const [editing, setEditing] = useState(!order);
  // Set by the form while it renders, and read by the Sheet at the moment of closing, so a key typed
  // just before Escape always counts.
  const dirty = useRef(false);
  // A new order, once saved: offer to send it to the front staff WhatsApp group.
  const [saved, setSaved] = useState<string | null>(null);
  // "Mark paid" (manager only) replaces the summary until it is saved or cancelled.
  const [paying, setPaying] = useState(false);
  const title = saved ? 'Order saved' : paying && order ? 'Mark paid' : !editing ? 'Order details' : order ? 'Edit order' : 'New order';
  const confirm = () => (!saved && editing && dirty.current ? (order ? 'Discard your changes?' : 'Discard this order?') : null);
  return (
    <Sheet open title={title} onClose={props.onClose} confirmClose={confirm}>
      {saved ? (
        <SavedView text={saved} onClose={props.onClose} />
      ) : paying && order && props.pay ? (
        <PayView order={order} pay={props.pay} now={props.now} onBack={() => setPaying(false)} />
      ) : !editing && order ? (
        <OrderSummary {...props} order={order} onEdit={() => setEditing(true)} onPay={() => setPaying(true)} />
      ) : (
        <OrderFormView {...props} dirty={dirty} onSaved={setSaved} />
      )}
    </Sheet>
  );
}

/** Opens WhatsApp with the order typed in; the person picks the front staff group and sends. */
function ShareLink({ text, primary }: { text: string; primary?: boolean }) {
  return (
    <a className={'t-btn block c-share' + (primary ? ' primary' : '')} href={whatsappHref(text)} target="_blank" rel="noopener noreferrer">
      Share to WhatsApp
    </a>
  );
}

/** After a new order is saved. */
function SavedView({ text, onClose }: { text: string; onClose: () => void }) {
  // Share sits at the bottom, where Save was, and Done above it: a double tap on Save never skips sharing.
  return (
    <div className="t-stack c-saved" data-testid="order-saved">
      <p className="c-scan-note">✓ Saved. Send it to the front staff group so they can get the sides ready.</p>
      <pre className="c-share-preview" aria-label="Message">{text}</pre>
      <button type="button" className="t-btn block" onClick={onClose}>
        Done
      </button>
      <ShareLink text={text} primary />
    </div>
  );
}

function OrderSummary({ order: o, pay, now, onClose, onCompleted, onDelete, onPrintTags, onEdit, onPay }: SheetProps & { order: Order; onEdit: () => void; onPay: () => void }) {
  const { busy, error, run } = useSaver();
  const lines = orderLines(o);
  const toCheck = lines.filter((l) => l.check).length;
  const open = o.status === 'open';
  const setStatus = (status: CateringOrder['status']) =>
    run(async () => {
      await setOrderStatus(o.id, status);
      if (status === 'completed') onCompleted(o);
      onClose();
    });
  return (
    <div className="t-stack c-summary" data-testid="order-summary">
      <div className="c-sum-top">
        <span className="c-sum-when">
          {dayLabel(o.dueAt, now)}, {timeLabel(o.dueAt)}
        </span>
        {open ? (
          <span className={'t-badge' + (o.type === 'delivery' ? ' accent' : '')}>{o.type === 'delivery' ? 'Delivery' : 'Pickup'}</span>
        ) : (
          <span className="t-badge good">✓ Completed</span>
        )}
      </div>
      <div className="c-sum-name">{o.customerName}</div>
      {o.phone && (
        <a className="t-btn block c-call" href={telHref(o.phone)}>
          Call {o.phone}
        </a>
      )}
      <dl className="c-sum-facts">
        <div>
          <dt>{o.type === 'delivery' ? 'Delivery to' : 'Pickup'}</dt>
          <dd>{o.type === 'delivery' ? o.address ? <Address address={o.address} maps /> : 'No address yet' : 'At the restaurant'}</dd>
        </div>
        {!!o.people && (
          <div>
            <dt>People</dt>
            <dd>{o.people}</dd>
          </div>
        )}
        {pay && (
          <div data-testid="order-amount">
            <dt>Amount</dt>
            <dd>
              {amountLabel(pay.amount) || 'Not set'} <PayBadge pay={pay} />
            </dd>
          </div>
        )}
      </dl>
      {pay && <PaymentsList order={o} pay={pay} now={now} />}
      <div>
        <h3 className="c-sum-h">Items</h3>
        <ItemList lines={lines} className="c-sum-items" showChecks />
        {toCheck > 0 && (
          <p className="c-check" data-testid="items-to-check">
            {toCheck === 1 ? '1 item was' : `${toCheck} items were`} read automatically. Tap Edit to check {toCheck === 1 ? 'it' : 'them'}, then Save.
          </p>
        )}
      </div>
      {o.notes?.trim() && (
        <div>
          <h3 className="c-sum-h">Notes</h3>
          <p className="c-sum-notes">{o.notes}</p>
        </div>
      )}
      {error && (
        <p className="c-err" role="alert">
          {error}
        </p>
      )}
      <button type="button" className={'t-btn block ' + (open ? 'primary' : '')} disabled={busy} onClick={() => setStatus(open ? 'completed' : 'open')}>
        {open ? '✓ Mark completed' : 'Reopen'}
      </button>
      {pay && !isPaid(pay) && (
        <button type="button" className={'t-btn block' + (open ? '' : ' primary')} onClick={onPay}>
          Mark paid
        </button>
      )}
      {open && <ShareLink text={shareText(o)} />}
      {onPrintTags && (
        <button type="button" className="t-btn block" onClick={() => onPrintTags(o)}>
          Print name tags
        </button>
      )}
      <div className="t-grid2">
        <button type="button" className="t-btn" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="t-btn danger" onClick={() => onDelete?.(o)}>
          Delete
        </button>
      </div>
      <EditHistory history={o.history} now={now} />
      <button type="button" className="t-btn ghost block" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/** "✓ Paid", "$200 owed", "$100 paid so far" (deposits, no amount yet) or "Unpaid". */
function PayBadge({ pay }: { pay: Pay }) {
  if (isPaid(pay)) return <span className="t-badge good">✓ Paid</span>;
  const owed = balance(pay);
  const dep = depositTotal(pay);
  if (dep > 0 && owed == null) return <span className="t-badge">{amountLabel(dep)} paid so far</span>;
  if (dep > 0 && owed != null) return <span className="t-badge bad">{amountLabel(owed)} owed</span>;
  return <span className="t-badge bad">Unpaid</span>;
}

const whenLabel = (at: number, now: number) => `${dayLabel(at, now)}, ${timeLabel(at)}`;

/** Manager only: deposits taken so far, and the final payment once paid (how, who, when). Each can be undone. */
function PaymentsList({ order, pay, now }: { order: Order; pay: Pay; now: number }) {
  const { busy, error, run } = useSaver();
  // A tap on Remove asks once more, on the same button.
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!pay.paid && pay.deposits.length === 0) return null;
  const removeDeposit = (i: number) =>
    run(async () => {
      await store.updateDoc('orderAmounts', order.id, { deposits: pay.deposits.filter((_, j) => j !== i), updatedAt: store.now() });
      setConfirm(null);
    });
  const markNotPaid = () =>
    run(async () => {
      await store.updateDoc('orderAmounts', order.id, { paid: false, paidAt: null, method: null, takenBy: null, updatedAt: store.now() });
      setConfirm(null);
    });
  const owed = balance(pay);
  return (
    <section className="c-pays" data-testid="payments" aria-label="Payments">
      <h3 className="c-sum-h">Payments</h3>
      <ul className="c-pay-list">
        {pay.deposits.map((d, i) => (
          <li key={`${d.at}-${i}`} className="c-pay-row">
            <span className="c-pay-text">
              <b>Deposit {amountLabel(d.amount)}</b> · {methodLabel(d.method)} · {d.takenBy}
              <small>{whenLabel(d.at, now)}</small>
            </span>
            <button type="button" className="t-btn ghost c-pay-undo" disabled={busy} onClick={() => (confirm === `d${i}` ? removeDeposit(i) : setConfirm(`d${i}`))}>
              {confirm === `d${i}` ? 'Tap to remove' : 'Remove'}
            </button>
          </li>
        ))}
        {pay.paid && (
          <li className="c-pay-row" data-testid="paid-row">
            <span className="c-pay-text">
              <b>✓ Paid in full</b>
              {pay.method && <> · {methodLabel(pay.method)}</>}
              {pay.takenBy && <> · {pay.takenBy}</>}
              {pay.paidAt != null && <small>{whenLabel(pay.paidAt, now)}</small>}
            </span>
            <button type="button" className="t-btn ghost c-pay-undo" disabled={busy} onClick={() => (confirm === 'paid' ? markNotPaid() : setConfirm('paid'))}>
              {confirm === 'paid' ? 'Tap to undo' : 'Undo'}
            </button>
          </li>
        )}
      </ul>
      {!isPaid(pay) && owed != null && (
        <p className="c-owed" data-testid="still-owed">
          Paid so far {amountLabel(depositTotal(pay))} · <b>{amountLabel(owed)} still owed</b>
        </p>
      )}
      {error && (
        <p className="c-err" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Manager only: record a payment. "Paid in full" marks the order paid; "Deposit" records part of it.
 *  How they paid and who took it are required; the date and time are saved automatically. */
function PayView({ order, pay, now, onBack }: { order: Order; pay: Pay; now: number; onBack: () => void }) {
  const staffConfig = useSingleton('staffConfig');
  const names = staffConfig === undefined ? null : staffNames(staffConfig);
  const [kind, setKind] = useState<'full' | 'deposit'>('full');
  const [depositText, setDepositText] = useState('');
  const [method, setMethod] = useState<Pay['method']>(null);
  const [takenBy, setTakenBy] = useState('');
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useSaver();
  const owed = balance(pay);
  const errs = {
    deposit: kind === 'deposit' ? depositError(depositText, pay) : '',
    method: method ? '' : 'Please choose how they paid.',
    takenBy: takenBy ? '' : 'Please choose who took the payment.',
  };
  const save = () => {
    setTried(true);
    if (errs.deposit || errs.method || errs.takenBy || !method) return;
    run(async () => {
      const at = store.now();
      if (kind === 'deposit') {
        const amount = parseAmount(depositText)!;
        await store.updateDoc('orderAmounts', order.id, { deposits: [...pay.deposits, { amount, method, takenBy, at }], updatedAt: at });
      } else {
        await store.updateDoc('orderAmounts', order.id, { paid: true, paidAt: at, method, takenBy, updatedAt: at });
      }
      onBack();
    });
  };
  const show = (k: keyof typeof errs) => tried && errs[k] && <small className="c-err" role="alert">{errs[k]}</small>;
  return (
    <form
      className="t-stack c-form c-pay"
      data-testid="pay-view"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="c-pay-head">
        <div className="c-sum-name">{order.customerName}</div>
        <div className="c-meta">
          {dayLabel(order.dueAt, now)}, {timeLabel(order.dueAt)}
        </div>
      </div>
      <dl className="c-sum-facts" data-testid="pay-totals">
        <div>
          <dt>Amount</dt>
          <dd>{amountLabel(pay.amount) || 'Not set'}</dd>
        </div>
        {pay.deposits.length > 0 && (
          <div>
            <dt>Paid so far</dt>
            <dd>{amountLabel(depositTotal(pay))}</dd>
          </div>
        )}
        {owed != null && (
          <div>
            <dt>Still owed</dt>
            <dd>{amountLabel(owed)}</dd>
          </div>
        )}
      </dl>
      <div className="t-field">
        <span>Payment</span>
        <Segmented
          label="Payment"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'full', label: owed ? `Paid in full (${amountLabel(owed)})` : 'Paid in full' },
            { value: 'deposit', label: 'Deposit' },
          ]}
        />
      </div>
      {kind === 'deposit' && (
        <Field label="Deposit amount $">
          <input
            className="t-input c-amount"
            inputMode="decimal"
            placeholder="e.g. 100"
            value={depositText}
            onChange={(e) => setDepositText(e.target.value)}
            aria-invalid={tried && !!errs.deposit}
            autoComplete="off"
            data-testid="deposit-input"
          />
          {show('deposit')}
        </Field>
      )}
      <div className="t-field">
        <span>How they paid</span>
        <div className="c-methods">
          {/* Nothing is pressed until they choose. */}
          <Segmented<PayMethod> label="How they paid" value={method as PayMethod} onChange={setMethod} options={PAY_METHODS} />
        </div>
        {show('method')}
      </div>
      <Field label="Taken by">
        <select className="t-select" value={takenBy} onChange={(e) => setTakenBy(e.target.value)} aria-invalid={tried && !!errs.takenBy} disabled={!names}>
          <option value="">Choose a person…</option>
          {(names ?? []).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {names && names.length === 0 ? <small className="c-hint">No staff yet. Add people in the Staff tab.</small> : show('takenBy')}
      </Field>
      <p className="c-hint">The date and time are saved automatically. Not shown on the kitchen tablet.</p>
      {error && (
        <p className="c-err" role="alert">
          {error}
        </p>
      )}
      <button className="t-btn primary block" type="submit" disabled={busy}>
        {busy ? 'Saving…' : kind === 'deposit' ? 'Save deposit' : '✓ Mark paid'}
      </button>
      <button type="button" className="t-btn ghost block" onClick={onBack}>
        Back
      </button>
    </form>
  );
}

/** "Changes": who edited the order (Kitchen or Manager), when, and what changed. Newest first. Nothing when never edited. */
export function EditHistory({ history, now }: { history?: OrderEdit[]; now: number }) {
  const list = Array.isArray(history) ? [...history].reverse() : [];
  if (list.length === 0) return null;
  return (
    <section className="c-hist" data-testid="edit-history" aria-label="Changes">
      <h3 className="c-sum-h">Changes</h3>
      <ol className="c-hist-list">
        {list.map((e, i) => (
          <li key={`${e.at}-${i}`} className="c-hist-entry">
            <div className="c-hist-who">
              <b>{EDITED_BY_LABEL[e.by] ?? 'Someone'}</b> · {dayLabel(e.at, now)}, {timeLabel(e.at)}
            </div>
            <ul className="c-hist-changes">
              {(Array.isArray(e.changes) ? e.changes : []).map((c, j) => (
                <li key={j}>{c}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The edit form on its own, in a sheet: used by the kitchen tablet ("Edit" on an order). Saves as `by`, no Delete. */
export function EditOrderSheet({ order, now, by, onClose, onCompleted }: { order: Order; now: number; by: EditedBy; onClose: () => void; onCompleted: (o: Order) => void }) {
  const dirty = useRef(false);
  return (
    <Sheet open title="Edit order" onClose={onClose} confirmClose={() => (dirty.current ? 'Discard your changes?' : null)}>
      <OrderFormView order={order} now={now} by={by} dirty={dirty} onClose={onClose} onCompleted={onCompleted} onSaved={() => onClose()} />
    </Sheet>
  );
}

function OrderFormView(props: SheetProps & { dirty: { current: boolean }; onSaved: (shareText: string) => void }) {
  const { order, onClose, by = 'manager' } = props;
  // The amount box is for the manager app only. It is kept apart from the order form, so it never goes
  // into the order, its change history, the WhatsApp message or the kitchen's edit form.
  const showAmount = by === 'manager';
  const requestClose = useSheetClose();
  const form = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0); // bumps on a save with errors
  // After a save with errors, bring the first marked field into view and put the cursor in it.
  useEffect(() => {
    if (!attempt) return;
    const first = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!first) return;
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    first.focus({ preventScroll: true });
  }, [attempt]);
  const menu = useDoc('toastMenu', 'current');
  const dishes = menuDishes(menu);
  const [start] = useState<OrderForm>(() => {
    if (order) return formFromOrder(order, dishes);
    if (props.fromEstimate) return orderFormFromEstimate(props.fromEstimate);
    const f = emptyForm(store.now(), props.day);
    return { ...f, lines: [{ ...f.lines[0], unit: lastUnit() }] };
  });
  const [f, setF] = useState<OrderForm>(start);
  const allOrders = useCollection('orders');
  const [errors, setErrors] = useState<FormErrors>({});
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useSaver();
  const [scan, setScan] = useState<{ state: 'idle' | 'reading' | 'done' | 'failed'; from?: 'photo' | 'message'; message?: string }>({ state: 'idle' });
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [unsure, setUnsure] = useState<(keyof OrderForm)[]>([]);

  // The saved amount can arrive after the form opens: take it then, unless something was typed already.
  // Paid / deposits are recorded with "Mark paid" on the order's summary, not here.
  const loaded = (p: Pay | undefined) => (p === undefined && order ? undefined : { amount: amountInput(p?.amount) });
  const [payStart, setPayStart] = useState(() => loaded(props.pay));
  const [amount, setAmount] = useState(props.fromEstimate && !order ? amountInput(props.fromEstimate.total) : payStart?.amount ?? '');
  const [amountErr, setAmountErr] = useState('');
  useEffect(() => {
    if (payStart !== undefined || props.pay === undefined) return;
    const p = loaded(props.pay)!;
    setPayStart(p);
    setAmount((typed) => (typed ? typed : p.amount));
  }, [props.pay, payStart]);
  const amountChanged = showAmount && payStart !== undefined && parseAmount(amount) !== parseAmount(payStart.amount);
  // The amount can't go below the deposits already taken (then "owed" and the week's totals stop adding up).
  const amountProblem = (v: string) => {
    const e = amountError(v);
    if (e) return e;
    const n = parseAmount(v), dep = props.pay ? depositTotal(props.pay) : 0;
    if (n === null && dep > 0) return 'Deposits already taken. Enter the full amount.';
    return n !== null && dep > n ? `Deposits already add up to ${amountLabel(dep)}.` : '';
  };
  const typeAmount = (v: string) => {
    setAmount(v);
    if (tried) setAmountErr(amountProblem(v));
  };
  // A new order already added (its amount save failed): Save again retries the amount only, never a second order.
  const created = useRef<string | null>(null);
  /** Saves the amount for this order id (manager only), when it changed. A merge, so payments stay as they are. */
  const saveAmount = async (id: string) => {
    if (!amountChanged) return;
    await store.updateDoc('orderAmounts', id, { amount: parseAmount(amount), updatedAt: store.now() });
  };

  const changed = JSON.stringify(f) !== JSON.stringify(start) || (!!props.fromEstimate && !order);
  props.dirty.current = changed || amountChanged || scan.state === 'done' || pasted.trim() !== '';

  const set = <K extends keyof OrderForm>(k: K, v: OrderForm[K]) => {
    const next = { ...f, [k]: v };
    setF(next);
    setUnsure((u) => u.filter((x) => x !== k));
    if (tried) setErrors(validate(next));
  };

  const fillFrom = async (from: 'photo' | 'message', read: () => Promise<ScannedOrder>) => {
    setScan({ state: 'reading', from });
    try {
      const got = await read();
      if (!got.isOrder) {
        const message = from === 'photo' ? "This photo doesn't look like an order. Please try another photo." : "This message doesn't look like an order. Please check what you pasted.";
        return setScan({ state: 'failed', from, message });
      }
      const filled = formFromScan(got, f, dishes);
      setF(filled.form);
      setUnsure(filled.unsure);
      if (tried) setErrors(validate(filled.form));
      setScan({ state: 'done', from });
      setPasting(false);
    } catch (e) {
      setScan({ state: 'failed', from, message: e instanceof Error ? e.message : `Couldn't read the ${from}.` });
    }
  };
  const scanPhoto = (photo: File | undefined) => photo && fillFrom('photo', () => store.readOrderPhoto(photo));
  const readPasted = (text = pasted) => {
    if (text.trim().length < 5) return setScan({ state: 'failed', from: 'message', message: 'Please paste the customer’s message first.' });
    fillFrom('message', () => store.readOrderText(text));
  };
  // One tap: read what was copied and fill the form at once. If the phone won't share the clipboard,
  // the box opens instead, and pasting into it fills the form the same way.
  const openPaste = async () => {
    setScan({ state: 'idle' });
    let copied = '';
    try {
      copied = ((await navigator.clipboard?.readText?.()) ?? '').slice(0, 8000);
    } catch {
      /* not allowed here: the person pastes into the box */
    }
    if (copied.trim().length >= 5) {
      setPasted(copied);
      readPasted(copied);
    } else {
      setPasting(true);
    }
  };

  /** Checks the form; false (and the errors shown, first one focused) when something needs fixing. */
  const check = () => {
    const e = validate(f);
    const ae = showAmount && (amountChanged || !order) ? amountProblem(amount) : '';
    setTried(true);
    setErrors(e);
    setAmountErr(ae);
    if (Object.keys(e).length || ae) {
      setAttempt((n) => n + 1);
      return false;
    }
    return true;
  };
  // Merge only the form's fields: status/completedAt are left alone, so completing the order in the
  // kitchen while this sheet is open is never undone by saving. Cleared optional fields become ''.
  // What changed (compared with the order as saved right now) is added to its history, with who saved it.
  // Only fields changed in this form are sent, so an edit made elsewhere while it was open (the kitchen
  // adding an item or a note) is not written over with what the form loaded.
  const editFields = () => {
    const all = orderFields(f);
    const was = orderFields(start);
    const full = { ...all, address: all.address ?? '', notes: all.notes ?? '' };
    const before = { ...was, address: was.address ?? '', notes: was.notes ?? '' };
    const changed = Object.fromEntries(Object.entries(full).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof typeof before])));
    // Items are saved twice (as text and as lines): they always go together.
    if ('items' in changed || 'lines' in changed) Object.assign(changed, { items: full.items, lines: full.lines });
    const at = store.now();
    const next = { ...changed, updatedAt: at } as Partial<typeof full> & { updatedAt: number };
    const changes = order ? describeChanges(order, { ...order, ...next }) : [];
    return changes.length ? { ...next, history: withEdit(order!.history, { at, by, changes }) } : next;
  };

  const save = () => {
    if (!check()) return;
    run(async () => {
      const now = store.now();
      if (order) {
        await store.updateDoc('orders', order.id, editFields());
        await saveAmount(order.id);
        return onClose();
      }
      const fields = orderFields(f);
      const id = created.current ?? (created.current = await store.addDoc('orders', { ...fields, status: 'open', createdAt: now, updatedAt: now }));
      await saveAmount(id);
      // The estimate it came from is kept, marked as made into this order.
      if (props.fromEstimate) await store.updateDoc('estimates', props.fromEstimate.id, { status: 'ordered', orderId: id, updatedAt: store.now() }).catch(() => {});
      props.onSaved(shareText(fields, 'New catering order'));
    });
  };

  const err = (k: keyof OrderForm) =>
    errors[k] ? (
      <small className="c-err" role="alert">{errors[k]}</small>
    ) : (
      unsure.includes(k) && <small className="c-check">Please check this: it was {scan.from === 'message' ? 'unclear' : 'hard to read'}.</small>
    );
  const count = Object.keys(errors).length + (amountErr ? 1 : 0);
  // A soft warning only: a new order, or a changed date or time, that is already in the past. Saving still works.
  const at = f.time ? fromInputs(f.date, f.time) : null;
  const whenChanged = !order || f.date !== start.date || f.time !== start.time;
  const pastTime = whenChanged && at !== null && at < store.now();

  return (
    <form
      ref={form}
      className="t-stack c-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {props.fromEstimate && !order && (
        <p className="c-scan-note" role="status" data-testid="from-estimate">
          Filled in from the estimate. {f.date && f.time ? 'Please check everything' : 'Please add the date and time'}, then tap Save order.
        </p>
      )}
      {!order && !props.fromEstimate && (
        <div className="c-scan">
          <div className="c-scan-row">
            <label className={'t-btn block c-scan-btn' + (scan.state === 'reading' && scan.from === 'photo' ? ' busy' : '')} aria-disabled={scan.state === 'reading'}>
              <input
                type="file"
                accept="image/*"
                className="c-file"
                disabled={scan.state === 'reading'}
                aria-label="Scan paper order"
                onChange={(e) => {
                  scanPhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {scan.state === 'reading' && scan.from === 'photo' ? 'Reading…' : 'Scan paper'}
            </label>
            <button
              type="button"
              className={'t-btn block c-scan-btn' + (pasting ? ' on' : '')}
              disabled={scan.state === 'reading'}
              aria-expanded={pasting}
              onClick={() => (pasting ? setPasting(false) : openPaste())}
            >
              {scan.state === 'reading' && scan.from === 'message' ? 'Reading…' : 'Paste message'}
            </button>
          </div>
          {pasting && (
            <div className="c-paste">
              <textarea
                className="t-input c-paste-box"
                aria-label="Customer's message"
                placeholder="Press and hold here, then tap Paste"
                rows={5}
                maxLength={8000}
                value={pasted}
                autoFocus
                onChange={(e) => setPasted(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text').slice(0, 8000);
                  if (pasted.trim() || text.trim().length < 5) return; // adding to typed text: let them tap Fill the form
                  e.preventDefault();
                  setPasted(text);
                  readPasted(text);
                }}
              />
              <button type="button" className="t-btn primary block" disabled={scan.state === 'reading'} onClick={() => readPasted()}>
                {scan.state === 'reading' && scan.from === 'message' ? 'Reading the message…' : 'Fill the form'}
              </button>
            </div>
          )}
          {scan.state === 'done' && (
            <p className="c-scan-note" role="status">
              Filled in from the {scan.from === 'message' ? 'message' : 'photo'}. Please check every field, then tap Save order.
            </p>
          )}
          {scan.state === 'failed' && (
            <p className="c-err" role="alert">
              {scan.message}
            </p>
          )}
        </div>
      )}
      <Field label="Customer name">
        <input className="t-input" maxLength={NAME_MAX} value={f.customerName} onChange={(e) => set('customerName', e.target.value)} aria-invalid={!!errors.customerName} autoComplete="off" />
        {err('customerName')}
      </Field>
      <Field label="Phone">
        <input className="t-input" type="tel" inputMode="tel" maxLength={30} value={f.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={!!errors.phone} autoComplete="off" />
        {err('phone')}
      </Field>
      <div className="t-grid2">
        <Field label="Date">
          <input className="t-input" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} aria-invalid={!!errors.date} />
          {err('date')}
        </Field>
        <Field label="Time">
          <input className="t-input" type="time" value={f.time} onChange={(e) => set('time', e.target.value)} aria-invalid={!!errors.time} />
          {err('time')}
        </Field>
      </div>
      {pastTime && (
        <p className="c-check c-past" role="status" data-testid="past-time">
          This time has already passed. Did you mean tomorrow?
        </p>
      )}
      <SameDay orders={allOrders ?? []} date={f.date} time={f.time} skipId={order?.id} />
      <div className="t-field">
        <span>Pickup or delivery</span>
        <Segmented
          label="Pickup or delivery"
          value={f.type}
          onChange={(v) => set('type', v)}
          options={[
            { value: 'pickup', label: 'Pickup' },
            { value: 'delivery', label: 'Delivery' },
          ]}
        />
        {err('type')}
      </div>
      {f.type === 'delivery' && (
        <Field label="Delivery address">
          <input className="t-input" value={f.address} onChange={(e) => set('address', e.target.value)} aria-invalid={!!errors.address} autoComplete="off" />
          {err('address')}
        </Field>
      )}
      <Field label="Number of people (optional)">
        <input className="t-input c-people" inputMode="numeric" value={f.people} onChange={(e) => set('people', e.target.value)} aria-invalid={!!errors.people} />
        {err('people')}
      </Field>
      <div className="t-field">
        <span>Order items</span>
        <ItemsEditor lines={f.lines} dishes={dishes} onChange={(lines) => set('lines', lines)} invalid={!!errors.lines} />
        {err('lines')}
      </div>
      <Field label="Notes (optional)">
        <textarea className="t-textarea c-notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        {err('notes')}
      </Field>
      {showAmount && (
        <Field label="Amount $ (optional)">
          <input
            className="t-input c-amount"
            inputMode="decimal"
            placeholder="e.g. 200"
            value={amount}
            disabled={payStart === undefined}
            onChange={(e) => typeAmount(e.target.value)}
            aria-invalid={!!amountErr}
            autoComplete="off"
            data-testid="amount-input"
          />
          {amountErr ? <small className="c-err" role="alert">{amountErr}</small> : <small className="c-hint">Not shown on the kitchen tablet.</small>}
        </Field>
      )}

      {/* Save stays in view at the bottom of the sheet while the form scrolls. */}
      <div className="c-form-foot">
        {count > 0 && <p className="c-err c-err-summary">Please fix the {count === 1 ? 'field' : `${count} fields`} marked above.</p>}
        {error && (
          <p className="c-err c-err-summary" role="alert">
            {error}
          </p>
        )}
        <button className="t-btn primary block" type="submit" disabled={busy}>
          {busy ? 'Saving…' : order ? 'Save changes' : 'Save order'}
        </button>
      </div>
      <button type="button" className="t-btn ghost block" onClick={requestClose}>
        Cancel
      </button>
    </form>
  );
}

/** Under the date and time: the other orders that day, and a warning when one is within an hour. */
function SameDay({ orders, date, time, skipId }: { orders: Order[]; date: string; time: string; skipId?: string }) {
  const at = fromInputs(date, time || '12:00');
  if (at === null) return null;
  const others = sameDayOrders(orders, at, skipId);
  if (others.length === 0) return <p className="c-sameday" data-testid="same-day">No other orders that day.</p>;
  const close = time ? others.filter((o) => o.close) : [];
  return (
    <div className={'c-sameday' + (close.length ? ' clash' : '')} data-testid="same-day">
      {close.length > 0 && (
        <p className="c-clash" role="status">
          ⚠ Within 1 hour of {close.map((c) => `${c.order.customerName} (${timeLabel(c.order.dueAt)})`).join(' and ')}.
        </p>
      )}
      <p>
        {others.length === 1 ? 'Also that day: ' : `${others.length} other orders that day: `}
        {others.map((o, i) => (
          <span key={o.order.id} className={o.close && time ? 'c-sameday-close' : ''}>
            {i > 0 && ', '}
            {timeLabel(o.order.dueAt)} {o.order.customerName}
          </span>
        ))}
      </p>
    </div>
  );
}
