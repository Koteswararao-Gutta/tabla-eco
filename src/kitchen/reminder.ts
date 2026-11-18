// 1-hour heads-up on the kitchen tablet. Pure helper so it is easy to test.
import type { CateringOrder, WithId } from '@shared/data';

export const REMIND_MS = 60 * 60_000;

/** Open orders whose heads-up time has come (see ringAt) and that this tablet hasn't acknowledged yet. */
export function dueReminders(
  orders: readonly WithId<CateringOrder>[],
  now: number,
  acked: ReadonlySet<string>,
  staff?: unknown,
): WithId<CateringOrder>[] {
  return orders
    .filter((o) => o.status === 'open' && now >= ringAt(o.dueAt, staff) && !acked.has(o.id + ':' + o.dueAt))
    .sort((a, b) => a.dueAt - b.dueAt);
}

// ---------- only while someone is in the kitchen ----------
// The staff schedule's hours (Manager > Staff > Settings) say when the kitchen is staffed: from prep start
// (or opening, if earlier) to closing, minus the break. The tablet's heads-up rings 1 hour before an order,
// but never while nobody is there: during the break or before opening it waits until people are back,
// and if they'd only be back after the order is due, it rings just before they leave instead.

const MIN = 60_000;
type Span = [number, number]; // ms

/** Staffed times on the local day that starts at `day0` (midnight, ms). Empty when closed. */
export function staffedSpans(staff: unknown, day0: number): Span[] | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = staff as any;
  const s = c?.settings;
  if (!s || !Array.isArray(s.days) || s.days.length !== 7) return null;
  const date = new Date(day0);
  const p = (n: number) => String(n).padStart(2, '0');
  const key = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  const special = c.special && typeof c.special === 'object' ? c.special[key] : undefined;
  const base = s.days[(date.getDay() + 6) % 7]; // the planner's days start on Monday
  const h = special ?? base;
  if (!h || h.closed) return [];
  const num = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
  if (!num(h.open) || !num(h.close) || h.close <= h.open) return null;
  const start = num(s.prepStart) && s.prepStart < h.open ? s.prepStart : h.open;
  const at = (m: number) => {
    const d = new Date(day0);
    d.setHours(0, m, 0, 0);
    return d.getTime();
  };
  const brk = Array.isArray(h.brk) && num(h.brk[0]) && num(h.brk[1]) && h.brk[0] > h.open && h.brk[1] > h.brk[0] && h.brk[1] < h.close ? h.brk : null;
  return brk ? [[at(start), at(brk[0])], [at(brk[1]), at(h.close)]] : [[at(start), at(h.close)]];
}

/** When the tablet should show an order's heads-up. Without staff hours: exactly 1 hour before. */
export function ringAt(dueAt: number, staff?: unknown): number {
  const target = dueAt - REMIND_MS;
  const spans: Span[] = [];
  for (const offset of [-1, 0, 1]) {
    const d = new Date(target);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    const s = staffedSpans(staff, d.getTime());
    if (s === null) return target; // no usable hours: keep it simple
    spans.push(...s);
  }
  if (spans.some(([a, b]) => target >= a && target < b)) return target;
  const back = spans.find(([a]) => a > target && a < dueAt); // people come back before it's due
  if (back) return back[0];
  const before = spans.filter(([, b]) => b <= target && b > target - 12 * 60 * MIN).pop(); // last chance before they leave
  if (before) return Math.max(before[0], before[1] - 15 * MIN);
  return target;
}

/** Acknowledgement key: changing an order's time brings its reminder back. */
export const ackKey = (o: { id: string; dueAt: number }) => o.id + ':' + o.dueAt;

/** A short two-note chime, made in the browser (no sound file needed). */
export function chime(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.65);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // No sound available: the banner still shows.
  }
}
