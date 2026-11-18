// 1-hour catering reminders: when to ring, whether to still send, and what the alert says.
// Kept free of Firebase so it can be tested on its own.

export const REMIND_MS = 60 * 60_000;
/** Cloud Tasks can only be scheduled up to 30 days ahead; further out we wake up early and plan again. */
export const MAX_AHEAD_MS = 29 * 24 * 60 * 60_000;
export const TIME_ZONE = 'America/Phoenix';
export const APP_LINK = 'https://koteswararao-gutta.github.io/tabla-eco/#/manager/catering';

/** When to wake up for this order, or null if it needs no reminder. `id` makes re-saves of the same order not ring twice. */
export function planReminder(orderId, order, now) {
  if (!order || order.status !== 'open' || typeof order.dueAt !== 'number') return null;
  if (order.dueAt <= now) return null;
  const at = Math.min(Math.max(now, order.dueAt - REMIND_MS), now + MAX_AHEAD_MS);
  return { at, dueAt: order.dueAt, id: `${orderId}-${order.dueAt}-${Math.round(at / 60_000)}`.replace(/[^A-Za-z0-9_-]/g, '_') };
}

/** What to do when the alarm rings: 'send', 'later' (still more than an hour away: plan again) or 'skip'. */
export function onRing(order, task, now) {
  if (!order || order.status !== 'open' || order.dueAt !== task.dueAt) return 'skip'; // completed, deleted or moved
  if (order.dueAt <= now) return 'skip';
  if (order.dueAt - now > REMIND_MS + 5 * 60_000) return 'later';
  return 'send';
}

/** The alert's words. */
export function alertFor(order, now) {
  const mins = Math.max(1, Math.round((order.dueAt - now) / 60_000));
  const when = mins >= 55 ? '1 hour' : `${mins} min`;
  const time = new Date(order.dueAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE });
  const kind = order.type === 'delivery' ? 'delivery' : 'pickup';
  return { title: `Catering in ${when}`, body: `${order.customerName || 'Order'}, ${kind} at ${time}`, link: APP_LINK };
}

/** Tokens FCM says are gone for good (app removed, notifications turned off): delete them. */
export function deadTokens(tokens, responses) {
  const gone = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];
  return tokens.filter((_, i) => !responses[i]?.success && gone.includes(responses[i]?.error?.code));
}
