// A double tap on a button that saves and then changes the screen (Mark paid, Mark completed, Delete, Save)
// must not let its second tap land on whatever the new screen shows in the same place: Share to WhatsApp,
// Cancel order, another order's card, or the "Tap to remove" of a two-step button. Saves are quick (at once
// when offline), so the second tap of a double tap arrives after the screen has changed.
//
// A screen's root records every tap with ignoreGuardedTap (its onClickCapture). guardTaps() then starts a short
// quiet time around the last tap: the second tap of a double tap in about the same place during it is dropped.
// Separate taps (a quick tap on another button, or Remove then "Tap to remove") still work.

/** About the longest gap between the two taps of a double tap. */
export const GUARD_MS = 450;
/** How far apart (px) the two taps of a double tap can land. */
export const GUARD_PX = 40;

type Tap = { x: number; y: number };
let last: Tap | null = null;
let guard: (Tap & { until: number }) | null = null;

/** Drop a second tap near the last one for the next GUARD_MS (call it once a save has changed the screen, or a
 *  first tap armed a confirm). */
export function guardTaps(now = performance.now(), ms = GUARD_MS): void {
  if (last) guard = { ...last, until: now + ms };
}

/** True when a tap at (x, y) now is the second tap of a double tap being dropped. */
export function tapGuarded(x: number, y: number, now = performance.now()): boolean {
  return !!guard && now < guard.until && Math.hypot(x - guard.x, y - guard.y) <= GUARD_PX;
}

type TapEvent = { clientX: number; clientY: number; detail?: number; preventDefault(): void; stopPropagation(): void };

/** onClickCapture for a screen's root: notes where each tap lands, and drops a guarded one so nothing under it acts.
 *  Only the second tap of a double tap is dropped: the browser counts it as such (detail 2 or more). Two separate
 *  taps, and a click from the keyboard (detail 0), always work. */
export function ignoreGuardedTap(e: TapEvent, now = performance.now()): void {
  if (!e.detail) return;
  if ((e.detail ?? 1) >= 2 && tapGuarded(e.clientX, e.clientY, now)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  last = { x: e.clientX, y: e.clientY };
}
