// Pure helpers for the menu TV: what to show and when to look again.
import { loopPosition, loopSlots, pictureFor, streamSlots } from '@shared/clock/loop';
import type { LoopAnchor, Screen, ScreenId, Slot, Transition } from '@shared/data';

/** Small margin after a boundary so the timer never wakes a hair too early. */
const MARGIN_MS = 5;
/** Never sleep longer than this, so a corrected shared clock is picked up. */
const MAX_SLEEP_MS = 30_000;

export interface Target {
  /** Changes whenever the TV must switch: a new slot or a new picture. */
  key: string;
  slotId: string | null;
  pictureId: string | null;
  transition: Transition;
  /** The picture the next slot will need, to load ahead of time. */
  nextPictureId: string | null;
}

/** What this TV should show at `now`. */
export function targetFor(
  slots: readonly Slot[],
  screens: readonly Screen[],
  loop: LoopAnchor | null,
  screenId: ScreenId,
  now: number,
): Target {
  const mine = loopSlots(slots, screenId, screens);
  const pos = loopPosition(mine, now, loop);
  if (!pos) return { key: 'none', slotId: null, pictureId: null, transition: 'fade', nextPictureId: null };
  // Ads that play by rounds or minutes are not in the list order: a menu spot with nothing for this TV
  // repeats its own next menu picture, never an ad's still.
  const order = streamSlots(mine, now);
  const pictureId = shownIn(pos.slot, order, screenId, screens);
  return {
    key: pos.slot.id + '|' + (pictureId ?? ''),
    slotId: pos.slot.id,
    pictureId,
    transition: pos.slot.transition ?? 'fade',
    nextPictureId: shownIn(pos.next, order, screenId, screens),
  };
}

/**
 * The picture this TV shows in a slot. When one TV of a pair has fewer pictures than the other (a menu spot
 * with nothing for this TV), it shows its own next picture in play order again instead of the name screen.
 * It never borrows the partner's menu picture. Null only when this TV has no picture anywhere in the loop.
 */
export function shownIn(slot: Slot, order: readonly Slot[], screenId: ScreenId, screens: readonly Screen[]): string | null {
  const own = pictureFor(slot, screenId, screens);
  if (own) return own;
  const at = order.findIndex((s) => s.id === slot.id);
  if (at < 0) return null;
  for (let step = 1; step < order.length; step++) {
    const pic = pictureFor(order[(at + step) % order.length], screenId, screens);
    if (pic) return pic;
  }
  return null;
}

/** Milliseconds until the picture could next change: the end of the current slot (which includes the daily
 *  4 AM restart and ads by rounds or minutes), or a slot dropping out of the loop (Slot.endsAt), whichever is first. */
export function msUntilNextChange(slots: readonly Slot[], loop: LoopAnchor | null, now: number): number {
  let wake = Infinity;
  const pos = loopPosition(slots, now, loop);
  if (pos) wake = pos.endsAt;
  for (const s of slots) if (s.endsAt != null && s.endsAt > now && s.endsAt < wake) wake = s.endsAt;
  if (!Number.isFinite(wake)) return MAX_SLEEP_MS;
  return Math.min(Math.max(wake - now, 0) + MARGIN_MS, MAX_SLEEP_MS);
}
