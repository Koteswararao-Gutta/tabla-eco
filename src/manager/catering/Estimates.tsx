// Catering > Estimates: price quotes made with a customer before they confirm. Staff pick the items, the
// prices come from the price list (☰ More > Catering prices, manager app), any price can be changed, and the
// estimate goes to the customer on WhatsApp. When they agree, "Make order" opens the new-order form filled in.
// Front and manager apps both have this; the kitchen never loads estimates.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, Segmented, Sheet, useSheetClose } from '@shared/ui';
import { store, useDoc, useSingleton, type CateringEstimate, type ScannedOrder, type WithId } from '@shared/data';
import { amountLabel, dayLabel, NAME_MAX, parseQty, telHref, timeLabel, toTimeInput } from './orders';
import { ItemsEditor, lastUnit } from './ItemsEditor';
import { menuDishes, qtyText } from './lines';
import { priceList } from './prices';
import {
  customerWhatsappHref, draftPrice, emptyEstimateForm, estimateFields, estimateFormFromScan, estimateText, estimateTotals, formFromEstimate, formTotals, validateEstimate, VALID_DAYS,
  type EstimateErrors, type EstimateForm, type PricedDraft,
} from './estimates';
import { ScanPaste, type ScanFrom } from './ScanPaste';
import { useAppMode } from '../mode';
import './estimates.css';

export type Estimate = WithId<CateringEstimate>;

/** Runs one save at a time; on failure the button comes back with a plain message. */
function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const run = async (fn: () => Promise<void>, fail = 'Could not save. Please try again.') => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError(fail);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** "Sat, Nov 28, 6:00 PM", "Sat, Nov 28" (no time yet) or "No date yet". */
function whenText(e: Pick<CateringEstimate, 'dueAt'>, now: number): string {
  if (typeof e.dueAt !== 'number') return 'No date yet';
  return toTimeInput(e.dueAt) === '12:00' ? dayLabel(e.dueAt, now) : `${dayLabel(e.dueAt, now)}, ${timeLabel(e.dueAt)}`;
}

// ---------- the list ----------

export function EstimatesList({ estimates, now, onOpen }: { estimates: Estimate[]; now: number; onOpen: (e: Estimate) => void }) {
  const [showOrdered, setShowOrdered] = useState(false);
  const open = estimates.filter((e) => e.status !== 'ordered').sort((a, b) => b.updatedAt - a.updatedAt);
  const ordered = estimates.filter((e) => e.status === 'ordered').sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="t-stack" data-testid="estimates-list">
      {open.length === 0 && (
        <div className="t-empty c-empty">
          No estimates.
          <br />
          Tap “+ Estimate” to price an order for a customer.
        </div>
      )}
      {open.map((e) => (
        <EstimateCard key={e.id} e={e} now={now} onOpen={onOpen} />
      ))}
      {ordered.length > 0 && (
        <button className="t-btn block c-history-toggle" aria-expanded={showOrdered} onClick={() => setShowOrdered(!showOrdered)}>
          {showOrdered ? 'Hide confirmed' : `Confirmed, made into orders (${ordered.length})`}
        </button>
      )}
      {showOrdered && ordered.map((e) => <EstimateCard key={e.id} e={e} now={now} onOpen={onOpen} />)}
    </div>
  );
}

function EstimateCard({ e, now, onOpen }: { e: Estimate; now: number; onOpen: (e: Estimate) => void }) {
  const n = (e.lines ?? []).filter((l) => !l.extra).length;
  const bits = [e.people ? `${e.people} people` : null, `${n} item${n === 1 ? '' : 's'}`, `Updated ${dayLabel(e.updatedAt, now).toLowerCase()}`].filter(Boolean);
  return (
    <button className={'c-card' + (e.status === 'ordered' ? ' done' : '')} onClick={() => onOpen(e)} data-testid="estimate-card">
      <span className="c-card-top">
        <span className="c-time">{whenText(e, now)}</span>
        {e.status === 'ordered' ? <span className="t-badge good">✓ Ordered</span> : <span className="e-card-total">{amountLabel(e.total) || '$0'}</span>}
      </span>
      <span className="c-name">{e.customerName}</span>
      <span className="c-meta">{bits.join(' · ')}</span>
    </button>
  );
}

// ---------- the sheet ----------

type SheetProps = { estimate: Estimate | null; now: number; onClose: () => void; onCreated: (id: string) => void; onMakeOrder: (e: Estimate) => void; onOpenOrder: (orderId: string) => void;
  /** After a delete (soft: the estimate is hidden, not removed), e.g. to offer Undo. */
  onDeleted?: (e: Estimate) => void };

/** A saved estimate opens on its summary; a new one on the form. After saving, the summary shows (with Send). */
export function EstimateSheet(props: SheetProps) {
  const { estimate } = props;
  const [editing, setEditing] = useState(!estimate);
  const dirty = useRef(false);
  const title = !editing && estimate ? 'Estimate' : estimate ? 'Edit estimate' : 'New estimate';
  return (
    <Sheet open title={title} onClose={props.onClose} confirmClose={() => (editing && dirty.current ? 'Discard your changes?' : null)}>
      {!editing && estimate ? (
        <EstimateSummary {...props} estimate={estimate} onEdit={() => setEditing(true)} />
      ) : (
        <EstimateFormView estimate={estimate} dirty={dirty} onSaved={(id) => (estimate ? setEditing(false) : props.onCreated(id))} onCancel={estimate ? () => setEditing(false) : undefined} />
      )}
    </Sheet>
  );
}

function EstimateSummary({ estimate: e, now, onClose, onMakeOrder, onOpenOrder, onDeleted, onEdit }: SheetProps & { estimate: Estimate; onEdit: () => void }) {
  const settings = useSingleton('settings');
  const { busy, error, run } = useBusy();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const t = estimateTotals(e);
  // The order it was made into: when that order was deleted, the estimate can be made into an order again.
  const linked = useDoc('orders', e.status === 'ordered' && e.orderId ? e.orderId : '_none');
  const orderGone = e.status === 'ordered' && (!e.orderId || linked === null || (!!linked && typeof linked.deletedAt === 'number'));
  const ordered = e.status === 'ordered' && !orderGone;
  const text = estimateText(e, settings?.restaurantName?.trim() ? `${settings.restaurantName.trim()} Indian Restaurant` : undefined, now);
  return (
    <div className="t-stack c-summary" data-testid="estimate-summary">
      <div className="c-sum-top">
        <span className="c-sum-when">{whenText(e, now)}</span>
        {ordered ? <span className="t-badge good">✓ Made into an order</span> : orderGone ? <span className="t-badge bad">Order was deleted</span> : <span className={'t-badge' + (e.type === 'delivery' ? ' accent' : '')}>{e.type === 'delivery' ? 'Delivery' : 'Pickup'}</span>}
      </div>
      <div className="c-sum-name">{e.customerName}</div>
      {e.phone && (
        <a className="t-btn block c-call" href={telHref(e.phone)}>
          Call {e.phone}
        </a>
      )}
      {(!!e.people || (e.type === 'delivery' && e.address)) && (
        <dl className="c-sum-facts">
          {e.type === 'delivery' && e.address && (
            <div>
              <dt>Delivery to</dt>
              <dd>{e.address}</dd>
            </div>
          )}
          {!!e.people && (
            <div>
              <dt>People</dt>
              <dd>{e.people}</dd>
            </div>
          )}
        </dl>
      )}
      <div>
        <h3 className="c-sum-h">Items</h3>
        <ul className="e-priced" data-testid="estimate-items">
          {(e.lines ?? []).map((l, i) => {
            const q = qtyText(l);
            return (
              <li key={i}>
                <span className="e-priced-name">
                  {q && <b className="c-qty-text">{q}</b>}
                  {q && ' '}
                  {l.name}
                  {l.note.trim() && <span className="c-item-note"> · {l.note.trim()}</span>}
                </span>
                <span className="e-priced-amt">{l.extra ? 'Included' : amountLabel(l.price ?? 0)}</span>
              </li>
            );
          })}
        </ul>
        <TotalsBlock t={t} taxPercent={e.taxPercent} />
      </div>
      {e.notes?.trim() && (
        <div>
          <h3 className="c-sum-h">Notes</h3>
          <p className="c-sum-notes">{e.notes}</p>
        </div>
      )}
      {error && (
        <p className="c-err" role="alert">
          {error}
        </p>
      )}
      {ordered ? (
        e.orderId && (
          <button type="button" className="t-btn primary block" onClick={() => onOpenOrder(e.orderId!)}>
            Open the order
          </button>
        )
      ) : (
        <>
          <a className="t-btn primary block c-share" href={customerWhatsappHref(e.phone, text)} target="_blank" rel="noopener noreferrer" data-testid="send-estimate">
            Send to customer on WhatsApp
          </a>
          <button type="button" className="t-btn accent block" onClick={() => onMakeOrder(e)} data-testid="make-order">
            Customer confirmed: make order
          </button>
          <div className="t-grid2">
            <button type="button" className="t-btn" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="t-btn danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          </div>
        </>
      )}
      {confirmDelete && (
        <div className="e-confirm" role="alert">
          <p>Delete this estimate? It goes off the list.</p>
          <div className="t-grid2">
            <button type="button" className="t-btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
            <button
              type="button"
              className="t-btn c-danger-solid"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  // Soft delete: hidden everywhere, still in the database.
                  await store.updateDoc('estimates', e.id, { deletedAt: store.now(), updatedAt: store.now() });
                  onClose();
                  onDeleted?.(e);
                }, 'Could not delete. Please try again.')
              }
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}
      <button type="button" className="t-btn ghost block" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function TotalsBlock({ t, taxPercent }: { t: ReturnType<typeof estimateTotals>; taxPercent: number }) {
  const extra = t.discount > 0 || t.deliveryFee > 0 || t.tax > 0;
  return (
    <dl className="e-totals" data-testid="estimate-total">
      {extra && (
        <div>
          <dt>Subtotal</dt>
          <dd>{amountLabel(t.subtotal) || '$0'}</dd>
        </div>
      )}
      {t.discount > 0 && (
        <div>
          <dt>Discount</dt>
          <dd>-{amountLabel(t.discount)}</dd>
        </div>
      )}
      {t.deliveryFee > 0 && (
        <div>
          <dt>Delivery</dt>
          <dd>{amountLabel(t.deliveryFee)}</dd>
        </div>
      )}
      {t.tax > 0 && (
        <div>
          <dt>Tax ({taxPercent}%)</dt>
          <dd>{amountLabel(t.tax)}</dd>
        </div>
      )}
      <div className="e-total">
        <dt>Total</dt>
        <dd>{amountLabel(t.total) || '$0'}</dd>
      </div>
    </dl>
  );
}

// ---------- the form ----------

function EstimateFormView({ estimate, dirty, onSaved, onCancel }: { estimate: Estimate | null; dirty: { current: boolean }; onSaved: (id: string) => void; onCancel?: () => void }) {
  const requestClose = useSheetClose();
  const front = useAppMode() === 'front';
  const menu = useDoc('toastMenu', 'current');
  const dishes = menuDishes(menu);
  const saved = useSingleton('cateringPrices');
  const list = priceList(saved);
  const [start] = useState<EstimateForm>(() => (estimate ? formFromEstimate(estimate) : emptyEstimateForm(lastUnit())));
  const [f, setF] = useState<EstimateForm>(start);
  const [errors, setErrors] = useState<EstimateErrors>({});
  const [tried, setTried] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const { busy, error, run } = useBusy();
  const [scanFrom, setScanFrom] = useState<ScanFrom | null>(null);
  const [unsure, setUnsure] = useState<(keyof EstimateForm)[]>([]);
  const [pendingPaste, setPendingPaste] = useState(false);
  dirty.current = JSON.stringify(f) !== JSON.stringify(start) || scanFrom !== null || pendingPaste;

  useEffect(() => {
    if (!attempt) return;
    const first = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    first?.focus({ preventScroll: true });
  }, [attempt]);

  const set = <K extends keyof EstimateForm>(k: K, v: EstimateForm[K]) => {
    setF((prev) => {
      const next = { ...prev, [k]: v };
      if (tried) setErrors(validateEstimate(next, list));
      return next;
    });
    setUnsure((u) => u.filter((x) => x !== k));
  };
  const filledFrom = (got: ScannedOrder, from: ScanFrom) => {
    const filled = estimateFormFromScan(got, f, dishes);
    setF(filled.form);
    setUnsure(filled.unsure);
    if (tried) setErrors(validateEstimate(filled.form, list));
    setScanFrom(from);
  };
  const setPrice = (i: number, price: string) => set('lines', f.lines.map((d, j) => (j === i ? { ...d, price } : d)));

  const save = () => {
    const e = validateEstimate(f, list);
    setTried(true);
    setErrors(e);
    if (Object.keys(e).length) return setAttempt((n) => n + 1);
    run(async () => {
      const now = store.now();
      const fields = estimateFields(f, list);
      if (estimate) {
        await store.updateDoc('estimates', estimate.id, { ...fields, updatedAt: now });
        return onSaved(estimate.id);
      }
      // A new estimate then opens on its summary, where it can be sent.
      dirty.current = false;
      onSaved(await store.addDoc('estimates', { ...fields, status: 'open', orderId: null, createdAt: now, updatedAt: now }));
    });
  };

  const err = (k: keyof EstimateForm) =>
    errors[k] ? (
      <small className="c-err" role="alert">{errors[k]}</small>
    ) : (
      unsure.includes(k) && <small className="c-check">Please check this: it was {scanFrom === 'message' ? 'unclear' : 'hard to read'}.</small>
    );
  const t = formTotals(f, list);
  const priced = f.lines.map((d, i) => ({ d, i })).filter(({ d }) => d.name.trim());
  const count = Object.keys(errors).length;

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
      {!estimate && <ScanPaste onFilled={filledFrom} saveLabel="Save estimate" onPending={setPendingPaste} />}
      <Field label="Customer name">
        <input className="t-input" maxLength={NAME_MAX} value={f.customerName} onChange={(e) => set('customerName', e.target.value)} aria-invalid={!!errors.customerName} autoComplete="off" />
        {err('customerName')}
      </Field>
      <Field label="Phone (to send the estimate)">
        <input className="t-input" type="tel" inputMode="tel" maxLength={30} value={f.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={!!errors.phone} autoComplete="off" />
        {err('phone')}
      </Field>
      <div className="t-grid2">
        <Field label="Date (if known)">
          <input className="t-input" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} aria-invalid={!!errors.date} />
          {err('date')}
        </Field>
        <Field label="Time (if known)">
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
        <Field label="Delivery address (optional)">
          <input className="t-input" value={f.address} onChange={(e) => set('address', e.target.value)} autoComplete="off" />
          {err('address')}
        </Field>
      )}
      <Field label="Number of people (optional)">
        <input className="t-input c-people" inputMode="numeric" value={f.people} onChange={(e) => set('people', e.target.value)} aria-invalid={!!errors.people} />
        {err('people')}
      </Field>
      <div className="t-field">
        <span>Items</span>
        <ItemsEditor lines={f.lines} dishes={dishes} onChange={(lines) => set('lines', lines as PricedDraft[])} invalid={!!errors.lines} />
      </div>

      <div className="t-field" data-testid="estimate-prices">
        <span>Prices</span>
        {priced.length === 0 ? (
          <p className="c-hint">Add items above to see their prices.</p>
        ) : (
          <ul className="e-prices e-form-prices">
            {priced.map(({ d, i }) => {
              const p = draftPrice(d, list);
              const qn = parseQty(d.qty);
              const q = qtyText({ qty: qn === null || Number.isNaN(qn) ? null : qn, unit: d.unit });
              const label = `${d.name.trim()}${q ? `, ${q}` : ''}`;
              return (
                <li key={i} className="e-price-row" data-testid="price-row">
                  <span className="e-price-name">
                    {label}
                    <small>
                      {d.extra
                        ? 'Comes with the order'
                        : p.typed
                          ? p.fromList !== null
                            ? `Changed by hand (list: ${amountLabel(p.fromList)})`
                            : 'Typed by hand'
                          : p.fromList !== null
                            ? 'From the price list'
                            : 'Not on the price list: type the price'}
                    </small>
                  </span>
                  {d.extra ? (
                    <span className="e-price-free">Included</span>
                  ) : (
                    <span className="e-price-box">
                      <span aria-hidden="true">$</span>
                      <input
                        className="t-input"
                        inputMode="decimal"
                        aria-label={`Price of ${d.name.trim()}`}
                        placeholder={p.fromList !== null ? String(p.fromList) : 'Price'}
                        value={d.price ?? ''}
                        aria-invalid={!!errors.lines && p.price === null}
                        onChange={(e) => setPrice(i, e.target.value)}
                        autoComplete="off"
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {err('lines')}
        {!front && (
          <small className="c-hint">
            Half tray is half the full-tray price. <Link to="/manager/more/prices">Change the price list</Link>
          </small>
        )}
      </div>

      <div className="t-grid2">
        <Field label="Discount $ (optional)">
          <input className="t-input" inputMode="decimal" placeholder="0" value={f.discount} onChange={(e) => set('discount', e.target.value)} aria-invalid={!!errors.discount} autoComplete="off" />
          {err('discount')}
        </Field>
        {f.type === 'delivery' && (
          <Field label="Delivery fee $ (optional)">
            <input className="t-input" inputMode="decimal" placeholder="0" value={f.deliveryFee} onChange={(e) => set('deliveryFee', e.target.value)} aria-invalid={!!errors.deliveryFee} autoComplete="off" />
            {err('deliveryFee')}
          </Field>
        )}
      </div>
      <Field label="Notes for the customer (optional)">
        <textarea className="t-textarea c-notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        {err('notes')}
      </Field>

      <TotalsBlock t={t} taxPercent={list.taxPercent} />

      <div className="c-form-foot">
        {count > 0 && <p className="c-err c-err-summary">Please fix the {count === 1 ? 'field' : `${count} fields`} marked above.</p>}
        {error && (
          <p className="c-err c-err-summary" role="alert">
            {error}
          </p>
        )}
        <button className="t-btn primary block" type="submit" disabled={busy}>
          {busy ? 'Saving…' : estimate ? 'Save changes' : 'Save estimate'}
        </button>
      </div>
      <button type="button" className="t-btn ghost block" onClick={onCancel ?? requestClose}>
        Cancel
      </button>
      <p className="c-hint e-valid">The customer's message says prices hold for {VALID_DAYS} days.</p>
    </form>
  );
}
