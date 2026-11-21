// Pure helpers for the menu TV: what to show and when to look again.
import { loopPosition, loopSlots, pictureFor } from '@shared/clock/loop';
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
  const pos = loopPosition(loopSlots(slots, screenId, screens), now, loop);
  if (!pos) return { key: 'none', slotId: null, pictureId: null, transition: 'fade', nextPictureId: null };
  const pictureId = pictureFor(pos.slot, screenId, screens);
  return {
    key: pos.slot.id + '|' + (pictureId ?? ''),
    slotId: pos.slot.id,
    pictureId,
    transition: pos.slot.transition ?? 'fade',
    nextPictureId: pictureFor(pos.next, screenId, screens),
  };
}

/** Milliseconds until the picture could next change: the end of the current slot,
 *  or a slot dropping out of the loop (Slot.endsAt), whichever is first. */
export function msUntilNextChange(slots: readonly Slot[], loop: LoopAnchor | null, now: number): number {
  let wake = Infinity;
  const pos = loopPosition(slots, now, loop);
  if (pos) wake = pos.endsAt;
  for (const s of slots) if (s.endsAt != null && s.endsAt > now && s.endsAt < wake) wake = s.endsAt;
  if (!Number.isFinite(wake)) return MAX_SLEEP_MS;
  return Math.min(Math.max(wake - now, 0) + MARGIN_MS, MAX_SLEEP_MS);
}
