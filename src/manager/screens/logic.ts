// Pure helpers for the Screens tab (no React, no store). Tested in logic.test.ts.
import type { Screen, ScreenId, Slot, Transition } from '@shared/data/types';

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
