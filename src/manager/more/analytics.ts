// Analytics (pure): catering money and orders over a week, a month, a year or picked dates.
// Everything is counted by the order's date (when it is due), the same as the order list, Export and the old
// Payments and Statistics pages. Cancelled and deleted orders are never in a total; cancelled ones are listed
// on their own with what was paid on them, so a refund can be handled.
import type { CateringOrder, OrderAmount, PayMethod, WithId } from '@shared/data';
import { dayStart, fromInputs } from '../catering/orders';
import { norm, orderLines } from '../catering/lines';
import { balance, depositTotal, isPaid, methodLabel, paidSoFar, payFrom, type Pay } from '../catering/pay';
import { isCancelled, isDeleted } from '../catering/safety';

// ---------- the range ----------

export type RangeKind = 'week' | 'month' | 'year' | 'dates';

export const RANGE_KINDS: { value: RangeKind; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'dates', label: 'Dates' },
];

/** From the start of `from` up to (not including) `to`: local midnights. */
export interface Range {
  from: number;
  to: number;
}

/** Midnight on the Monday of the week that contains `ms`, moved by `addWeeks`. */
export function weekStart(ms: number, addWeeks = 0): number {
  const d = new Date(dayStart(ms));
  const back = (d.getDay() + 6) % 7; // Sunday 0 → 6 days back, Monday 1 → 0
  return dayStart(d.getTime(), addWeeks * 7 - back);
}

/** The week (Monday to Sunday), month or year that contains `anchor`, moved by `step` of them. */
export function periodOf(kind: Exclude<RangeKind, 'dates'>, anchor: number, step = 0): Range {
  if (kind === 'week') return { from: weekStart(anchor, step), to: weekStart(anchor, step + 1) };
  const d = new Date(anchor);
  if (kind === 'month') return { from: new Date(d.getFullYear(), d.getMonth() + step, 1).getTime(), to: new Date(d.getFullYear(), d.getMonth() + step + 1, 1).getTime() };
  return { from: new Date(d.getFullYear() + step, 0, 1).getTime(), to: new Date(d.getFullYear() + step + 1, 0, 1).getTime() };
}

/** Picked dates ("yyyy-mm-dd", both days included). null while they aren't dates or the end is before the start. */
export function datesRange(from: string, to: string): Range | null {
  const a = fromInputs(from, '12:00');
  const b = fromInputs(to, '12:00');
  if (a === null || b === null || b < a) return null;
  return { from: dayStart(a), to: dayStart(b, 1) };
}

/** Number of days in the range (a day with a clock change still counts as one). */
export const daysIn = (r: Range) => Math.round((r.to - r.from) / (24 * 3600_000));

// ---------- the chart's bars ----------

export interface Bucket {
  from: number;
  to: number;
  /** Under the bar: "M", "16", "Nov". '' when there is no room for every label. */
  label: string;
  /** For the bar's read-out: "Mon, Nov 16", "Week of Nov 16", "November 2026". */
  name: string;
}

/** Bars for the range: a day each up to 31 days, a week each up to 26 weeks, else a month each. */
export function bucketsFor(r: Range): Bucket[] {
  const days = daysIn(r);
  const out: Bucket[] = [];
  const fmt = (ms: number, o: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString('en-US', o);
  if (days <= 31) {
    for (let t = r.from; t < r.to; t = dayStart(t, 1)) {
      const d = new Date(t);
      const label = days <= 7 ? fmt(t, { weekday: 'narrow' }) : d.getDate() === 1 || (d.getDate() - 1) % 7 === 0 ? String(d.getDate()) : '';
      out.push({ from: t, to: dayStart(t, 1), label, name: fmt(t, { weekday: 'short', month: 'short', day: 'numeric' }) });
    }
    return out;
  }
  if (days <= 26 * 7) {
    // Whole weeks, Monday to Sunday; the first and last may be cut by the range.
    for (let t = r.from; t < r.to; ) {
      const end = Math.min(weekStart(t, 1), r.to);
      out.push({ from: t, to: end, label: '', name: 'Week of ' + fmt(t, { month: 'short', day: 'numeric' }) });
      t = end;
    }
    out.forEach((b, i) => (b.label = i % Math.max(1, Math.ceil(out.length / 6)) === 0 ? fmt(b.from, { month: 'short', day: 'numeric' }) : ''));
    return out;
  }
  for (let t = r.from; t < r.to; ) {
    const d = new Date(t);
    const end = Math.min(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(), r.to);
    out.push({ from: t, to: end, label: '', name: fmt(t, { month: 'long', year: 'numeric' }) });
    t = end;
  }
  const every = Math.max(1, Math.ceil(out.length / 12));
  out.forEach((b, i) => (b.label = i % every === 0 ? fmt(b.from, out.length > 12 ? { month: 'short', year: '2-digit' } : { month: 'narrow' }) : ''));
  return out;
}

// ---------- the numbers ----------

export type RowStatus = 'paid' | 'part' | 'unpaid' | 'cancelled';

/** Money that came in on one order, split by who took it and how. */
export interface Take {
  amount: number;
  method: PayMethod | null;
  takenBy: string | null;
}

export interface Row {
  order: WithId<CateringOrder>;
  pay: Pay;
  status: RowStatus;
  /** What the customer has paid so far (on a cancelled order: what may need refunding). */
  collected: number;
  /** Still to pay; 0 once paid, and 0 when the order has no amount. */
  owed: number;
  takes: Take[];
}

export interface Split {
  /** 'cash' … or the staff name; '' when it wasn't recorded. */
  key: string;
  label: string;
  amount: number;
  /** Orders with money in this split. */
  orders: number;
}

export interface DishCount {
  name: string;
  /** Orders that had the dish. */
  orders: number;
  /** Full trays (a half tray is ½); 0 when it was never ordered in trays. */
  trays: number;
}

export interface Analytics {
  /** Every order in the range (cancelled too, never deleted), earliest first. */
  rows: Row[];
  /** Orders in the totals: not cancelled. */
  orders: number;
  /** Their amounts added up (orders with no amount add nothing). */
  sales: number;
  /** What customers have paid on them: paid in full, plus deposits. */
  collected: number;
  /** What they still owe. */
  owed: number;
  withAmount: number;
  noAmount: number;
  /** Average amount of the orders that have one; null when none has. */
  average: number | null;
  /** Orders not fully paid (with or without an amount). */
  unpaid: number;
  pickup: number;
  delivery: number;
  byMethod: Split[];
  byStaff: Split[];
  dishes: DishCount[];
  cancelled: { orders: number; paid: number };
  /** Per bar: sales and order count. */
  series: { bucket: Bucket; sales: number; orders: number }[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Who took the money on an order and how: each deposit as it was taken, and the rest of a paid order by
 *  the method and person recorded with "Paid in full". Adds up to what was collected. */
export function takesOf(pay: Pay): Take[] {
  const takes: Take[] = pay.deposits.map((d) => ({ amount: d.amount, method: d.method ?? null, takenBy: d.takenBy?.trim() || null }));
  const rest = round(paidSoFar(pay) - depositTotal(pay));
  if (rest > 0) takes.push({ amount: rest, method: pay.method, takenBy: pay.takenBy?.trim() || null });
  return takes;
}

export function rowStatus(order: CateringOrder, pay: Pay): RowStatus {
  if (isCancelled(order)) return 'cancelled';
  if (isPaid(pay)) return 'paid';
  return depositTotal(pay) > 0 ? 'part' : 'unpaid';
}

/** One entry per dish: by its menu id when it was picked from the menu, else by its name. Auto extras
 *  (raita with a biryani …) are left out, so the list shows what customers chose. */
function countDishes(rows: Row[]): DishCount[] {
  const by = new Map<string, DishCount & { names: Map<string, number> }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const l of orderLines(r.order)) {
      if (l.extra) continue;
      const name = l.name.trim();
      if (!name) continue;
      const key = l.dishId ? 'id:' + l.dishId : 'n:' + norm(name);
      let d = by.get(key);
      if (!d) by.set(key, (d = { name, orders: 0, trays: 0, names: new Map() }));
      d.names.set(name, (d.names.get(name) ?? 0) + 1);
      const unit = l.unit.trim().toLowerCase();
      if (l.qty != null && unit === 'full tray') d.trays += l.qty;
      if (l.qty != null && unit === 'half tray') d.trays += l.qty / 2;
      if (!seen.has(key)) {
        seen.add(key);
        d.orders++;
      }
    }
  }
  return [...by.values()]
    .map(({ names, ...d }) => ({ ...d, trays: round(d.trays), name: [...names].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.orders - a.orders || b.trays - a.trays || a.name.localeCompare(b.name));
}

function splits(rows: Row[], keyOf: (t: Take) => string, labelOf: (key: string) => string): Split[] {
  const by = new Map<string, { amount: number; ids: Set<string> }>();
  for (const r of rows) {
    for (const t of r.takes) {
      const k = keyOf(t);
      const s = by.get(k) ?? { amount: 0, ids: new Set<string>() };
      s.amount += t.amount;
      s.ids.add(r.order.id);
      by.set(k, s);
    }
  }
  return [...by]
    .map(([key, s]) => ({ key, label: labelOf(key), amount: round(s.amount), orders: s.ids.size }))
    // Biggest first; "Not recorded" last.
    .sort((a, b) => (a.key === '' ? 1 : 0) - (b.key === '' ? 1 : 0) || b.amount - a.amount || a.label.localeCompare(b.label));
}

export const NOT_RECORDED = 'Not recorded';

/** The numbers for every order due in the range. */
export function analyze(orders: WithId<CateringOrder>[], amounts: WithId<OrderAmount>[], range: Range): Analytics {
  const byId = new Map(amounts.map((a) => [a.id, a]));
  const rows: Row[] = orders
    .filter((o) => o.dueAt >= range.from && o.dueAt < range.to && !isDeleted(o))
    .sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id))
    .map((order) => {
      const pay = payFrom(byId.get(order.id));
      const status = rowStatus(order, pay);
      return { order, pay, status, collected: paidSoFar(pay), owed: status === 'cancelled' ? 0 : balance(pay) ?? 0, takes: takesOf(pay) };
    });
  const live = rows.filter((r) => r.status !== 'cancelled');
  const dead = rows.filter((r) => r.status === 'cancelled');
  const withAmount = live.filter((r) => r.pay.amount != null);
  const sales = round(withAmount.reduce((a, r) => a + (r.pay.amount ?? 0), 0));
  const series = bucketsFor(range).map((bucket) => {
    const inIt = live.filter((r) => r.order.dueAt >= bucket.from && r.order.dueAt < bucket.to);
    return { bucket, sales: round(inIt.reduce((a, r) => a + (r.pay.amount ?? 0), 0)), orders: inIt.length };
  });
  return {
    rows,
    orders: live.length,
    sales,
    collected: round(live.reduce((a, r) => a + r.collected, 0)),
    owed: round(live.reduce((a, r) => a + r.owed, 0)),
    withAmount: withAmount.length,
    noAmount: live.length - withAmount.length,
    average: withAmount.length ? round(sales / withAmount.length) : null,
    unpaid: live.filter((r) => r.status !== 'paid').length,
    pickup: live.filter((r) => r.order.type !== 'delivery').length,
    delivery: live.filter((r) => r.order.type === 'delivery').length,
    byMethod: splits(live, (t) => t.method ?? '', (k) => methodLabel(k as PayMethod) || NOT_RECORDED),
    byStaff: splits(live, (t) => t.takenBy ?? '', (k) => k || NOT_RECORDED),
    dishes: countDishes(live),
    cancelled: { orders: dead.length, paid: round(dead.reduce((a, r) => a + r.collected, 0)) },
    series,
  };
}

// ---------- the order list's filter ----------

/** 'all' | 'unpaid' | 'noamount' | 'cancelled' | 'm:<method or empty>' | 's:<staff name or empty>' */
export type ListFilter = string;

export function filterRows(rows: Row[], f: ListFilter): Row[] {
  if (f === 'unpaid') return rows.filter((r) => r.status === 'unpaid' || r.status === 'part');
  if (f === 'noamount') return rows.filter((r) => r.status !== 'cancelled' && r.pay.amount == null);
  if (f === 'cancelled') return rows.filter((r) => r.status === 'cancelled');
  if (f.startsWith('m:')) return rows.filter((r) => r.status !== 'cancelled' && r.takes.some((t) => (t.method ?? '') === f.slice(2)));
  if (f.startsWith('s:')) return rows.filter((r) => r.status !== 'cancelled' && r.takes.some((t) => (t.takenBy ?? '') === f.slice(2)));
  return rows;
}

/** For a method or staff filter: just the money that way on this order (a deposit by Zelle on a card order). */
export function filteredAmount(r: Row, f: ListFilter): number | null {
  const key = f.startsWith('m:') ? 'method' : f.startsWith('s:') ? 'takenBy' : null;
  if (!key) return null;
  return round(r.takes.filter((t) => (t[key] ?? '') === f.slice(2)).reduce((a, t) => a + t.amount, 0));
}
