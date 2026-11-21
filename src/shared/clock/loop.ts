// The shared clock: which slot every menu TV should show right now.
// Every TV computes this from the same shared time, the same slot list and the same loop
// anchor, so all four change together without talking to each other, and a TV that
// restarts lands straight on the right slot. Pure functions only, fully tested.

import type { LoopAnchor, Screen, ScreenId, Slot } from '../data/types';

/** Slots that should be playing at `now`, in play order. */
export function activeSlots(slots: readonly Slot[], now: number): Slot[] {
  return slots
    .filter((s) => s.seconds > 0 && (s.endsAt == null || s.endsAt > now))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export interface LoopPosition {
  index: number;
  slot: Slot;
  /** Shared-clock time this slot started and ends. */
  startedAt: number;
  endsAt: number;
  next: Slot;
}

/**
 * Where the loop is at `now`.
 * The loop is counted from `loop.anchor` (time 0 if there is none). When the manager changes
 * the loop it resets the anchor (restartLoop), so the change shows at once instead of
 * mid-picture, starting with `loop.firstSlotId` if given. Any two devices with the same clock,
 * slots and anchor agree exactly. Returns null when nothing is playing.
 */
export function loopPosition(slots: readonly Slot[], now: number, loop?: LoopAnchor | null): LoopPosition | null {
  let list = activeSlots(slots, now);
  if (!list.length) return null;
  const first = loop?.firstSlotId ? list.findIndex((s) => s.id === loop.firstSlotId) : -1;
  if (first > 0) list = [...list.slice(first), ...list.slice(0, first)];
  // A special that just ended shortens the loop; counting from the end time (when it is later than the
  // anchor) restarts the loop there, so TVs don't jump mid-picture. Same on every device.
  let anchor = loop?.anchor ?? 0;
  for (const s of slots) if (s.seconds > 0 && s.endsAt != null && s.endsAt <= now && s.endsAt > anchor) anchor = s.endsAt;
  const lengths = list.map((s) => Math.round(s.seconds * 1000));
  const total = lengths.reduce((a, b) => a + b, 0);
  const elapsed = now - anchor;
  const into = ((elapsed % total) + total) % total;
  const cycleStart = now - into;
  let acc = 0;
  for (let i = 0; i < list.length; i++) {
    if (into < acc + lengths[i]) {
      return {
        index: i,
        slot: list[i],
        startedAt: cycleStart + acc,
        endsAt: cycleStart + acc + lengths[i],
        next: list[(i + 1) % list.length],
      };
    }
    acc += lengths[i];
  }
  return null; // unreachable: `into` is always below `total`
}

/** The two TVs that stand together, by side. TV 3 and TV 4 normally mirror TV 1 and TV 2. */
export const PARTNER: Partial<Record<ScreenId, ScreenId>> = { tv1: 'tv2', tv2: 'tv1', tv3: 'tv4', tv4: 'tv3' };
/** The main TV that TV 3 / TV 4 follow (mirror, or fall back to when they have no picture of their own). */
export const MAIN_OF: Partial<Record<ScreenId, ScreenId>> = { tv3: 'tv1', tv4: 'tv2' };

const mirrors = (screenId: ScreenId, screens: readonly Screen[]) => !!screens.find((x) => x.id === screenId)?.mirrorOf;

/** The screens whose pictures this screen may show, in order of preference (not counting the partner).
 *  TV 1 / TV 2: only their own. TV 3 / TV 4 when mirroring: their main TV's. When not mirroring:
 *  their own picture, else their main TV's, so their own pictures replace TV 1 / TV 2's on that TV only. */
export function pictureSources(screenId: ScreenId, screens: readonly Screen[]): ScreenId[] {
  const main = MAIN_OF[screenId];
  if (!main) return [screenId];
  return mirrors(screenId, screens) ? [main] : [screenId, main];
}

/**
 * The slots in this screen's loop. TV 1 and TV 2 play only spots with a TV 1 or TV 2 picture, so a
 * picture added to TV 3 / TV 4 never blanks them. TV 3 and TV 4 play those same spots plus spots with
 * a picture of their own (when not mirroring). Both TVs of a pair always get the same list, so a pair
 * stays in step; with TV 3 / TV 4 mirroring, all four TVs get the same list.
 */
export function loopSlots<T extends Slot>(slots: readonly T[], screenId: ScreenId, screens: readonly Screen[]): T[] {
  const ids: ScreenId[] = ['tv1', 'tv2'];
  if (screenId === 'tv3' || screenId === 'tv4') for (const tv of ['tv3', 'tv4'] as const) if (!mirrors(tv, screens)) ids.push(tv);
  return slots.filter((s) => ids.some((id) => s.pictures?.[id]));
}

/**
 * The picture a screen shows in a slot:
 * 1. its own picture (TV 3 / TV 4: see pictureSources), else
 * 2. for special and catering slots only: its partner's picture, so one picture fills both
 *    TVs of a pair. Menu slots never borrow: a menu picture added to TV 1 stays on TV 1.
 * 3. otherwise null (the screen shows its idle look).
 */
export function pictureFor(slot: Slot, screenId: ScreenId, screens: readonly Screen[]): string | null {
  const first = (ids: ScreenId[]) => ids.map((id) => slot.pictures[id]).find(Boolean) ?? null;
  const own = first(pictureSources(screenId, screens));
  if (own) return own;
  if ((slot.kind ?? 'menu') === 'menu') return null;
  const partner = PARTNER[screenId];
  return partner ? first(pictureSources(partner, screens)) : null;
}
