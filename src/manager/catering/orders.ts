// Pure helpers for catering orders, shared by the manager Catering tab and the kitchen tablet.
// No React, no store: everything takes `now` so it is easy to test.
import type { CateringOrder, EditedBy, OrderEdit, OrderLine, ScannedOrder } from '@shared/data';
import { cleanLine, findDish, itemLines, linesText, normalizeUnit, orderLines, qtyValue, type Dish } from './lines';

export { itemLines };

type Order = CateringOrder;

const MIN = 60_000;
export const SOON_MS = 2 * 60 * MIN;

/** Local midnight at the start of the day that contains `ms`, moved by `addDays` days. */
export function dayStart(ms: number, addDays = 0): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + addDays);
  return d.getTime();
}

export const byDueAsc = (a: Order, b: Order) => a.dueAt - b.dueAt;
export const byDueDesc = (a: Order, b: Order) => b.dueAt - a.dueAt;

export interface OpenGroups<T extends Order> {
  /** Open orders from an earlier day that were never marked completed. */
  overdue: T[];
  today: T[];
  tomorrow: T[];
  later: T[];
}

/** Open orders by day, soonest first. */
export function groupOpen<T extends Order>(orders: T[], now: number): OpenGroups<T> {
  const today = dayStart(now);
  const tomorrow = dayStart(now, 1);
  const after = dayStart(now, 2);
  const g: OpenGroups<T> = { overdue: [], today: [], tomorrow: [], later: [] };
  for (const o of orders.filter((o) => o.status === 'open').sort(byDueAsc)) {
    if (o.dueAt < today) g.overdue.push(o);
    else if (o.dueAt < tomorrow) g.today.push(o);
    else if (o.dueAt < after) g.tomorrow.push(o);
    else g.later.push(o);
  }
  return g;
}

/** Completed orders, newest due first. */
export function history<T extends Order>(orders: T[]): T[] {
  return orders.filter((o) => o.status === 'completed').sort(byDueDesc);
}

/** Every order grouped by its due day, newest day (and newest order) first. */
export function groupByDay<T extends Order>(orders: T[], now: number): { label: string; orders: T[] }[] {
  const groups: { day: number; label: string; orders: T[] }[] = [];
  for (const o of [...orders].sort(byDueDesc)) {
    const day = dayStart(o.dueAt);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) groups.push((g = { day, label: dayLabel(o.dueAt, now), orders: [] }));
    g.orders.push(o);
  }
  return groups.map(({ label, orders }) => ({ label, orders }));
}

/** For the kitchen: today and the days ahead first (soonest day first), then past days (most recent
 *  first). Inside each day, orders by time, earliest first. */
export function groupByDayUpcomingFirst<T extends Order>(orders: T[], now: number): { label: string; orders: T[] }[] {
  const today = dayStart(now);
  const days = new Map<number, T[]>();
  for (const o of [...orders].sort(byDueAsc)) {
    const day = dayStart(o.dueAt);
    days.set(day, [...(days.get(day) ?? []), o]);
  }
  const keys = [...days.keys()];
  const order = [...keys.filter((d) => d >= today).sort((a, b) => a - b), ...keys.filter((d) => d < today).sort((a, b) => b - a)];
  return order.map((d) => ({ label: dayLabel(d, now), orders: days.get(d)! }));
}

/** "Today", "Tomorrow", "Yesterday" or "Fri, Nov 20". */
export function dayLabel(ms: number, now: number): string {
  const diff = Math.round((dayStart(ms) - dayStart(now)) / (24 * 60 * MIN));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  // Another year shows its year, so an order typed with the wrong year stands out.
  const otherYear = new Date(ms).getFullYear() !== new Date(now).getFullYear();
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(otherYear ? { year: 'numeric' } : {}) });
}

/** "5:30 PM" */
export function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "2 h 15 min", "45 min", "3 days" */
export function duration(ms: number): string {
  const m = Math.round(Math.abs(ms) / MIN);
  if (m >= 48 * 60) return `${Math.floor(m / (24 * 60))} days`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** "in 2 h 15 min", "45 min late", "due now". */
export function countdown(dueAt: number, now: number): { text: string; late: boolean } {
  const diff = dueAt - now;
  if (Math.abs(diff) < MIN) return { text: 'due now', late: false };
  return diff > 0 ? { text: `in ${duration(diff)}`, late: false } : { text: `${duration(diff)} late`, late: true };
}

/** The countdown shows only in the last hour before an order, and once its time has passed (in red).
 *  Before that, the time and day are enough. */
export const COUNTDOWN_MS = 60 * MIN;
export const showsCountdown = (dueAt: number, now: number) => dueAt - now <= COUNTDOWN_MS;

/** Open and due within two hours (or already late). */
export const isSoon = (o: Order, now: number) => o.status === 'open' && o.dueAt - now <= SOON_MS;

// ---------- month calendar ----------

/** The weeks shown for a month, Sunday first: each day is local midnight (ms), or null outside the month. */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(first.getDay()).fill(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d).getTime());
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Orders by their day (local midnight), each day's orders earliest first. */
export function ordersByDay<T extends Order>(orders: T[]): Map<number, T[]> {
  const days = new Map<number, T[]>();
  for (const o of [...orders].sort(byDueAsc)) {
    const d = dayStart(o.dueAt);
    days.set(d, [...(days.get(d) ?? []), o]);
  }
  return days;
}

/** Orders within this long of each other count as a clash: the kitchen would be making both at once. */
export const CLASH_MS = 60 * MIN;

/** Other open orders on the same day as `dueAt`, earliest first, with the ones within an hour marked. */
export function sameDayOrders<T extends Order & { id?: string }>(orders: T[], dueAt: number, skipId?: string): { order: T; close: boolean }[] {
  const day = dayStart(dueAt);
  return orders
    .filter((o) => o.status === 'open' && o.id !== skipId && dayStart(o.dueAt) === day)
    .sort(byDueAsc)
    .map((order) => ({ order, close: Math.abs(order.dueAt - dueAt) < CLASH_MS }));
}

// ---------- form ----------

export interface OrderForm {
  customerName: string;
  phone: string;
  date: string; // yyyy-mm-dd
  time: string; // hh:mm
  type: 'pickup' | 'delivery';
  address: string;
  people: string;
  /** The order's items as typed in the form. */
  lines: LineDraft[];
  notes: string;
}

/** One item row of the form: as OrderLine, but the quantity is the text in its box. */
export interface LineDraft {
  dishId: string | null;
  name: string;
  qty: string;
  unit: string;
  note: string;
  /** Kept from the saved line while the row is untouched (any change drops it): see OrderLine.text. */
  text?: string;
  /** Read by a guess and not checked yet: the row asks to be checked. */
  check?: boolean;
}

export const blankLine = (unit = ''): LineDraft => ({ dishId: null, name: '', qty: '', unit, note: '' });

const qtyInput = (q: number | null) => (q === null || !Number.isFinite(q) ? '' : String(Math.round(q * 100) / 100));

export function draftFromLine(l: OrderLine): LineDraft {
  const d: LineDraft = { dishId: l.dishId ?? null, name: l.name, qty: qtyInput(l.qty), unit: l.unit, note: l.note };
  if (l.text) d.text = l.text;
  if (l.check) d.check = true;
  return d;
}

/** A filled row: it has a dish name. Empty rows are left out when saving. */
const filled = (d: LineDraft) => d.name.trim() !== '';

/** A quantity box's text as a number: null when empty, NaN when it isn't a positive number. */
export function parseQty(text: string): number | null {
  if (!text.trim()) return null;
  const n = qtyValue(text);
  if (Number.isNaN(n)) return NaN;
  return n > 0 && n <= 100_000 ? Math.round(n * 100) / 100 : NaN;
}

/** The order's lines from the form's rows: empty rows dropped, checks cleared (whoever saves has seen the form). */
export function linesFromForm(drafts: LineDraft[]): OrderLine[] {
  return drafts.filter(filled).map((d) => {
    const qty = parseQty(d.qty);
    const line: OrderLine = { dishId: d.dishId, name: d.name.trim(), qty: qty === null || Number.isNaN(qty) ? null : qty, unit: d.unit, note: d.note };
    if (d.text) line.text = d.text;
    return cleanLine(line);
  });
}

export type FormErrors = Partial<Record<keyof OrderForm, string>>;

const pad = (n: number) => String(n).padStart(2, '0');
export function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function toTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Local date + time inputs to ms, or null if either is missing or invalid. */
export function fromInputs(date: string, time: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})/.exec(time);
  if (!dm || !tm) return null;
  const d = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0, 0);
  return isNaN(d.getTime()) ? null : d.getTime();
}

export function emptyForm(now: number, day?: number): OrderForm {
  return { customerName: '', phone: '', date: toDateInput(day ?? now), time: '', type: 'pickup', address: '', people: '', lines: [blankLine()], notes: '' };
}

export function formFromOrder(o: Order, dishes: Dish[] = []): OrderForm {
  const lines = orderLines(o, dishes).map(draftFromLine);
  return {
    customerName: o.customerName,
    phone: o.phone,
    date: toDateInput(o.dueAt),
    time: toTimeInput(o.dueAt),
    type: o.type,
    address: o.address ?? '',
    people: o.people ? String(o.people) : '',
    lines: lines.length ? lines : [blankLine()],
    notes: o.notes ?? '',
  };
}

/** Longest customer name (the name box allows this many; a scan or paste could fill more). */
export const NAME_MAX = 200;

export function validate(f: OrderForm): FormErrors {
  const e: FormErrors = {};
  if (!f.customerName.trim()) e.customerName = "Please enter the customer's name.";
  else if (f.customerName.trim().length > NAME_MAX) e.customerName = `Please shorten the name to ${NAME_MAX} letters or fewer.`;
  const digits = f.phone.replace(/\D/g, '');
  if (!f.phone.trim()) e.phone = 'Please enter a phone number.';
  else if (digits.length < 7) e.phone = 'This phone number looks too short.';
  if (!f.date) e.date = 'Please pick a date.';
  if (!f.time) e.time = 'Please pick a time.';
  else if (f.date && fromInputs(f.date, f.time) === null) e.time = 'Please check the date and time.';
  if (f.type === 'delivery' && !f.address.trim()) e.address = 'Please enter the delivery address.';
  if (f.people.trim() && !/^\d+$/.test(f.people.trim())) e.people = 'Please enter a whole number.';
  else if (f.people.trim() && +f.people === 0) e.people = 'Please enter at least 1, or leave it empty.';
  const rows = f.lines.filter(filled);
  const badQty = f.lines.findIndex((d) => Number.isNaN(parseQty(d.qty)));
  const noName = f.lines.findIndex((d) => !filled(d) && (d.qty.trim() || d.note.trim()));
  if (rows.length === 0) e.lines = 'Please add at least one item.';
  else if (badQty >= 0) e.lines = `Please check the quantity of item ${badQty + 1}: enter a number like 2 or 1.5.`;
  else if (noName >= 0) e.lines = `Item ${noName + 1} has no dish. Please add the dish, or remove the row.`;
  return e;
}

/** The order fields from a valid form. Never contains undefined: optional fields are left out. */
export function orderFields(f: OrderForm): Pick<Order, 'customerName' | 'phone' | 'dueAt' | 'type' | 'items' | 'people'> & { lines: OrderLine[] } & Partial<Pick<Order, 'address' | 'notes'>> {
  const lines = linesFromForm(f.lines);
  const out: ReturnType<typeof orderFields> = {
    customerName: f.customerName.trim(),
    phone: f.phone.trim(),
    dueAt: fromInputs(f.date, f.time)!,
    type: f.type,
    items: linesText(lines),
    lines,
    people: f.people.trim() ? parseInt(f.people, 10) : null,
  };
  if (f.type === 'delivery') out.address = f.address.trim();
  if (f.notes.trim()) out.notes = f.notes.trim();
  return out;
}

// ---------- scanned paper orders ----------

const FORM_KEYS: (keyof OrderForm)[] = ['customerName', 'phone', 'date', 'time', 'type', 'address', 'people', 'lines', 'notes'];

/** The item rows from what the AI read: menu dishes matched by name, units made standard. A row is marked
 *  to check when the AI was unsure, the dish isn't on the menu, or there's no quantity. */
export function draftsFromScan(s: Pick<ScannedOrder, 'items' | 'lines'>, dishes: Dish[]): LineDraft[] {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (Array.isArray(s.lines) && s.lines.length) {
    return s.lines
      .filter((l) => l && text(l.dish))
      .map((l) => {
        const dish = findDish(text(l.dish), dishes);
        const qty = parseQty(text(l.qty).replace(/[^\d.,/\s½¼¾-]/g, ''));
        const unit = normalizeUnit(text(l.unit));
        const d: LineDraft = { dishId: dish?.id ?? null, name: dish?.name ?? text(l.dish), qty: qty === null || Number.isNaN(qty) ? '' : String(qty), unit: unit.unit, note: text(l.note) };
        if (l.unsure === true || !dish || !d.qty || !unit.sure) d.check = true;
        return d;
      });
  }
  // An older server sends each item as text.
  const items = (Array.isArray(s.items) ? s.items : []).map(text).filter(Boolean);
  // Read as new rows, not kept as typed: the text is dropped.
  return orderLines({ items: items.join('\n') }, dishes).map(({ text: _typed, ...l }) => draftFromLine(l));
}

/** Fills the form from what the AI read. Anything missing or malformed keeps the form's current value,
 *  and is listed in `unsure` along with the fields the AI flagged, so the sheet can ask to check them. */
export function formFromScan(s: ScannedOrder, base: OrderForm, dishes: Dish[] = []): { form: OrderForm; unsure: (keyof OrderForm)[] } {
  const unsure = new Set(FORM_KEYS.filter((k) => (s.unsure as string[] | undefined)?.includes(k === 'lines' ? 'items' : k)));
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text(s.date)) && fromInputs(text(s.date), '12:00') !== null ? text(s.date) : '';
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(text(s.time)) ? text(s.time) : '';
  const people = text(s.people).replace(/\D/g, '');
  const address = text(s.address);
  const type = s.type === 'pickup' || s.type === 'delivery' ? s.type : address ? 'delivery' : base.type;
  const lines = draftsFromScan(s, dishes);
  const form: OrderForm = {
    customerName: text(s.customerName) || base.customerName,
    phone: text(s.phone) || base.phone,
    date: date || base.date,
    time: time || base.time,
    type,
    address: address || base.address,
    people: people && +people > 0 ? people : base.people,
    lines: lines.length ? lines : base.lines,
    notes: text(s.notes) || base.notes,
  };
  if (!date) unsure.add('date');
  if (s.type !== 'pickup' && s.type !== 'delivery') unsure.add('type');
  return { form, unsure: FORM_KEYS.filter((k) => unsure.has(k)) };
}

/** A tel: link for a typed phone number ("555 123-4567" -> "tel:5551234567"). An extension
 *  ("ext 2", "x2", "#2", "extension 2") is left off, so the call reaches the main number. */
export function telHref(phone: string): string {
  const main = phone.split(/ext|x|#/i)[0]; // "extension" starts with "ext"
  const plus = main.trim().startsWith('+') ? '+' : '';
  return 'tel:' + plus + main.replace(/\D/g, '');
}

// ---------- share to WhatsApp ----------

/** The order as a WhatsApp message for the front staff group, so they can get sides ready.
 *  The date is written out ("Fri, Nov 20"), since the message is read later. The customer's
 *  phone is left out: the staff group doesn't need it. `*bold*` is WhatsApp's own formatting. */
export function shareText(o: Pick<Order, 'customerName' | 'dueAt' | 'type' | 'address' | 'people' | 'items' | 'notes'>, heading = 'Catering order'): string {
  const date = new Date(o.dueAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const lines = [`*${heading}*`, `${o.customerName}`, `${date}, ${timeLabel(o.dueAt)}`];
  lines.push(o.type === 'delivery' ? `Delivery${o.address?.trim() ? `: ${o.address.trim()}` : ''}` : 'Pickup');
  if (o.people) lines.push(`${o.people} people`);
  lines.push('', '*Items*', ...itemLines(o.items).map((l) => `• ${l}`));
  if (o.notes?.trim()) lines.push('', `*Notes:* ${o.notes.trim()}`);
  return lines.join('\n');
}

/** Opens WhatsApp with the message typed in; the person picks the group and taps send. */
export const whatsappHref = (text: string) => 'https://wa.me/?text=' + encodeURIComponent(text);

// ---------- edit history ----------

/** How each device shows in the history. */
export const EDITED_BY_LABEL: Record<EditedBy, string> = { kitchen: 'Kitchen', manager: 'Manager' };
/** The order keeps only its latest edits, so the document stays small. */
export const HISTORY_MAX = 50;
const SHOWN_MAX = 80;
const shown = (v: string) => {
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return '(none)';
  return t.length > SHOWN_MAX ? `${t.slice(0, SHOWN_MAX - 1)}…` : t;
};
const fullDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const typeWord = (t: Order['type']) => (t === 'delivery' ? 'Delivery' : 'Pickup');

/** Lines in `a` that are not in `b`, counting repeats. */
function missing(a: string[], b: string[]): string[] {
  const left = [...b];
  return a.filter((l) => {
    const i = left.indexOf(l);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
}

type EditFields = Pick<Order, 'customerName' | 'phone' | 'dueAt' | 'type' | 'items'> & Partial<Pick<Order, 'address' | 'notes' | 'people'>>;

/** What an edit changes, in plain words, e.g. ["Time: 5:00 PM → 6:00 PM", "Items: 20 samosas → 25 samosas"]. Empty when nothing changed. */
export function describeChanges(before: EditFields, after: EditFields): string[] {
  const out: string[] = [];
  if (before.customerName.trim() !== after.customerName.trim()) out.push(`Name: ${shown(before.customerName)} → ${shown(after.customerName)}`);
  if (before.phone.trim() !== after.phone.trim()) out.push(`Phone: ${shown(before.phone)} → ${shown(after.phone)}`);
  if (dayStart(before.dueAt) !== dayStart(after.dueAt)) out.push(`Date: ${fullDate(before.dueAt)} → ${fullDate(after.dueAt)}`);
  if (timeLabel(before.dueAt) !== timeLabel(after.dueAt)) out.push(`Time: ${timeLabel(before.dueAt)} → ${timeLabel(after.dueAt)}`);
  if (before.type !== after.type) out.push(`${typeWord(before.type)} → ${typeWord(after.type)}`);
  if (after.type === 'delivery' && (before.address ?? '').trim() !== (after.address ?? '').trim()) out.push(`Address: ${shown(before.address ?? '')} → ${shown(after.address ?? '')}`);
  if ((before.people || null) !== (after.people || null)) out.push(`People: ${before.people || '(none)'} → ${after.people || '(none)'}`);
  // Items: a changed line reads "old → new"; extra lines read as added or removed.
  const was = itemLines(before.items);
  const now = itemLines(after.items);
  const removed = missing(was, now);
  const added = missing(now, was);
  const paired = Math.min(removed.length, added.length);
  for (let i = 0; i < paired; i++) out.push(`Items: ${shown(removed[i])} → ${shown(added[i])}`);
  for (const l of added.slice(paired)) out.push(`Item added: ${shown(l)}`);
  for (const l of removed.slice(paired)) out.push(`Item removed: ${shown(l)}`);
  if ((before.notes ?? '').trim() !== (after.notes ?? '').trim()) out.push(`Notes: ${shown(before.notes ?? '')} → ${shown(after.notes ?? '')}`);
  return out;
}

/** The order's history with one more edit at the end, keeping the latest HISTORY_MAX. */
export function withEdit(history: OrderEdit[] | undefined, edit: OrderEdit): OrderEdit[] {
  return [...(Array.isArray(history) ? history : []), edit].slice(-HISTORY_MAX);
}

/** The latest edit, or null. */
export const lastEdit = (o: Pick<Order, 'history'>): OrderEdit | null => (Array.isArray(o.history) && o.history.length ? o.history[o.history.length - 1] : null);

// ---------- amount (manager only) ----------
// The amount lives in orderAmounts/{order id}, never on the order, so the kitchen never sees it.
// Keep it out of OrderForm, shareText, describeChanges and the tags: they all reach the kitchen or front staff.

/** Biggest amount the box takes (matches firestore.rules). */
export const AMOUNT_MAX = 1_000_000;

/** What was typed in the amount box ("200", "$1,250.50") as dollars; null when empty; NaN when it isn't an amount. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[\s$,]/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(t)) return NaN;
  const n = Math.round(parseFloat(t) * 100) / 100;
  return n > AMOUNT_MAX ? NaN : n;
}

/** An error for the amount box, or ''. */
export function amountError(text: string): string {
  return Number.isNaN(parseAmount(text)) ? 'Please enter an amount like 200 or 200.50, or leave it empty.' : '';
}

/** The amount as the box shows it when editing: 200 -> "200", 200.5 -> "200.50". */
export function amountInput(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '';
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** "$200", "$1,250.50"; '' when there is no amount. */
export function amountLabel(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '';
  const cents = !Number.isInteger(amount);
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}
