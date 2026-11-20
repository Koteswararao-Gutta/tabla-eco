// Kitchen list: open orders grouped by when they are due, so the kitchen sees today first.
// Pure helpers (no React, no store), everything takes `now`.
import type { CateringOrder } from '@shared/data';
import { byDueAsc, dayStart } from '../manager/catering/orders';

export type DayGroupKey = 'earlier' | 'today' | 'tomorrow' | 'week' | 'later';

export interface DayGroup<T> {
  /** Unique per group (a weekday group uses its day). */
  id: string;
  kind: DayGroupKey;
  label: string;
  orders: T[];
}

/** Days after today that are still in this Monday-to-Sunday week (0 on a Sunday). */
function daysLeftInWeek(now: number): number {
  const wd = new Date(now).getDay(); // 0 = Sunday
  return wd === 0 ? 0 : 7 - wd;
}

/** "Saturday, Nov 21" */
export function weekdayLabel(day: number): string {
  return new Date(day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * Open orders, soonest first, in groups: Not completed from earlier days, Today, Tomorrow, one group per
 * remaining day of this week (Monday to Sunday) by name, then Later. Empty groups are left out.
 */
export function kitchenGroups<T extends CateringOrder>(orders: T[], now: number): DayGroup<T>[] {
  const today = dayStart(now);
  const tomorrow = dayStart(now, 1);
  const weekEnd = dayStart(now, daysLeftInWeek(now) + 1); // midnight after this Sunday
  const groups: DayGroup<T>[] = [];
  const add = (id: string, kind: DayGroupKey, label: string, o: T) => {
    let g = groups.find((x) => x.id === id);
    if (!g) groups.push((g = { id, kind, label, orders: [] }));
    g.orders.push(o);
  };
  for (const o of orders.filter((o) => o.status === 'open').sort(byDueAsc)) {
    const day = dayStart(o.dueAt);
    if (day < today) add('earlier', 'earlier', 'Not completed from earlier days', o);
    else if (day === today) add('today', 'today', 'Today', o);
    else if (day === tomorrow) add('tomorrow', 'tomorrow', 'Tomorrow', o);
    else if (day < weekEnd) add(String(day), 'week', weekdayLabel(day), o);
    else add('later', 'later', 'Later', o);
  }
  return groups;
}
