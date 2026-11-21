// Catering estimates (price quotes): the form, its checks, the saved shape and the customer's WhatsApp
// message. Pure helpers: no React, no store.
import type { CateringEstimate, CateringPrices, EstimateLine } from '@shared/data';
import { qtyText } from './lines';
import {
  amountError, amountInput, amountLabel, blankLine, draftFromLine, fromInputs, linesFromForm, NAME_MAX, parseAmount, parseQty, timeLabel, toDateInput, toTimeInput,
  type LineDraft, type OrderForm,
} from './orders';
import { listPrice, totals, type Totals } from './prices';

/** An item row of the estimate form: an order row plus the price box's text ('' or missing = from the list). */
export type PricedDraft = LineDraft & { price?: string };

export interface EstimateForm extends Omit<OrderForm, 'lines'> {
  lines: PricedDraft[];
  discount: string;
  deliveryFee: string;
}

export type EstimateErrors = Partial<Record<keyof EstimateForm, string>>;

/** How long a shared estimate's prices hold. */
export const VALID_DAYS = 7;

const filled = (d: LineDraft) => d.name.trim() !== '';

/** An estimate with a date but no time is saved at noon. */
const NO_TIME = '12:00';

export function emptyEstimateForm(unit = ''): EstimateForm {
  return { customerName: '', phone: '', date: '', time: '', type: 'pickup', address: '', people: '', lines: [blankLine(unit)], notes: '', discount: '', deliveryFee: '' };
}

export function formFromEstimate(e: CateringEstimate): EstimateForm {
  const lines: PricedDraft[] = (Array.isArray(e.lines) ? e.lines : []).map((l) => {
    const d: PricedDraft = draftFromLine(l);
    if (l.priceSet && typeof l.price === 'number') d.price = amountInput(l.price);
    return d;
  });
  return {
    customerName: e.customerName ?? '',
    phone: e.phone ?? '',
    date: typeof e.dueAt === 'number' ? toDateInput(e.dueAt) : '',
    // Saved without a time, an estimate's date is kept at noon (see estimateFields): noon shows as no time.
    time: typeof e.dueAt === 'number' && toTimeInput(e.dueAt) !== NO_TIME ? toTimeInput(e.dueAt) : '',
    type: e.type === 'delivery' ? 'delivery' : 'pickup',
    address: e.address ?? '',
    people: e.people ? String(e.people) : '',
    lines: lines.length ? lines : [blankLine()],
    notes: e.notes ?? '',
    discount: amountInput(e.discount),
    deliveryFee: amountInput(e.deliveryFee),
  };
}

/** A row's price: what was typed in its price box, else the price list's. null when neither gives one. */
export function draftPrice(d: PricedDraft, list: CateringPrices): { price: number | null; typed: boolean; fromList: number | null } {
  const q = parseQty(d.qty);
  const fromList = listPrice({ name: d.name, qty: q === null || Number.isNaN(q) ? null : q, unit: d.unit, extra: d.extra }, list);
  const typed = parseAmount(d.price ?? '');
  if (typed !== null && !Number.isNaN(typed)) return { price: typed, typed: true, fromList };
  return { price: fromList, typed: false, fromList };
}

/** The form's money: each filled row's price, and the totals. */
export function formTotals(f: EstimateForm, list: CateringPrices): Totals {
  const prices = f.lines.filter(filled).map((d) => draftPrice(d, list).price);
  const n = (t: string) => {
    const v = parseAmount(t);
    return v === null || Number.isNaN(v) ? null : v;
  };
  return totals(prices, n(f.discount), f.type === 'delivery' ? n(f.deliveryFee) : null, list.taxPercent);
}

export function validateEstimate(f: EstimateForm, list: CateringPrices): EstimateErrors {
  const e: EstimateErrors = {};
  if (!f.customerName.trim()) e.customerName = "Please enter the customer's name.";
  else if (f.customerName.trim().length > NAME_MAX) e.customerName = `Please shorten the name to ${NAME_MAX} letters or fewer.`;
  if (f.phone.trim() && f.phone.replace(/\D/g, '').length < 7) e.phone = 'This phone number looks too short.';
  if (f.time && !f.date) e.date = 'Please pick a date too, or clear the time.';
  else if (f.date && f.time && fromInputs(f.date, f.time) === null) e.time = 'Please check the date and time.';
  if (f.people.trim() && (!/^\d+$/.test(f.people.trim()) || +f.people === 0)) e.people = 'Please enter a whole number, or leave it empty.';
  const rows = f.lines.filter(filled);
  const badQty = f.lines.findIndex((d) => Number.isNaN(parseQty(d.qty)));
  const noName = f.lines.findIndex((d) => !filled(d) && (d.qty.trim() || d.note.trim()));
  const badPrice = f.lines.findIndex((d) => filled(d) && !!amountError(d.price ?? ''));
  const noPrice = f.lines.findIndex((d) => filled(d) && draftPrice(d, list).price === null);
  if (rows.length === 0) e.lines = 'Please add at least one item.';
  else if (badQty >= 0) e.lines = `Please check the quantity of item ${badQty + 1}: enter a number like 2 or 1.5.`;
  else if (noName >= 0) e.lines = `Item ${noName + 1} has no dish. Please add the dish, or remove the row.`;
  else if (badPrice >= 0) e.lines = `Please check the price of ${f.lines[badPrice].name.trim()}: enter an amount like 80.`;
  else if (noPrice >= 0) e.lines = `Please enter a price for ${f.lines[noPrice].name.trim()}.`;
  if (amountError(f.discount)) e.discount = 'Please enter an amount like 20, or leave it empty.';
  if (f.type === 'delivery' && amountError(f.deliveryFee)) e.deliveryFee = 'Please enter an amount like 25, or leave it empty.';
  return e;
}

/** What to save from a valid form (everything but status, order id and the times). */
export function estimateFields(f: EstimateForm, list: CateringPrices): Omit<CateringEstimate, 'status' | 'orderId' | 'createdAt' | 'updatedAt'> {
  const rows = f.lines.filter(filled);
  const lines: EstimateLine[] = linesFromForm(rows).map((l, i) => {
    const p = draftPrice(rows[i], list);
    return { ...l, price: p.price, ...(p.typed ? { priceSet: true } : {}) };
  });
  const t = formTotals(f, list);
  const delivery = f.type === 'delivery';
  return {
    customerName: f.customerName.trim(),
    phone: f.phone.trim(),
    dueAt: f.date ? fromInputs(f.date, f.time || NO_TIME) : null,
    type: f.type,
    address: delivery ? f.address.trim() : '',
    people: f.people.trim() ? parseInt(f.people, 10) : null,
    lines,
    discount: t.discount > 0 ? t.discount : null,
    deliveryFee: delivery && t.deliveryFee > 0 ? t.deliveryFee : null,
    taxPercent: list.taxPercent,
    total: t.total,
    notes: f.notes.trim(),
  };
}

/** The saved estimate's totals (from its saved line prices). */
export function estimateTotals(e: Pick<CateringEstimate, 'lines' | 'discount' | 'deliveryFee' | 'taxPercent'>): Totals {
  return totals((e.lines ?? []).map((l) => l.price), e.discount, e.deliveryFee, e.taxPercent ?? 0);
}

/** The new-order form filled from an estimate, for "Make order". Date and time come over when the estimate has them. */
export function orderFormFromEstimate(e: CateringEstimate): OrderForm {
  const f = formFromEstimate(e);
  return {
    customerName: f.customerName,
    phone: f.phone,
    date: f.date,
    time: f.time,
    type: f.type,
    address: f.address,
    people: f.people,
    lines: f.lines.map(({ price: _price, ...d }) => d),
    notes: f.notes,
  };
}

// ---------- the customer's message ----------

const plain = (t: string) => t.replace(/[*_~`]/g, '').trim();

/** The estimate as a WhatsApp message to the customer: items with prices, the total, and how long it holds. */
export function estimateText(e: CateringEstimate, restaurant = 'Tabla Indian Restaurant'): string {
  const t = estimateTotals(e);
  const out = [`*${plain(restaurant)}: catering estimate*`, `For ${plain(e.customerName)}`];
  if (typeof e.dueAt === 'number') {
    const date = new Date(e.dueAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = toTimeInput(e.dueAt) === NO_TIME ? '' : `, ${timeLabel(e.dueAt)}`;
    out.push(`${date}${time} · ${e.type === 'delivery' ? 'Delivery' : 'Pickup'}`);
  } else out.push(e.type === 'delivery' ? 'Delivery' : 'Pickup');
  if (e.people) out.push(`${e.people} ${e.people === 1 ? 'person' : 'people'}`);
  out.push('');
  for (const l of e.lines ?? []) {
    const q = qtyText(l);
    const price = l.extra ? 'included' : amountLabel(l.price ?? 0);
    out.push(`• ${plain(l.name)}${q ? `, ${q}` : ''}${l.note.trim() ? ` (${plain(l.note)})` : ''}: ${price}`);
  }
  out.push('');
  const money = t.discount || t.deliveryFee || t.tax;
  if (money) out.push(`Subtotal: ${amountLabel(t.subtotal)}`);
  if (t.discount) out.push(`Discount: -${amountLabel(t.discount)}`);
  if (t.deliveryFee) out.push(`Delivery: ${amountLabel(t.deliveryFee)}`);
  if (t.tax) out.push(`Tax (${e.taxPercent}%): ${amountLabel(t.tax)}`);
  out.push(`*Total: ${amountLabel(t.total) || '$0'}*`);
  if (e.notes.trim()) out.push('', plain(e.notes));
  out.push('', `Prices hold for ${VALID_DAYS} days. Reply to confirm or to change anything.`);
  return out.join('\n');
}

/** Opens WhatsApp to the customer's number with the message typed in (a 10-digit US number gets +1).
 *  With no usable number, WhatsApp asks whom to send it to. */
export function customerWhatsappHref(phone: string, text: string): string {
  let digits = phone.split(/ext|x|#/i)[0].replace(/\D/g, '');
  if (digits.length === 10) digits = '1' + digits;
  const to = digits.length >= 11 ? digits : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
