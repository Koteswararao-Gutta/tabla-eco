// 1-hour heads-up on the kitchen tablet. Pure helper so it is easy to test.
import type { CateringOrder, WithId } from '@shared/data';
import { defaults } from '../manager/staff/model'; // read-only: the shift planner's starting hours
import { dayLabel, timeLabel, countdown } from '../manager/catering/orders';

export const REMIND_MS = 60 * 60_000;

/** How long after its due time an order stays in the banner. Later than that, its card already shows it as late. */
export const LATE_MS = 60 * 60_000;

/** An order as the kitchen sees it: `kitchenAckFor` is the due time someone tapped "Got it" for.
 *  Stored on the order, so it survives reloads and every kitchen tablet shares it. */
export type KitchenOrder = WithId<CateringOrder> & { kitchenAckFor?: number | null };

/** The store patch that acknowledges an order's heads-up. A new due time brings the reminder back. */
export const ackPatch = (o: { dueAt: number }): Partial<KitchenOrder> => ({ kitchenAckFor: o.dueAt });

/** Open orders whose heads-up time has come (see ringAt), not yet acknowledged for their current
 *  due time, and at most an hour late (or an hour after its heads-up, when that only came at opening). Soonest first. */
export function dueReminders<T extends KitchenOrder>(orders: readonly T[], now: number, staff?: unknown): T[] {
  return orders
    .filter((o) => {
      // Only open orders ring: never a completed, cancelled or deleted one.
      if (o.status !== 'open' || typeof o.deletedAt === 'number' || o.kitchenAckFor === o.dueAt) return false;
      const ring = ringAt(o.dueAt, staff);
      return now >= ring && now <= Math.max(o.dueAt, ring) + LATE_MS;
    })
    .sort((a, b) => a.dueAt - b.dueAt);
}

// ---------- only while someone is in the kitchen ----------
// The staff schedule's hours (Manager > Staff > Settings) say when the kitchen is staffed: from prep start
// (or opening, if earlier) to closing, minus the break. The tablet's heads-up rings 1 hour before an order,
// but never while nobody is there: during the break or before opening it waits until people are back,
// and if they'd only be back after the order is due, it rings just before they leave instead.

const MIN = 60_000;
type Span = [number, number]; // ms

/** The staff schedule nobody has saved yet (`null`): the planner's starting hours, so the alarm
 *  doesn't ring at 3 AM before the manager opens Staff once. */
let plannerDefaults: unknown;
const defaultStaff = () => (plannerDefaults ??= defaults().config);

/** Staffed times on the local day that starts at `day0` (midnight, ms). Empty when closed.
 *  `staff` null (no schedule saved) uses the planner's starting hours. */
export function staffedSpans(staff: unknown, day0: number): Span[] | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (staff === null ? defaultStaff() : staff) as any;
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
  // Prep starts the same time ahead of opening as on a normal day (like the planner's hoursFor),
  // so a special day opening at 3 PM starts prep before 3, not at the usual morning time.
  const lead = num(s.prepStart) && base && num(base.open) ? Math.max(0, base.open - s.prepStart) : 0;
  const start = h.open - lead;
  const at = (m: number) => {
    const d = new Date(day0);
    d.setHours(0, m, 0, 0);
    return d.getTime();
  };
  const brk = Array.isArray(h.brk) && num(h.brk[0]) && num(h.brk[1]) && h.brk[0] > h.open && h.brk[1] > h.brk[0] && h.brk[1] < h.close ? h.brk : null;
  return brk ? [[at(start), at(brk[0])], [at(brk[1]), at(h.close)]] : [[at(start), at(h.close)]];
}

/** Coming back this long before an order is due still leaves time to get it ready; any later (a 5:05 PM order
 *  when the break ends at 5) and the heads-up goes out before they leave instead. */
export const BACK_ENOUGH_MS = 20 * MIN;

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
  // People come back before it's due, with enough time left to get it ready: ring when they arrive.
  const back = spans.find(([a]) => a > target && dueAt - a >= BACK_ENOUGH_MS);
  if (back) return back[0];
  const before = spans.filter(([, b]) => b <= target && b >= target - 14 * 60 * MIN).pop(); // last chance before they leave (the night before, too)
  if (before) return Math.max(before[0], before[1] - 15 * MIN);
  const next = spans.find(([a]) => a > target); // nobody there before it's due: ring when they arrive
  if (next) return next[0];
  return target;
}

/** True while the kitchen is staffed (staff schedule hours), so the alarm may ring. Without usable hours: always. */
export function staffedAt(now: number, staff?: unknown): boolean {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const spans = staffedSpans(staff, d.getTime());
  if (spans === null) return true;
  return spans.some(([a, b]) => now >= a && now < b);
}

/** "pickup at 3:00 PM, in 30 min" today; "pickup tomorrow at 10:15 AM" (or "on Wed, Nov 25") on another day. */
export function whenText(o: { type: string; dueAt: number }, now: number, capital = false): string {
  const type = o.type === 'delivery' ? 'delivery' : 'pickup';
  const kind = capital ? type[0].toUpperCase() + type.slice(1) : type;
  const day = dayLabel(o.dueAt, now);
  if (day === 'Today' || isNear(o.dueAt, now)) return `${kind} at ${timeLabel(o.dueAt)}, ${countdown(o.dueAt, now).text}`;
  const on = day === 'Tomorrow' || day === 'Yesterday' ? day.toLowerCase() : 'on ' + day;
  return `${kind} ${on} at ${timeLabel(o.dueAt)}`;
}

/** Within this time an order reads as "soon, in 30 min", even just past midnight; further off, by its day. */
const NEAR_MS = 3 * 3_600_000;
const isNear = (dueAt: number, now: number) => dueAt - now <= NEAR_MS;

/** The alarm's headline: "soon" when every order is today or within a few hours; otherwise the day (or "coming up"). */
export function alarmTitle(reminders: readonly { dueAt: number }[], now: number): string {
  const days = new Set(reminders.map((o) => (isNear(o.dueAt, now) ? 'Today' : dayLabel(o.dueAt, now))));
  const one = days.size === 1 ? [...days][0] : null;
  const when = one === 'Today' ? 'soon' : one === 'Tomorrow' ? 'tomorrow' : 'coming up';
  return reminders.length > 1 ? `${reminders.length} catering orders ${when}` : `Catering order ${when}`;
}

/** One key per order and due time (so the alarm rings again when the time changes). */
export const ackKey = (o: { id: string; dueAt: number }) => o.id + ':' + o.dueAt;

// ---------- the alarm ----------
// While a heads-up is waiting, the tablet rings a loud siren over and over until someone touches the screen.
// It always plays at least MIN_RINGS full rings, even if someone touches it during the first one.

/** One ring: a siren of ALARM_BEEPS beeps. Then a short pause, then the next ring. */
export const ALARM_BEEPS = 8;
const BEEP_S = 0.36;
export const RING_MS = Math.round(ALARM_BEEPS * BEEP_S * 1000);
export const ALARM_CYCLE_MS = RING_MS + 1200;
export const MIN_RINGS = 2;

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

/** Call on a user tap: lets the alarm sound from then on. */
export function wakeAudio(): void {
  audioContext();
}

/** Sound is on: the browser lets the alarm sound. Also true when there is no sound output at all
 *  (nothing a tap could fix). */
export const soundIsOn = (): boolean => !audio || audio.state === 'running';

/** Calls `cb` whenever sound turns on or off. Starts the sound output (it may stay off until a tap). */
export function onSoundChange(cb: () => void): () => void {
  const ctx = audioContext();
  if (!ctx) return () => {};
  ctx.addEventListener('statechange', cb);
  return () => ctx.removeEventListener('statechange', cb);
}

/** Peak loudness of each beep (1 is the maximum). The beeps never overlap, so it never clips. */
export const CHIME_PEAK = 0.8;

/** The Android app's volume switch: full volume while the alarm rings, then back to what it was. */
type Loud = { loud?: (on: boolean) => void };
function setLoud(on: boolean): void {
  try {
    (window as unknown as { TablaAlarm?: Loud }).TablaAlarm?.loud?.(on);
  } catch {
    // not in the app: the browser's own volume applies
  }
}

/** One ring of the siren (high, low, high, low ...), made in the browser (no sound file needed). */
export function ring(): void {
  const ctx = audioContext();
  if (!ctx) return; // No sound available: the screen still flashes.
  try {
    for (let i = 0; i < ALARM_BEEPS; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square'; // harsh and loud, so it cuts through kitchen noise
      o.frequency.value = i % 2 ? 740 : 1040;
      const t = ctx.currentTime + 0.05 + i * BEEP_S;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(CHIME_PEAK, t + 0.02);
      g.gain.setValueAtTime(CHIME_PEAK, t + BEEP_S - 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + BEEP_S - 0.02);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + BEEP_S - 0.01);
      playing.push(o);
    }
  } catch {
    // ignore: the screen still flashes
  }
}

let playing: OscillatorNode[] = [];
let loop: { rings: number; stopping: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;

function tick(): void {
  if (!loop) return;
  if (loop.stopping && loop.rings >= MIN_RINGS) return endAlarm();
  playing = [];
  ring();
  loop.rings++;
  loop.timer = setTimeout(tick, ALARM_CYCLE_MS);
}

function endAlarm(): void {
  if (loop?.timer) clearTimeout(loop.timer);
  loop = null;
  playing.forEach((o) => {
    try {
      o.stop();
    } catch {
      // already stopped
    }
  });
  playing = [];
  setLoud(false);
}

/** Starts ringing over and over (does nothing if already ringing; a pending stop is called off). */
export function startAlarm(): void {
  if (loop) {
    loop.stopping = false;
    return;
  }
  setLoud(true);
  loop = { rings: 0, stopping: false, timer: null };
  tick();
}

/** Stops the ringing: at once if it already rang MIN_RINGS full rings, otherwise after finishing them. */
export function stopAlarm(): void {
  if (!loop) return;
  if (loop.rings > MIN_RINGS) return endAlarm(); // a later ring is playing: cut it off now
  loop.stopping = true;
}

/** How many rings the current alarm has started (0 when quiet). For tests. */
export const alarmRings = (): number => loop?.rings ?? 0;
