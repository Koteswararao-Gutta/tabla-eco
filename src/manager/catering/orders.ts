// Pure helpers for catering orders, shared by the manager Catering tab and the kitchen tablet.
// No React, no store: everything takes `now` so it is easy to test.
import type { CateringOrder, ScannedOrder } from '@shared/data';

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
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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

/** Open and due within two hours (or already late). */
export const isSoon = (o: Order, now: number) => o.status === 'open' && o.dueAt - now <= SOON_MS;

export const itemLines = (items: string) =>
  items.split('\n').map((l) => l.trim()).filter(Boolean);

// ---------- form ----------

export interface OrderForm {
  customerName: string;
  phone: string;
  date: string; // yyyy-mm-dd
  time: string; // hh:mm
  type: 'pickup' | 'delivery';
  address: string;
  people: string;
  items: string;
  notes: string;
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

export function emptyForm(now: number): OrderForm {
  return { customerName: '', phone: '', date: toDateInput(now), time: '', type: 'pickup', address: '', people: '', items: '', notes: '' };
}

export function formFromOrder(o: Order): OrderForm {
  return {
    customerName: o.customerName,
    phone: o.phone,
    date: toDateInput(o.dueAt),
    time: toTimeInput(o.dueAt),
    type: o.type,
    address: o.address ?? '',
    people: o.people ? String(o.people) : '',
    items: o.items,
    notes: o.notes ?? '',
  };
}

export function validate(f: OrderForm): FormErrors {
  const e: FormErrors = {};
  if (!f.customerName.trim()) e.customerName = "Please enter the customer's name.";
  const digits = f.phone.replace(/\D/g, '');
  if (!f.phone.trim()) e.phone = 'Please enter a phone number.';
  else if (digits.length < 7) e.phone = 'This phone number looks too short.';
  if (!f.date) e.date = 'Please pick a date.';
  if (!f.time) e.time = 'Please pick a time.';
  else if (f.date && fromInputs(f.date, f.time) === null) e.time = 'Please check the date and time.';
  if (f.type === 'delivery' && !f.address.trim()) e.address = 'Please enter the delivery address.';
  if (f.people.trim() && !/^\d+$/.test(f.people.trim())) e.people = 'Please enter a whole number.';
  else if (f.people.trim() && +f.people === 0) e.people = 'Please enter at least 1, or leave it empty.';
  if (itemLines(f.items).length === 0) e.items = 'Please add at least one item.';
  return e;
}

/** The order fields from a valid form. Never contains undefined: optional fields are left out. */
export function orderFields(f: OrderForm): Pick<Order, 'customerName' | 'phone' | 'dueAt' | 'type' | 'items' | 'people'> & Partial<Pick<Order, 'address' | 'notes'>> {
  const out: ReturnType<typeof orderFields> = {
    customerName: f.customerName.trim(),
    phone: f.phone.trim(),
    dueAt: fromInputs(f.date, f.time)!,
    type: f.type,
    items: itemLines(f.items).join('\n'),
    people: f.people.trim() ? parseInt(f.people, 10) : null,
  };
  if (f.type === 'delivery') out.address = f.address.trim();
  if (f.notes.trim()) out.notes = f.notes.trim();
  return out;
}

// ---------- scanned paper orders ----------

const FORM_KEYS: (keyof OrderForm)[] = ['customerName', 'phone', 'date', 'time', 'type', 'address', 'people', 'items', 'notes'];

/** Fills the form from what the AI read. Anything missing or malformed keeps the form's current value,
 *  and is listed in `unsure` along with the fields the AI flagged, so the sheet can ask to check them. */
export function formFromScan(s: ScannedOrder, base: OrderForm): { form: OrderForm; unsure: (keyof OrderForm)[] } {
  const unsure = new Set(FORM_KEYS.filter((k) => s.unsure?.includes(k)));
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text(s.date)) && fromInputs(text(s.date), '12:00') !== null ? text(s.date) : '';
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(text(s.time)) ? text(s.time) : '';
  const people = text(s.people).replace(/\D/g, '');
  const address = text(s.address);
  const type = s.type === 'pickup' || s.type === 'delivery' ? s.type : address ? 'delivery' : base.type;
  const items = (Array.isArray(s.items) ? s.items : []).map(text).filter(Boolean).join('\n');
  const form: OrderForm = {
    customerName: text(s.customerName) || base.customerName,
    phone: text(s.phone) || base.phone,
    date: date || base.date,
    time: time || base.time,
    type,
    address: address || base.address,
    people: people && +people > 0 ? people : base.people,
    items: items || base.items,
    notes: text(s.notes) || base.notes,
  };
  if (!date) unsure.add('date');
  if (s.type !== 'pickup' && s.type !== 'delivery') unsure.add('type');
  return { form, unsure: FORM_KEYS.filter((k) => unsure.has(k)) };
}
