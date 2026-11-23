// Every money change on an order goes through here: it reads the order's payment as saved right now,
// makes the change from it, and adds one entry per action to its add-only log (never dropping any).
import { appendItems, store, type Deposit, type OrderAmount, type PayEvent, type WithId } from '@shared/data';
import { cleanEvent, payFrom, type Pay } from './pay';

type NewEvent = Omit<PayEvent, 'at'>;

/**
 * `build` gets the current payment and returns the fields to change, the log entries to add, and any new deposits.
 * Log entries and new deposits are added to the end of the lists as the server has them when the save arrives,
 * never by rewriting the lists: a deposit taken offline while another phone also saved a payment is kept.
 */
export async function savePay(
  id: string,
  build: (cur: Pay) => { patch?: Partial<OrderAmount>; events: NewEvent[]; addDeposits?: Deposit[] },
): Promise<void> {
  const { doc, known } = await readPay(id);
  const at = store.now();
  const { patch = {}, events, addDeposits } = build(payFrom(doc));
  // A new amount doc says paid: false from the start, so the 'notPaid' look-up finds it and no phone has to add
  // the flag later (see useExplicitPaid). Only when the doc is known to be missing: offline, another phone may
  // already have marked it paid.
  const flag = known && !doc && patch.paid === undefined ? { paid: false } : {};
  const lists: Partial<OrderAmount> = { log: appendItems(events.map((e) => cleanEvent({ ...e, at }))) };
  if (addDeposits?.length) lists.deposits = appendItems(addDeposits);
  await store.updateDoc('orderAmounts', id, { ...flag, ...patch, ...lists, updatedAt: at });
}

/**
 * The payment as saved. Without internet the phone can only read what it already has: a payment it has never
 * seen (e.g. for an order added while offline) can't be read at all, and the read fails. Then it counts as none
 * (known: false), which is also what the screen shows, and the save is kept and sent when the internet is back,
 * like every other offline save. Online, a failed read still fails the save ("Could not save").
 */
async function readPay(id: string): Promise<{ doc: WithId<OrderAmount> | null; known: boolean }> {
  try {
    return { doc: await store.getDoc('orderAmounts', id), known: true };
  } catch (e) {
    if (isOfflineError(e)) return { doc: null, known: false };
    throw e;
  }
}

/** True for "no internet": the device says it is offline, or the store gave up for lack of a connection. */
export function isOfflineError(e: unknown, online = typeof navigator === 'undefined' ? true : navigator.onLine): boolean {
  return online === false || (e as { code?: unknown } | null)?.code === 'unavailable';
}
