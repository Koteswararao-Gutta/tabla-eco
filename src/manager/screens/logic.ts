// Pure helpers for the Screens tab (no React, no store). Tested in logic.test.ts.
import { ADS_CODE_VERSION, type AdEvery, type Heartbeat, type Picture, type Screen, type ScreenId, type Slot, type Transition } from '@shared/data/types';
import { EVERY_MAX } from '@shared/clock/loop';

/** Slots in play order (same tie-break as activeSlots in @shared/clock/loop). Includes ended slots. */
export function sortSlots<T extends Slot>(slots: readonly T[]): T[] {
  return [...slots].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Order for a new slot placed right after `afterIndex` in `sorted` (-1 = at the start). */
export function insertOrder(sorted: readonly Slot[], afterIndex: number): number {
  if (!sorted.length) return 1;
  if (afterIndex < 0) return sorted[0].order - 1;
  const a = sorted[Math.min(afterIndex, sorted.length - 1)].order;
  const next = sorted[afterIndex + 1];
  return next ? (a + next.order) / 2 : a + 1;
}

/** The slots whose order changes when the slot at `index` moves one step up (-1) or down (+1).
 *  Renumbers 1..n so ties and fractions never pile up. Empty when the move is not possible. */
export function moveSlot<T extends Slot>(sorted: readonly T[], index: number, dir: -1 | 1): T[] {
  return moveSlotTo(sorted, index, index + dir);
}

/** Moves one slot to position `to` (0 = top). Returns only the slots whose order changed, with new orders 1..n. */
export function moveSlotTo<T extends Slot>(sorted: readonly T[], index: number, to: number): T[] {
  if (index < 0 || index >= sorted.length || to < 0 || to >= sorted.length || to === index) return [];
  const list = [...sorted];
  const [moved] = list.splice(index, 1);
  list.splice(to, 0, moved);
  return list.flatMap((s, i) => (s.order !== i + 1 ? [{ ...s, order: i + 1 }] : []));
}

/** The slot without this TV's picture, or null when no pictures are left (delete the slot). */
export function withoutPicture<T extends Slot>(slot: T, tv: ScreenId): T | null {
  const pictures = { ...slot.pictures };
  delete pictures[tv];
  return Object.values(pictures).some(Boolean) ? { ...slot, pictures } : null;
}

/** Is this picture still shown anywhere: in any slot, or in the TV 5 catering clip? */
export function pictureInUse(id: string, slots: readonly Pick<Slot, 'pictures'>[], clipPictures: readonly string[] = []): boolean {
  return clipPictures.includes(id) || slots.some((s) => Object.values(s.pictures).includes(id));
}

/** Plain warnings for a picture that will not look right on a 16:9 TV. Empty when it is fine. */
export function pictureWarnings(width: number, height: number): string[] {
  if (!(width > 0 && height > 0)) return [];
  const out: string[] = [];
  const aspect = width / height;
  if (aspect < 1.2) out.push('This picture is tall, so the TV will show black bars at the sides.');
  else if (aspect > 2.4) out.push('This picture is very wide, so the TV will show black bars above and below.');
  if (width < 960) out.push('This picture is small and may look blurry on the TV.');
  return out;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sun 9 PM", "Sun 9:30 PM", or "Nov 30 9 PM" when more than 6 days away. */
export function formatWhen(ms: number, now: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const time = `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
  const far = Math.abs(ms - now) > 6 * 86_400_000;
  return `${far ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : DAYS[d.getDay()]} ${time}`;
}

const TRANSITION_LABEL: Record<Transition, string> = { fade: 'Fade', slide: 'Slide', none: 'No transition' };
export const TRANSITIONS: { value: Transition; label: string }[] = [
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'none', label: 'None' },
];

/** The small line under a picture: "Fade · 10 s · until Sun 9 PM". */
export function slotLine(slot: Slot, now: number): string {
  const parts = [TRANSITION_LABEL[slot.transition] ?? 'Fade', `${slot.seconds} s`];
  if (slot.endsAt != null) parts.push(`${slot.endsAt > now ? 'until' : 'ended'} ${formatWhen(slot.endsAt, now)}`);
  return parts.join(' · ');
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Parses a datetime-local value as local time; null when empty or invalid. */
export function fromLocalInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Whole seconds between 1 and 3600, or null. */
export function parseSeconds(v: string): number | null {
  if (!/^\s*\d+\s*$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 3600 ? n : null;
}

export const isPin = (v: string): boolean => /^\d{4}$/.test(v);

/** The short line on a home tile. */
export function tileLine(screen: Pick<Screen, 'id' | 'mirrorOf'>): string {
  switch (screen.id) {
    case 'tv1': return 'Left side';
    case 'tv2': return 'Right side';
    case 'tv3':
    case 'tv4': return screen.mirrorOf ? `Mirrors ${screenName(screen.mirrorOf)}` : 'Own pictures';
    case 'tv5': return 'Music';
    case 'kitchen': return 'Tablet';
  }
}

export const SCREEN_IDS: ScreenId[] = ['tv1', 'tv2', 'tv3', 'tv4', 'tv5', 'kitchen'];
export const screenName = (id: ScreenId): string => (id === 'kitchen' ? 'Kitchen' : 'TV ' + id.slice(2));
/** TV 3 mirrors TV 1 and TV 4 mirrors TV 2 when mirroring is on. */
export const MIRROR_SOURCE: Partial<Record<ScreenId, ScreenId>> = { tv3: 'tv1', tv4: 'tv2' };

// ---------- ads ----------

/** Ads are slots of kind 'catering' (shown as "Ad"; the stored name stays for older TVs and the rules). */
export const isAd = (s: Pick<Slot, 'kind'>): boolean => (s.kind ?? 'menu') === 'catering';

/** The pictures of this slot that carry an ad video, TV 1's first. */
export function adVideos<P extends Pick<Picture, 'video'> & { id: string }>(s: Pick<Slot, 'pictures'>, pictures: readonly P[]): P[] {
  const ids = (['tv1', 'tv2', 'tv3', 'tv4'] as const).map((tv) => s.pictures[tv]).filter((id): id is string => !!id);
  return [...new Set(ids)].flatMap((id) => pictures.filter((p) => p.id === id && !!p.video));
}

/** True for an ad that plays videos (it then gets the ad sheet, never the picture sheets that could delete it). */
export const isVideoAd = (s: Pick<Slot, 'kind' | 'pictures'>, pictures: readonly (Pick<Picture, 'video'> & { id: string })[]): boolean =>
  isAd(s) && adVideos(s, pictures).length > 0;

/** "after every round", "after every 3 rounds", "every 2 min", or "once every round, in its place" (the old way). */
export function everyLabel(every: AdEvery | null | undefined): string {
  if (!every) return 'once every round, in its place';
  if (every.by === 'rounds') return every.n === 1 ? 'after every round' : `after every ${every.n} rounds`;
  return every.n === 1 ? 'every minute' : `every ${every.n} min`;
}

/** A pause takes effect at the next picture change, so an ad whose end is this close already counts as paused. */
export const PAUSE_SOON_MS = 60_000;
export const isPaused = (slot: Pick<Slot, 'endsAt'>, now: number): boolean => slot.endsAt != null && slot.endsAt <= now + PAUSE_SOON_MS;

/** The line under an ad: "15 s · every 2 min", "Paused", "15 s · after every round · until Sun 9 PM". */
export function adLine(slot: Pick<Slot, 'seconds' | 'endsAt' | 'every'>, now: number): string {
  if (isPaused(slot, now)) return 'Paused';
  const parts = [`${slot.seconds} s`, everyLabel(slot.every)];
  if (slot.endsAt != null) parts.push(`until ${formatWhen(slot.endsAt, now)}`);
  return parts.join(' · ');
}

const MENU_TVS: ScreenId[] = ['tv1', 'tv2', 'tv3', 'tv4'];
/** A TV that hasn't reported in for this long (unplugged) doesn't hold "How often" back. */
export const STALE_BEAT_MS = 26 * 3_600_000;

/** Menu TVs still on older code ("TV 3"), from the heartbeats; empty when every menu TV can play ads by rounds or
 *  minutes. A TV never seen, or not seen for 26 hours, doesn't count. */
export function tvsOnOldCode(beats: readonly (Pick<Heartbeat, 'lastSeen' | 'version'> & { id: string })[], now: number): string[] {
  return MENU_TVS.filter((tv) => {
    const b = beats.find((x) => x.id === tv);
    if (!b || !(now - b.lastSeen < STALE_BEAT_MS)) return false;
    return !(typeof b.version === 'number' && b.version >= ADS_CODE_VERSION);
  }).map(screenName);
}

/** Seconds for an ad from its video length(s): never cuts a video short. */
export const adSeconds = (...durations: number[]): number => Math.max(1, Math.ceil(Math.max(...durations) - 0.1));

/** Smallest "How often" value the app offers: rounds from 1, minutes from 2. */
export const EVERY_MIN: Record<AdEvery['by'], number> = { rounds: 1, minutes: 2 };

/** A whole number in range for "How often", or null. */
export function parseEvery(by: AdEvery['by'], v: string): AdEvery | null {
  if (!/^\s*\d+\s*$/.test(v)) return null;
  const n = Number(v);
  return n >= EVERY_MIN[by] && n <= EVERY_MAX[by] ? { by, n } : null;
}

/** A plain problem with "every N minutes" for an ad this long (at least a minute of menu between ads), or null. */
export function everyProblem(every: AdEvery | null, adSecs: number): string | null {
  if (!every || every.by !== 'minutes' || !(adSecs > 0)) return null;
  if (every.n * 60 >= adSecs + 60) return null;
  return `Every ${every.n} minutes is too often for a ${adSecs} s ad. Choose ${Math.ceil((adSecs + 60) / 60)} minutes or more.`;
}

/** About how much of the screen time the ad takes, in whole percent (at least 1). */
export function adShare(every: AdEvery, adSecs: number, roundSeconds: number): number {
  const between = every.by === 'rounds' ? every.n * roundSeconds : every.n * 60 - adSecs;
  const total = between + adSecs;
  return total > 0 ? Math.max(1, Math.round((adSecs / total) * 100)) : 100;
}

/** "About every 1½ min" for "after every N rounds", from the length of one menu round in seconds. */
export function roundsHint(n: number, roundSeconds: number): string {
  if (!(roundSeconds > 0)) return '';
  const s = n * roundSeconds;
  if (s < 90) return `One round of the menu is now ${roundSeconds} s, so about every ${Math.round(s)} s.`;
  const min = Math.round(s / 30) / 2;
  const text = Number.isInteger(min) ? String(min) : `${Math.floor(min) || ''}½`;
  return `One round of the menu is now ${roundSeconds} s, so about every ${text} min.`;
}
