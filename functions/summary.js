// Morning summary: at 9:00 AM (restaurant time) one phone alert lists today's catering orders.
// Kept free of Firebase so it can be tested on its own.
import { APP_LINK, isLive, MAX_BODY, MAX_TITLE, TIME_ZONE } from './reminders.js';

/** How far either side of "now" the server loads orders before picking today's (a day is at most 25 hours). */
export const SUMMARY_WINDOW_MS = 26 * 60 * 60_000;
const NAME = 24;
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The restaurant's calendar day for a time, e.g. "2026-11-21". */
export function restaurantDay(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
}

/** Today's open orders (not completed, cancelled or deleted), earliest first. `orders` are { id, ...data }. */
export function todaysOrders(orders, now) {
  const today = restaurantDay(now);
  return orders
    .filter((o) => isLive(o) && typeof o.dueAt === 'number' && restaurantDay(o.dueAt) === today)
    .sort((a, b) => a.dueAt - b.dueAt);
}

/** The alert's words, e.g. "Today's catering: 3 orders" / "11:30 AM Priya Sharma; 6:00 PM Raj (delivery); …". Null when there is nothing today. */
export function summaryFor(orders) {
  if (!orders.length) return null;
  const n = orders.length;
  const lines = orders.map((o) => {
    const time = new Date(o.dueAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE });
    const name = cut(String(o.customerName || '').trim(), NAME) || 'Order';
    return `${time} ${name}${o.type === 'delivery' ? ' (delivery)' : ''}`;
  });
  return {
    title: cut(`Today's catering: ${n} order${n === 1 ? '' : 's'}`, MAX_TITLE),
    body: cut(lines.join('; '), MAX_BODY),
    link: APP_LINK,
  };
}
