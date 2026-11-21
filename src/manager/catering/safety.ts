// Pure helpers that keep orders safe: soft delete, cancelled orders, and the duplicate-order check.
// No React, no store, so they are easy to test.
import type { CateringOrder } from '@shared/data';

/** Deleted in the app (soft delete): hidden everywhere, but still in the database. */
export const isDeleted = (d: { deletedAt?: number | null } | null | undefined): boolean => typeof d?.deletedAt === 'number';

/** Orders or estimates not deleted. Keeps the same array when nothing is deleted. */
export function notDeleted<T extends { deletedAt?: number | null }>(list: T[]): T[] {
  return list.some(isDeleted) ? list.filter((d) => !isDeleted(d)) : list;
}

export const isCancelled = (o: Pick<CateringOrder, 'status'>): boolean => o.status === 'cancelled';

/** What the kitchen tablet sees: no deleted and no cancelled orders (list, prep, calendar, alarms, tags). */
export function kitchenOrders<T extends CateringOrder>(list: T[]): T[] {
  return list.some((o) => isDeleted(o) || isCancelled(o)) ? list.filter((o) => !isDeleted(o) && !isCancelled(o)) : list;
}

/** The phone number's digits only: "(602) 555-0101", "602.555.0101" and "+1 602 555 0101" all read "6025550101". */
export function phoneDigits(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

/** Phoenix is UTC-7 all year (no daylight saving). */
const PHOENIX_OFFSET = 7 * 3600_000;
const DAY = 24 * 3600_000;
/** The Phoenix calendar day of a time, as a day number (same number = same day). */
export const phoenixDay = (ms: number): number => Math.floor((ms - PHOENIX_OFFSET) / DAY);

/** Another order (not deleted, not cancelled) for the same phone on the same Phoenix day, or null.
 *  Skipped when the phone is empty. */
export function duplicateOf<T extends CateringOrder & { id?: string }>(orders: T[], phone: string, dueAt: number, skipId?: string): T | null {
  const digits = phoneDigits(phone);
  if (!digits) return null;
  const day = phoenixDay(dueAt);
  return (
    orders.find((o) => o.id !== skipId && !isDeleted(o) && !isCancelled(o) && typeof o.dueAt === 'number' && phoenixDay(o.dueAt) === day && phoneDigits(o.phone) === digits) ?? null
  );
}
