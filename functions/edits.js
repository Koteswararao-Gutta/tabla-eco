// Phone alert when the kitchen edits a catering order. Kept free of Firebase so it can be tested on its own.
import { APP_LINK, MAX_BODY, MAX_NAME, MAX_TITLE } from './reminders.js';

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const list = (h) => (Array.isArray(h) ? h : []);

/**
 * The edit the kitchen just saved, or null. `before`/`after` are the order before and after the write.
 * Only a new history entry made by the kitchen counts (not the manager's own edits, a completed order, or a "Got it").
 */
export function kitchenEdit(before, after) {
  if (!before || !after) return null;
  const was = list(before.history);
  const now = list(after.history);
  if (now.length === 0) return null;
  const last = now[now.length - 1];
  const prev = was[was.length - 1];
  if (prev && prev.at === last.at && prev.by === last.by) return null; // no new entry
  if (!last || last.by !== 'kitchen' || !Array.isArray(last.changes) || last.changes.length === 0) return null;
  return last;
}

/** The alert's words, e.g. "Kitchen changed Sharma order" / "Items: 20 samosas → 25 samosas". */
export function editAlertFor(order, edit) {
  const name = cut(String(order?.customerName || '').trim(), MAX_NAME) || 'an';
  const body = edit.changes.map((c) => String(c)).join('; ');
  return { title: cut(`Kitchen changed ${name} order`, MAX_TITLE), body: cut(body, MAX_BODY), link: APP_LINK };
}
