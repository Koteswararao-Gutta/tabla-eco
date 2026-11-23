// Every money change on an order goes through here: it reads the order's payment as saved right now,
// makes the change from it, and adds one entry per action to its add-only log (never dropping any).
import { store, type OrderAmount, type PayEvent, type WithId } from '@shared/data';
import { appendLog, payFrom, type Pay } from './pay';

type NewEvent = Omit<PayEvent, 'at'>;

/** `build` gets the current payment and returns the fields to change and the log entries to add. */
export async function savePay(id: string, build: (cur: Pay) => { patch?: Partial<OrderAmount>; events: NewEvent[] }): Promise<void> {
  const doc = await readPay(id);
  const at = store.now();
  const { patch = {}, events } = build(payFrom(doc));
  // A new amount doc says paid: false from the start, so the 'notPaid' look-up finds it and no phone has to add
  // the flag later (see useExplicitPaid).
  const flag = !doc && patch.paid === undefined ? { paid: false } : {};
  await store.updateDoc('orderAmounts', id, { ...flag, ...patch, log: appendLog(doc?.log, ...events.map((e) => ({ ...e, at }))), updatedAt: at });
}

/**
 * The payment as saved. Without internet the phone can only read what it already has: a payment it has never
 * seen (e.g. for an order added while offline) can't be read at all, and the read fails. Then it counts as none,
 * which is also what the screen shows, and the save is kept and sent when the internet is back, like every
 * other offline save. Online, a failed read still fails the save ("Could not save").
 */
async function readPay(id: string): Promise<WithId<OrderAmount> | null> {
  try {
    return await store.getDoc('orderAmounts', id);
  } catch (e) {
    if (isOfflineError(e)) return null;
    throw e;
  }
}

/** True for "no internet": the device says it is offline, or the store gave up for lack of a connection. */
export function isOfflineError(e: unknown, online = typeof navigator === 'undefined' ? true : navigator.onLine): boolean {
  return online === false || (e as { code?: unknown } | null)?.code === 'unavailable';
}
