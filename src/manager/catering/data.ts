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
import { isPaid, payFrom } from './pay';

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
 *  undefined while loading, null when it doesn't exist or was deleted. */
export function useOrder(id: string | null, list: Order[] | null): Order | null | undefined {
  const inList = id && list ? list.find((o) => o.id === id) : undefined;
  const want = id && list && !inList ? id : null;
  const [alone, setAlone] = useState<{ id: string; doc: Order | null } | null>(null);
  useEffect(() => {
    if (!want) return undefined;
    // A deleted order (soft delete) reads as missing, the same as in the list: it can't be opened or edited.
    const stop = store.watchDoc('orders', want, (doc) => setAlone({ id: want, doc: doc && isDeleted(doc) ? null : doc }));
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

/** Keeps each amount's `paid` flag right for the 'notPaid' look-up. Pure, for tests.
 *  - create: an order still waiting for money with no amount doc yet gets one with paid: false (never overwriting).
 *  - mark: an order still waiting for money whose doc has no flag (missing or null) gets paid: false.
 *  - unmark: a doc saying paid: false whose order no longer waits for money (cancelled, deleted, or deposits that
 *    cover the whole amount) gets paid: null, so the look-up stops loading it every time a phone opens.
 *  "Paid in full" docs (paid: true) are always left alone. */
export function needsPaidFlag(orders: Order[], amounts: Amount[]): { create: string[]; mark: string[]; unmark: string[] } {
  const byId = new Map(amounts.map((a) => [a.id, a]));
  const create: string[] = [];
  const mark: string[] = [];
  const unmark: string[] = [];
  for (const o of orders) {
    const a = byId.get(o.id);
    if (waitsForMoney(o, a ?? null)) {
      if (!a) create.push(o.id);
      else if (a.paid !== true && a.paid !== false && a.paidAt == null) mark.push(o.id);
    } else if (a && a.paid === false) unmark.push(o.id);
  }
  return { create, mark, unmark };
}

/** True while an order may still be owed money: not cancelled or deleted, not paid in full, not paid off by deposits. */
function waitsForMoney(o: object & { status?: unknown }, a: Amount | null): boolean {
  if (isDeleted(o) || o.status === 'cancelled') return false;
  return !isPaid(payFrom(a));
}

/** Once per order on this phone: see needsPaidFlag. `amounts` must be the current amounts of (at least) these
 *  orders, never ones still loading, or a loading amount would look missing. Each change re-checks the order and
 *  its amount as saved on the server right then, so a stale copy on this phone never undoes another phone's
 *  "Paid in full" (or a reopen, or a removed deposit). */
export function useExplicitPaid(orders: Order[] | null, amounts: Amount[] | null) {
  const done = useRef(new Set<string>());
  useEffect(() => {
    if (!orders || !amounts) return;
    const { create, mark, unmark } = needsPaidFlag(orders, amounts);
    // m: and u: undo each other (an order cancelled, then reopened), so doing one lets the other run again.
    const once = (key: string, save: () => Promise<unknown>) => {
      if (done.current.has(key)) return;
      done.current.add(key);
      done.current.delete(key.startsWith('m:') ? 'u:' + key.slice(2) : key.startsWith('u:') ? 'm:' + key.slice(2) : '');
      save().catch(() => done.current.delete(key));
    };
    for (const id of create) {
      once(`c:${id}`, () => store.createIfMissing('orderAmounts', id, { amount: null, paid: false, updatedAt: store.now() }));
    }
    for (const id of mark) {
      once(`m:${id}`, async () => {
        const o = await store.getDoc('orders', id);
        if (!o) return;
        await store.updateIf('orderAmounts', id, (cur) => !!cur && cur.paid !== true && cur.paid !== false && cur.paidAt == null && waitsForMoney(o, cur), { paid: false });
      });
    }
    for (const id of unmark) {
      once(`u:${id}`, async () => {
        const o = await store.getDoc('orders', id);
        if (!o) return;
        await store.updateIf('orderAmounts', id, (cur) => !!cur && cur.paid === false && !waitsForMoney(o, cur), { paid: null });
      });
    }
  }, [orders, amounts]);
}
