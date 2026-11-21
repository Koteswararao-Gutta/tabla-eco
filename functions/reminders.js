// 1-hour catering reminders: when to ring, whether to still send, and what the alert says.
// Kept free of Firebase so it can be tested on its own.

export const REMIND_MS = 60 * 60_000;
/** Cloud Tasks can only be scheduled up to 30 days ahead; further out we wake up early and plan again. */
export const MAX_AHEAD_MS = 29 * 24 * 60 * 60_000;
export const TIME_ZONE = 'America/Phoenix';
export const APP_LINK = 'https://koteswararao-gutta.github.io/tabla-eco/#/manager/catering';

/** True for an order that should still ring: open (not completed or cancelled) and not deleted. */
export function isLive(order) {
  return !!order && order.status === 'open' && !(typeof order.deletedAt === 'number');
}

/** When to wake up for this order, or null if it needs no reminder. `id` makes re-saves of the same order not ring twice. */
export function planReminder(orderId, order, now) {
  if (!isLive(order) || typeof order.dueAt !== 'number') return null;
  if (order.dueAt <= now) return null;
  const at = Math.min(Math.max(now, order.dueAt - REMIND_MS), now + MAX_AHEAD_MS);
  return { at, dueAt: order.dueAt, id: `${orderId}-${order.dueAt}-${Math.round(at / 60_000)}`.replace(/[^A-Za-z0-9_-]/g, '_') };
}

/**
 * Whether a saved order needs its alarm (re)set. `before`/`after` are the order before and after the write
 * (null when created/deleted). Writes that only change other fields (notes, the server's `remindedFor`,
 * the kitchen's "Got it") don't set a new alarm.
 */
export function shouldSchedule(before, after) {
  if (!isLive(after)) return false;
  // Same time, still open and not deleted before: the alarm already set still holds. (Undo delete sets it again.)
  if (isLive(before) && before.dueAt === after.dueAt) return false;
  return true;
}

/** What to do when the alarm rings: 'send', 'later' (still more than an hour away: plan again) or 'skip'.
 *  Checked again when it rings, so a cancelled or deleted order never rings. */
export function onRing(order, task, now) {
  if (!isLive(order) || order.dueAt !== task.dueAt) return 'skip'; // completed, cancelled, deleted or moved
  if (order.remindedFor === task.dueAt) return 'skip'; // already sent for this time (a retry, or moved away and back)
  if (order.dueAt <= now) return 'skip';
  if (order.dueAt - now > REMIND_MS + 5 * 60_000) return 'later';
  return 'send';
}

/** Longest title, body and name in an alert, in characters (FCM data payloads are capped at 4 KB in all). */
export const MAX_TITLE = 80;
export const MAX_BODY = 200;
export const MAX_NAME = 60;
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The alert's words. */
export function alertFor(order, now) {
  const mins = Math.max(1, Math.round((order.dueAt - now) / 60_000));
  const when = mins >= 55 ? '1 hour' : `${mins} min`;
  const time = new Date(order.dueAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE });
  const kind = order.type === 'delivery' ? 'delivery' : 'pickup';
  const name = cut(String(order.customerName || '').trim(), MAX_NAME) || 'Order';
  return { title: cut(`Catering in ${when}`, MAX_TITLE), body: cut(`${name}, ${kind} at ${time}`, MAX_BODY), link: APP_LINK };
}

/**
 * Tokens FCM says are gone for good (app removed, notifications turned off): delete them.
 * Not 'messaging/invalid-argument': FCM also answers that for a bad message, which would wipe every phone.
 */
export function deadTokens(tokens, responses) {
  const gone = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];
  return tokens.filter((_, i) => !responses[i]?.success && gone.includes(responses[i]?.error?.code));
}

/** FCM's sendEachForMulticast takes at most this many tokens per call. */
export const FCM_BATCH = 500;

/** Splits a list into chunks of `size`. */
export function chunks(list, size = FCM_BATCH) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Whether a reminder send should be tried again (Cloud Tasks retries when the task throws): nobody got it,
 * and at least one phone failed for a reason that may pass (not a phone that is gone for good).
 */
export function sendShouldRetry({ sent, failed, removed }) {
  return sent === 0 && failed - removed > 0;
}
