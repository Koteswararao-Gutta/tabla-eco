// Manager > Catering: open orders by day, history, and a form sheet to add or edit an order.
import { useState } from 'react';
import { Field, PageHeader, Segmented, Sheet } from '@shared/ui';
import { store, useCollection, useNow, type CateringOrder, type WithId } from '@shared/data';
import {
  dayLabel, emptyForm, formFromOrder, formFromScan, groupOpen, history, itemLines, orderFields, timeLabel, validate,
  type FormErrors, type OrderForm,
} from './orders';
import './catering.css';

type Order = WithId<CateringOrder>;

export default function Catering() {
  const orders = useCollection('orders');
  const now = useNow(30_000);
  const [editing, setEditing] = useState<string | null>(null); // order id, 'new', or closed
  const [deleting, setDeleting] = useState<Order | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const groups = orders ? groupOpen(orders, now) : null;
  const past = orders ? history(orders) : [];
  // Read the order being edited from the live list, so a change made elsewhere (e.g. the kitchen
  // completing it) shows in the sheet at once. If it is deleted elsewhere, the sheet closes.
  const editOrder = editing && editing !== 'new' ? orders?.find((o) => o.id === editing) ?? null : null;
  const sheetOpen = editing === 'new' || !!editOrder;
  const openOrder = (o: Order) => setEditing(o.id);
  const openCount = groups ? groups.overdue.length + groups.today.length + groups.tomorrow.length + groups.later.length : 0;

  return (
    <main className="t-page c-page">
      <PageHeader
        title="Catering"
        action={
          <button className="t-btn accent" onClick={() => setEditing('new')}>
            + New order
          </button>
        }
      />

      {!groups ? null : (
        <div className="t-stack">
          {openCount === 0 && <div className="t-empty">No open orders. Tap “+ New order” to add one.</div>}
          <Group title="Not completed (earlier days)" orders={groups.overdue} now={now} showDate onOpen={openOrder} late />
          <Group title="Today" orders={groups.today} now={now} onOpen={openOrder} />
          <Group title="Tomorrow" orders={groups.tomorrow} now={now} onOpen={openOrder} />
          <Group title="Later" orders={groups.later} now={now} showDate onOpen={openOrder} />

          <button className="t-btn block c-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Hide history' : `History (${past.length})`}
          </button>
          {showHistory &&
            (past.length === 0 ? (
              <div className="t-empty">No completed orders yet.</div>
            ) : (
              <Group title="History" orders={past} now={now} showDate onOpen={openOrder} />
            ))}
        </div>
      )}

      {sheetOpen && (
        <OrderSheet
          key={editing!}
          order={editOrder}
          onClose={() => setEditing(null)}
          onDelete={(o) => {
            setEditing(null);
            setDeleting(o);
          }}
        />
      )}

      <Sheet open={!!deleting} title="Delete this order?" onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="c-confirm">
              {deleting.customerName} · {dayLabel(deleting.dueAt, now)}, {timeLabel(deleting.dueAt)}. This can't be undone.
            </p>
            <button
              className="t-btn block c-danger-solid"
              onClick={async () => {
                await store.deleteDoc('orders', deleting.id);
                setDeleting(null);
              }}
            >
              Delete order
            </button>
            <button className="t-btn block ghost" onClick={() => setDeleting(null)}>
              Keep it
            </button>
          </>
        )}
      </Sheet>
    </main>
  );
}

function Group(props: { title: string; orders: Order[]; now: number; showDate?: boolean; late?: boolean; onOpen: (o: Order) => void }) {
  if (props.orders.length === 0) return null;
  return (
    <section className="c-group" aria-label={props.title}>
      <h2 className={'c-group-title' + (props.late ? ' late' : '')}>{props.title}</h2>
      <div className="t-stack">
        {props.orders.map((o) => (
          <OrderCard key={o.id} order={o} now={props.now} showDate={props.showDate} onClick={() => props.onOpen(o)} />
        ))}
      </div>
    </section>
  );
}

function OrderCard({ order: o, now, showDate, onClick }: { order: Order; now: number; showDate?: boolean; onClick: () => void }) {
  const n = itemLines(o.items).length;
  const bits = [o.people ? `${o.people} people` : null, `${n} item${n === 1 ? '' : 's'}`].filter(Boolean);
  return (
    <button className={'c-card' + (o.status === 'completed' ? ' done' : '')} onClick={onClick} data-testid="order-card">
      <span className="c-card-top">
        <span className="c-time">
          {showDate && <span className="c-date">{dayLabel(o.dueAt, now)} · </span>}
          {timeLabel(o.dueAt)}
        </span>
        {o.status === 'completed' ? (
          <span className="t-badge good">✓ Completed</span>
        ) : (
          <span className={'t-badge' + (o.type === 'delivery' ? ' accent' : '')}>{o.type === 'delivery' ? 'Delivery' : 'Pickup'}</span>
        )}
      </span>
      <span className="c-name">{o.customerName}</span>
      <span className="c-meta">{bits.join(' · ')}</span>
    </button>
  );
}

function OrderSheet({ order, onClose, onDelete }: { order: Order | null; onClose: () => void; onDelete: (o: Order) => void }) {
  const [f, setF] = useState<OrderForm>(() => (order ? formFromOrder(order) : emptyForm(store.now())));
  const [errors, setErrors] = useState<FormErrors>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<{ state: 'idle' | 'reading' | 'done' | 'failed'; message?: string }>({ state: 'idle' });
  const [unsure, setUnsure] = useState<(keyof OrderForm)[]>([]);

  const set = <K extends keyof OrderForm>(k: K, v: OrderForm[K]) => {
    const next = { ...f, [k]: v };
    setF(next);
    setUnsure((u) => u.filter((x) => x !== k));
    if (tried) setErrors(validate(next));
  };

  const scanPhoto = async (photo: File | undefined) => {
    if (!photo) return;
    setScan({ state: 'reading' });
    try {
      const read = await store.readOrderPhoto(photo);
      if (!read.isOrder) return setScan({ state: 'failed', message: "This photo doesn't look like an order. Please try another photo." });
      const filled = formFromScan(read, f);
      setF(filled.form);
      setUnsure(filled.unsure);
      if (tried) setErrors(validate(filled.form));
      setScan({ state: 'done' });
    } catch (e) {
      setScan({ state: 'failed', message: e instanceof Error ? e.message : "Couldn't read the photo." });
    }
  };

  const save = async () => {
    const e = validate(f);
    setTried(true);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const now = store.now();
    const fields = orderFields(f);
    if (order) {
      // Merge only the form's fields: status/completedAt are left alone, so completing the order in the
      // kitchen while this sheet is open is never undone by saving. Cleared optional fields become ''.
      await store.updateDoc('orders', order.id, { ...fields, address: fields.address ?? '', notes: fields.notes ?? '', updatedAt: now });
    } else {
      await store.addDoc('orders', { ...fields, status: 'open', createdAt: now, updatedAt: now });
    }
    setBusy(false);
    onClose();
  };

  const setStatus = async (status: CateringOrder['status']) => {
    if (!order) return;
    const now = store.now();
    await store.updateDoc('orders', order.id, { status, completedAt: status === 'completed' ? now : null, updatedAt: now });
    onClose();
  };

  const err = (k: keyof OrderForm) =>
    errors[k] ? (
      <small className="c-err" role="alert">{errors[k]}</small>
    ) : (
      unsure.includes(k) && <small className="c-check">Please check this: it was hard to read.</small>
    );
  const count = Object.keys(errors).length;

  return (
    <Sheet open title={order ? 'Edit order' : 'New order'} onClose={onClose}>
      <form
        className="t-stack c-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {!order && (
          <div className="c-scan">
            <label className={'t-btn block c-scan-btn' + (scan.state === 'reading' ? ' busy' : '')} aria-disabled={scan.state === 'reading'}>
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={scan.state === 'reading'}
                aria-label="Scan paper order"
                onChange={(e) => {
                  scanPhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {scan.state === 'reading' ? 'Reading the order…' : '📷 Scan paper order'}
            </label>
            {scan.state === 'done' && (
              <p className="c-scan-note" role="status">
                Filled in from the photo. Please check every field, then tap Save order.
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
          <input className="t-input" value={f.customerName} onChange={(e) => set('customerName', e.target.value)} aria-invalid={!!errors.customerName} autoComplete="off" />
          {err('customerName')}
        </Field>
        <Field label="Phone">
          <input className="t-input" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={!!errors.phone} autoComplete="off" />
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
        <Field label="Order items (one per line)">
          <textarea className="t-textarea" rows={5} value={f.items} onChange={(e) => set('items', e.target.value)} aria-invalid={!!errors.items} placeholder={'Chicken biryani, 2 large trays\nGarlic naan, 30'} />
          {err('items')}
        </Field>
        <Field label="Notes (optional)">
          <textarea className="t-textarea c-notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          {err('notes')}
        </Field>

        {count > 0 && <p className="c-err c-err-summary">Please fix the {count === 1 ? 'field' : `${count} fields`} marked above.</p>}
        <button className="t-btn primary block" type="submit" disabled={busy}>
          {order ? 'Save changes' : 'Save order'}
        </button>
        {order && (
          <div className="t-grid2">
            {order.status === 'open' ? (
              <button type="button" className="t-btn" onClick={() => setStatus('completed')}>
                Mark completed
              </button>
            ) : (
              <button type="button" className="t-btn" onClick={() => setStatus('open')}>
                Reopen
              </button>
            )}
            <button type="button" className="t-btn danger" onClick={() => onDelete(order)}>
              Delete
            </button>
          </div>
        )}
        <button type="button" className="t-btn ghost block" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Sheet>
  );
}
