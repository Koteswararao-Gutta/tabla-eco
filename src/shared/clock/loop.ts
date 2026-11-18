// The shared clock: which slot every menu TV should show right now.
// Every TV computes this from the same shared time and the same slot list,
// so all four change together without talking to each other, and a TV that
// restarts lands straight on the right slot. Pure functions only, fully tested.

import type { Screen, ScreenId, Slot } from '../data/types';

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
 * Where the loop is at `now`. The loop is anchored to time 0 (the Unix epoch),
 * so any two devices with the same clock and the same slots agree exactly.
 * Returns null when nothing is playing.
 */
export function loopPosition(slots: readonly Slot[], now: number): LoopPosition | null {
  const list = activeSlots(slots, now);
  if (!list.length) return null;
  const lengths = list.map((s) => Math.round(s.seconds * 1000));
  const total = lengths.reduce((a, b) => a + b, 0);
  const into = ((now % total) + total) % total;
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
  // Unreachable: `into` is always below `total`.
  return null;
}

/** The two TVs that stand together, by side. TV 3 and TV 4 normally mirror TV 1 and TV 2. */
export const PARTNER: Partial<Record<ScreenId, ScreenId>> = { tv1: 'tv2', tv2: 'tv1', tv3: 'tv4', tv4: 'tv3' };

/** The screen whose pictures this screen shows (follows mirrorOf, one level). */
export function sourceScreen(screenId: ScreenId, screens: readonly Screen[]): ScreenId {
  const s = screens.find((x) => x.id === screenId);
  return s?.mirrorOf ?? screenId;
}

/**
 * The picture a screen shows in a slot:
 * 1. its own picture (or its mirror source's), else
 * 2. its partner's picture, so one picture added for a special fills both TVs of a pair, else
 * 3. null (the screen shows its idle look).
 */
export function pictureFor(slot: Slot, screenId: ScreenId, screens: readonly Screen[]): string | null {
  const src = sourceScreen(screenId, screens);
  const own = slot.pictures[src];
  if (own) return own;
  const partner = PARTNER[src];
  return (partner && slot.pictures[partner]) || null;
}
