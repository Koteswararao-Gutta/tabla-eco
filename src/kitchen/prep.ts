// Kitchen "Prep": one day's open catering orders, added up by dish and unit. Pure helpers: no React, no store.
//
// A dish picked from the menu (it has a dishId) with a quantity is added up. Everything else (a dish
// typed in, or a line with no quantity) is listed as written, with the customer's name.
import type { CateringOrder, OrderLine } from '@shared/data';
import { byDueAsc, dayStart } from '../manager/catering/orders';
import { lineText, orderLines, qtyText, type Dish } from '../manager/catering/lines';

type Order = CateringOrder;

export interface PrepDish {
  name: string;
  /** "4 Full trays", "1 Half tray", "40 pieces": one entry per unit, in the order first seen. */
  totals: string[];
  /** Who ordered it: "Patel: 2 Full trays (extra spicy)". */
  from: string[];
}

export interface PrepOther {
  text: string;
  customer: string;
}

export interface PrepDay {
  orders: number;
  dishes: PrepDish[];
  others: PrepOther[];
}

/** Open orders due on the day starting at `day` (local midnight), added up. `dishes` (the menu) lets an
 *  order saved as plain text still match its dishes. */
export function prepFor(orders: Order[], day: number, dishes: Dish[] = []): PrepDay {
  const end = dayStart(day, 1);
  const todays = orders.filter((o) => o.status === 'open' && o.dueAt >= day && o.dueAt < end).sort(byDueAsc);
  const byDish = new Map<string, { name: string; units: Map<string, { unit: string; qty: number }>; from: string[] }>();
  const others: PrepOther[] = [];
  for (const o of todays) {
    for (const l of orderLines(o, dishes)) {
      if (!counts(l)) {
        const text = lineText(l);
        if (text) others.push({ text, customer: o.customerName });
        continue;
      }
      const d = byDish.get(l.dishId!) ?? { name: l.name.trim(), units: new Map(), from: [] as string[] };
      byDish.set(l.dishId!, d);
      const key = l.unit.trim().toLowerCase();
      const u = d.units.get(key) ?? { unit: l.unit.trim(), qty: 0 };
      d.units.set(key, u);
      u.qty += l.qty!;
      const note = l.note.trim();
      d.from.push(`${o.customerName}: ${qtyText(l)}${note ? ` (${note})` : ''}`);
    }
  }
  return {
    orders: todays.length,
    dishes: [...byDish.values()]
      .map((d) => ({ name: d.name, totals: [...d.units.values()].map((u) => qtyText(u)), from: d.from }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    others,
  };
}

const counts = (l: OrderLine) => !!l.dishId && typeof l.qty === 'number' && Number.isFinite(l.qty) && l.qty > 0 && !!l.name.trim();
