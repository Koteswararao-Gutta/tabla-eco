// What the catering screens load, so a phone downloads only what it shows, not every order ever saved.
//  - The list: open orders and the last 60 days ('openOrRecent'), the same as the kitchen.
//  - Unpaid orders, however old: amounts with paid === false ('notPaid'), then those few orders by id.
//    So that query finds every unpaid order, each order's amount gets an explicit `paid: false` while the
//    order is in the list (every order is open, so in the list, at some point): see useExplicitPaid.
//  - Amounts: only those of the orders on screen ({ ids }).
//  - Older history, Payments, Statistics and Export: a date range, only when opened.
import { useEffect, useMemo, useRef, useState } from 'react';
import { store, useCollection, type CateringOrder, type CollectionFilter, type OrderAmount, type WithId } from '@shared/data';
import { dayStart, fromInputs } from './orders';

type Order = WithId<CateringOrder>;
type Amount = WithId<OrderAmount>;

const isDeleted = (o: object) => typeof (o as { deletedAt?: unknown }).deletedAt === 'number';

/** The order form's look-up of other orders: a day either side of the picked date ("yyyy-mm-dd"), enough for
 *  the same-day list and a nearby duplicate. Nothing while the date isn't a date. */
export function nearDay(date: string): CollectionFilter {
  const at = fromInputs(date, '12:00');
  return at === null ? { ids: [] } : { dueFrom: dayStart(at, -1), dueTo: dayStart(at, 2) };
}

/** History's "Show orders before …": the next step back, 6 months before `from`, at midnight. */
export function olderStep(from: number): number {
  const d = new Date(from);
  return new Date(d.getFullYear(), d.getMonth() - 6, d.getDate()).getTime();
}

/** "Sep 22, 2026" */
export const shortDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Lists merged by id (a later list's copy wins), each order once. */
export function mergeById<T extends { id: string }>(...lists: (T[] | null | undefined)[]): T[] {
  const byId = new Map<string, T>();
  for (const list of lists) for (const d of list ?? []) byId.set(d.id, d);
  return [...byId.values()];
}

/** The amounts of these orders, live. `shown`: while a changed list of orders loads, the amounts already known
 *  stay, so cards don't flash (null until the first answer). `current`: only once the amounts of exactly these
 *  orders have arrived (null meanwhile). */
export function useAmountsOf(orders: { id: string }[] | null): { shown: Amount[] | null; current: Amount[] | null } {
  const ids = orders ? orders.map((o) => o.id) : null;
  const docs = useCollection('orderAmounts', { ids: ids ?? [] });
  const last = useRef<Amount[] | null>(null);
  if (docs && ids) last.current = docs;
  return { shown: ids ? docs ?? last.current : null, current: ids ? docs : null };
}

/** The catering page's orders: open and recent ones, unpaid ones however old, and (when `olderFrom` is set)
 *  every order due from then on. `orders` is null until the open and recent ones arrive; `unpaidReady` turns
 *  true once the old unpaid ones have arrived too, so the Unpaid count doesn't jump. */
export function useCateringOrders(olderFrom: number | null, recentFrom: number) {
  const recent = useCollection('orders', 'openOrRecent');
  const notPaid = useCollection('orderAmounts', 'notPaid');
  // Unpaid orders older than the list: few, so asked by id.
  const oldIds = useMemo(() => {
    if (!recent || !notPaid) return null;
    const have = new Set(recent.map((o) => o.id));
    return notPaid.map((a) => a.id).filter((id) => !have.has(id));
  }, [recent, notPaid]);
  const old = useCollection('orders', { ids: oldIds ?? [] });
  // Overlaps the recent list by a day, so no order falls between the two.
  const older = useCollection('orders', olderFrom === null ? { ids: [] } : { dueFrom: olderFrom, dueTo: recentFrom + 24 * 3600_000 });
  const orders = useMemo(
    () => (recent ? mergeById(olderFrom === null ? null : older, old, recent) : null),
    [recent, old, older, olderFrom],
  );
  return { orders, recent, unpaidReady: !!oldIds && !!old, olderLoading: olderFrom !== null && !older };
}

/** One order, from the list when it is there, else read on its own (e.g. an old order opened from Payments).
 *  undefined while loading, null when it doesn't exist. */
export function useOrder(id: string | null, list: Order[] | null): Order | null | undefined {
  const inList = id && list ? list.find((o) => o.id === id) : undefined;
  const want = id && list && !inList ? id : null;
  const [alone, setAlone] = useState<{ id: string; doc: Order | null } | null>(null);
  useEffect(() => {
    if (!want) return undefined;
    const stop = store.watchDoc('orders', want, (doc) => setAlone({ id: want, doc }));
    return () => {
      stop();
      setAlone(null);
    };
  }, [want]);
  // An order that just left the list (e.g. an old one marked paid) keeps showing while it is read on its own,
  // so its open sheet doesn't close.
  const last = useRef<Order | null>(null);
  const found = !id ? null : inList ? inList : !list || !alone || alone.id !== id ? undefined : alone.doc;
  if (found !== undefined) last.current = found;
  return found === undefined && id && last.current?.id === id ? last.current : found;
}

/** Orders that need an explicit `paid: false` on their amount so the 'notPaid' query finds them later:
 *  a missing amount doc is created (never overwriting one), and a doc without `paid` gets it. Paid docs
 *  and docs that already say paid: false are left alone. Pure, for tests. */
export function needsPaidFlag(orders: Order[], amounts: Amount[]): { create: string[]; mark: string[] } {
  const byId = new Map(amounts.map((a) => [a.id, a]));
  const create: string[] = [];
  const mark: string[] = [];
  for (const o of orders) {
    if (isDeleted(o) || (o.status as string) === 'cancelled') continue;
    const a = byId.get(o.id);
    if (!a) create.push(o.id);
    else if (typeof a.paid !== 'boolean' && a.paidAt == null) mark.push(o.id);
  }
  return { create, mark };
}

/** Once per order on this phone: see needsPaidFlag. `amounts` must be the current amounts of (at least) these
 *  orders, never ones still loading, or a loading amount would look missing. */
export function useExplicitPaid(orders: Order[] | null, amounts: Amount[] | null) {
  const done = useRef(new Set<string>());
  useEffect(() => {
    if (!orders || !amounts) return;
    const { create, mark } = needsPaidFlag(orders, amounts);
    for (const id of create) {
      if (done.current.has(id)) continue;
      done.current.add(id);
      store.createIfMissing('orderAmounts', id, { amount: null, paid: false, updatedAt: store.now() }).catch(() => done.current.delete(id));
    }
    for (const id of mark) {
      if (done.current.has(id)) continue;
      done.current.add(id);
      store.updateDoc('orderAmounts', id, { paid: false }).catch(() => done.current.delete(id));
    }
  }, [orders, amounts]);
}
