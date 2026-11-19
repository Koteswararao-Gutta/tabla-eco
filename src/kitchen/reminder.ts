// 1-hour heads-up on the kitchen tablet. Pure helper so it is easy to test.
import type { CateringOrder, WithId } from '@shared/data';

export const REMIND_MS = 60 * 60_000;

/** How long after its due time an order stays in the banner. Later than that, its card already shows it as late. */
export const LATE_MS = 60 * 60_000;

/** An order as the kitchen sees it: `kitchenAckFor` is the due time someone tapped "Got it" for.
 *  Stored on the order, so it survives reloads and every kitchen tablet shares it. */
export type KitchenOrder = WithId<CateringOrder> & { kitchenAckFor?: number | null };

/** The store patch that acknowledges an order's heads-up. A new due time brings the reminder back. */
export const ackPatch = (o: { dueAt: number }): Partial<KitchenOrder> => ({ kitchenAckFor: o.dueAt });

/** Open orders whose heads-up time has come (see ringAt), not yet acknowledged for their current
 *  due time, and at most an hour late. Soonest first. */
export function dueReminders<T extends KitchenOrder>(orders: readonly T[], now: number, staff?: unknown): T[] {
  return orders
    .filter((o) => o.status === 'open' && now >= ringAt(o.dueAt, staff) && now <= o.dueAt + LATE_MS && o.kitchenAckFor !== o.dueAt)
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

/** One key per order and due time (so the chime rings again when the time changes). */
export const ackKey = (o: { id: string; dueAt: number }) => o.id + ':' + o.dueAt;

/** While a heads-up is showing and nobody has tapped "Got it", the chime rings again this often. */
export const CHIME_REPEAT_MS = 45_000;

// One sound output for the page. Browsers keep it muted until someone touches the screen,
// so the kitchen wakes it on the first tap (PIN digits, Got it, anywhere) with wakeAudio().
let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    if (!audio) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio = new Ctx();
    }
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  } catch {
    return null;
  }
}

/** Call on a user tap: lets the chime play from then on. */
export function wakeAudio(): void {
  audioContext();
}

/** Sound is on: the browser lets the chime play. Also true when there is no sound output at all
 *  (nothing a tap could fix). */
export const soundIsOn = (): boolean => !audio || audio.state === 'running';

/** Calls `cb` whenever sound turns on or off. Starts the sound output (it may stay off until a tap). */
export function onSoundChange(cb: () => void): () => void {
  const ctx = audioContext();
  if (!ctx) return () => {};
  ctx.addEventListener('statechange', cb);
  return () => ctx.removeEventListener('statechange', cb);
}

/** Peak loudness of each note (1 is the maximum). The notes never overlap, so it never clips. */
export const CHIME_PEAK = 0.8;

/** A clear four-note chime (high, low, high, low), made in the browser (no sound file needed). */
export function chime(): void {
  const ctx = audioContext();
  if (!ctx) return; // No sound available: the banner still shows.
  try {
    [880, 660, 880, 660].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle'; // fuller than a plain sine, so it carries over kitchen noise
      o.frequency.value = f;
      const t = ctx.currentTime + 0.05 + i * 0.5;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(CHIME_PEAK, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.47);
    });
  } catch {
    // ignore: the banner still shows
  }
}
