// Every money change on an order goes through here: it reads the order's payment as saved right now,
// makes the change from it, and adds one entry per action to its add-only log (never dropping any).
import { store, type OrderAmount, type PayEvent } from '@shared/data';
import { appendLog, payFrom, type Pay } from './pay';

type NewEvent = Omit<PayEvent, 'at'>;

/** `build` gets the current payment and returns the fields to change and the log entries to add. */
export async function savePay(id: string, build: (cur: Pay) => { patch?: Partial<OrderAmount>; events: NewEvent[] }): Promise<void> {
  const doc = await store.getDoc('orderAmounts', id);
  const at = store.now();
  const { patch = {}, events } = build(payFrom(doc));
  await store.updateDoc('orderAmounts', id, { ...patch, log: appendLog(doc?.log, ...events.map((e) => ({ ...e, at }))), updatedAt: at });
}
