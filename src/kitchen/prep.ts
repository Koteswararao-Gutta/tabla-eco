// Kitchen "Prep": one day's open catering orders, added up by dish and unit. Pure helpers: no React, no store.
//
// A dish picked from the menu (it has a dishId) with a quantity is added up. Everything else (a dish
// typed in, or a line with no quantity) is listed as written, with the customer's name.
import type { CateringOrder, OrderLine } from '@shared/data';
import { byDueAsc, dayStart, timeLabel } from '../manager/catering/orders';
import { UNITS, dishById, lineText, norm, normalizeUnit, orderLines, qtyText, type Dish } from '../manager/catering/lines';

type Order = CateringOrder;

/** One order's part of a dish: "5:30 PM Priya Sharma: 2 Full trays (extra spicy)". */
export interface PrepFrom {
  text: string;
  /** The order's line was read by a guess and nobody has checked it yet: look at the order. */
  check: boolean;
}

export interface PrepDish {
  /** Stable key: the dish name, simplified. */
  key: string;
  name: string;
  /** "4 Full trays", "1 Half tray", "40 pieces": one entry per unit, Full tray first. */
  totals: string[];
  /** Who ordered it, one entry per order, earliest first. */
  from: PrepFrom[];
  /** true when any part of the total is a guess. */
  check: boolean;
}

export interface PrepOther {
  text: string;
  customer: string;
}

export interface PrepNote {
  customer: string;
  text: string;
}

export interface PrepDay {
  orders: number;
  dishes: PrepDish[];
  others: PrepOther[];
  /** The orders' own notes ("Less spicy"), so they aren't missed when dishes are added together. */
  notes: PrepNote[];
}

const who = (o: Order) => `${timeLabel(o.dueAt)} ${(o.customerName ?? '').trim() || 'No name'}`;
const unitRank = (unit: string) => {
  const i = UNITS.findIndex((u) => u.label === unit);
  return i < 0 ? UNITS.length : i;
};

/** Open orders due on the day starting at `day` (local midnight), added up. `dishes` (the menu) gives
 *  dish names and order, and lets an order saved as plain text still match its dishes. */
export function prepFor(orders: Order[], day: number, dishes: Dish[] = []): PrepDay {
  const end = dayStart(day, 1);
  const todays = orders.filter((o) => o.status === 'open' && o.dueAt >= day && o.dueAt < end).sort(byDueAsc);
  type Acc = { name: string; rank: number; units: Map<string, number>; from: Map<string, { who: string; parts: string[]; notes: string[]; check: boolean }> };
  const byDish = new Map<string, Acc>();
  const others: PrepOther[] = [];
  const notes: PrepNote[] = [];
  todays.forEach((o, i) => {
    const orderKey = (o as { id?: string }).id ?? String(i);
    if (typeof o.notes === 'string' && o.notes.trim()) notes.push({ customer: who(o), text: o.notes.trim() });
    for (const l of orderLines(o, dishes)) {
      if (!counts(l)) {
        const text = lineText(l);
        if (text) others.push({ text, customer: who(o) });
        continue;
      }
      // The menu's name, so a line renamed on one order (or a dish re-added in Toast with a new id) still adds up.
      const menuDish = dishById(l.dishId, dishes);
      const name = menuDish?.name ?? l.name.trim();
      const key = norm(name);
      const rank = menuDish ? dishes.indexOf(menuDish) : dishes.length;
      const d: Acc = byDish.get(key) ?? { name, rank, units: new Map(), from: new Map() };
      byDish.set(key, d);
      d.rank = Math.min(d.rank, rank);
      const unit = normalizeUnit(l.unit).unit;
      d.units.set(unit, (d.units.get(unit) ?? 0) + l.qty!);
      const f = d.from.get(orderKey) ?? { who: who(o), parts: [], notes: [], check: false };
      d.from.set(orderKey, f);
      f.parts.push(qtyText({ qty: l.qty, unit }));
      if (l.note.trim()) f.notes.push(l.note.trim());
      if (l.check) f.check = true;
    }
  });
  const dishList = [...byDish.entries()].map(([key, d]) => {
    const from = [...d.from.values()].map((f) => ({ text: `${f.who}: ${f.parts.join(', ')}${f.notes.length ? ` (${f.notes.join(', ')})` : ''}`, check: f.check }));
    return {
      key,
      rank: d.rank,
      name: d.name,
      totals: [...d.units.entries()].sort((a, b) => unitRank(a[0]) - unitRank(b[0]) || a[0].localeCompare(b[0])).map(([unit, qty]) => qtyText({ qty: Math.round(qty * 100) / 100, unit })),
      from,
      check: from.some((f) => f.check),
    };
  });
  dishList.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return { orders: todays.length, dishes: dishList.map(({ rank: _rank, ...d }) => d), others, notes };
}

const counts = (l: OrderLine) => !!l.dishId && typeof l.qty === 'number' && Number.isFinite(l.qty) && l.qty > 0 && !!l.name.trim();
