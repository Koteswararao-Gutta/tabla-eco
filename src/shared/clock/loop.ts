// The shared clock: which slot every menu TV should show right now.
// Every TV computes this from the same shared time, the same slot list and the same loop
// anchor, so all four change together without talking to each other, and a TV that
// restarts lands straight on the right slot. Pure functions only, fully tested.

import type { AdEvery, LoopAnchor, Screen, ScreenId, Slot } from '../data/types';

/** Slots that should be playing at `now`, in play order. */
export function activeSlots<T extends Slot>(slots: readonly T[], now: number): T[] {
  return slots
    .filter((s) => s.seconds > 0 && (s.endsAt == null || s.endsAt > now))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export interface LoopPosition {
  /** Position in the menu list; -1 for an ad that plays by rounds or minutes (Slot.every). */
  index: number;
  slot: Slot;
  /** Shared-clock time this slot started and ends. */
  startedAt: number;
  endsAt: number;
  /** What plays after this (to load ahead of time). */
  next: Slot;
}

/**
 * Where the loop is at `now` when no ad plays by rounds or minutes (the way every TV worked before ads had
 * Slot.every; older TV code computes exactly this, so it must never change). Exported for tests.
 * The loop is counted from `loop.anchor` (time 0 if there is none). When the manager changes
 * the loop it resets the anchor (restartLoop), so the change shows at once instead of
 * mid-picture, starting with `loop.firstSlotId` if given. Any two devices with the same clock,
 * slots and anchor agree exactly. Returns null when nothing is playing.
 */
export function plainPosition(slots: readonly Slot[], now: number, loop?: LoopAnchor | null): LoopPosition | null {
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

const DAY = 86_400_000;
/** Hour (Arizona time) at which the menu loop starts fresh each day, when the TVs reload anyway. */
export const DAILY_RESTART_HOUR = 4;
/** Arizona keeps UTC-7 all year (no daylight saving), so a fixed offset gives the same answer on every device. */
const AZ_OFFSET = -7 * 3_600_000;

/** The latest 4:00 AM Arizona time at or before `now`. */
export function lastDailyRestart(now: number): number {
  const at = DAILY_RESTART_HOUR * 3_600_000;
  return Math.floor((now + AZ_OFFSET - at) / DAY) * DAY + at - AZ_OFFSET;
}

/** Limits for Slot.every.n. */
export const EVERY_MAX: Record<AdEvery['by'], number> = { rounds: 20, minutes: 120 };

/** How often an ad plays, or null: a menu or special slot, an old-style ad (plays in its place every round), or a
 *  value that makes no sense (never allowed to break a TV). */
export function adEvery(s: Slot): AdEvery | null {
  if ((s.kind ?? 'menu') !== 'catering') return null;
  const e = s.every as Partial<AdEvery> | null | undefined;
  if (!e || typeof e !== 'object' || (e.by !== 'rounds' && e.by !== 'minutes')) return null;
  const n = e.n;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > EVERY_MAX[e.by]) return null;
  return { by: e.by, n };
}

/** Slots that play in list order (everything except ads with a frequency), active at `now`, in play order. */
export function streamSlots<T extends Slot>(slots: readonly T[], now: number): T[] {
  return activeSlots(
    slots.filter((s) => !adEvery(s)),
    now,
  );
}

/** A slot's length in whole ms; under 1 ms counts as not playing (it could never move the walk on). */
const lengthMs = (s: Slot) => Math.round(s.seconds * 1000);
const isLive = (s: Slot, t: number) => s.seconds > 0 && lengthMs(s) >= 1 && (s.endsAt == null || s.endsAt > t);
/** Backstop: more steps than this in one walk means something is wrong; the plain loop is used instead. */
const MAX_STEPS = 200_000;

/**
 * Where the loop is at `now`. Without ads that play by rounds or minutes this is the plain loop (above), the same
 * as older TV code. With them, the loop is walked from its start (the anchor, at most one day back, see
 * walkPosition). Any two devices with the same clock, slots and anchor agree exactly. Null when nothing plays.
 */
export function loopPosition(slots: readonly Slot[], now: number, loop?: LoopAnchor | null): LoopPosition | null {
  return slots.some((s) => adEvery(s) && isLive(s, now)) ? walkPosition(slots, now, loop) : plainPosition(slots, now, loop);
}

interface AdState {
  slot: Slot;
  every: AdEvery;
  /** rounds: the round count at which it is next due. */
  nextRound: number;
  /** rounds: the break at which it became due (to play the one waiting longest first). */
  dueSince: number | null;
  /** minutes: the next time on its grid (anchor + k * n minutes). */
  nextDue: number;
}
interface WalkState {
  t: number;
  i: number;
  rounds: number;
  lastWasAd: boolean;
  ads: AdState[];
}
interface Item {
  slot: Slot;
  index: number;
  start: number;
  end: number;
}

const cloneState = (w: WalkState): WalkState => ({ ...w, ads: w.ads.map((a) => ({ ...a })) });

/** One step of the walk: the item that starts at w.t (and moves w past it). */
function step(w: WalkState, stream: readonly Slot[], anchor: number, dayEnd: number): Item {
  const t = w.t;
  let pick: AdState | null = null;
  if (!w.lastWasAd) {
    let pickSince = Infinity;
    for (const a of w.ads) {
      if (a.slot.endsAt != null && a.slot.endsAt <= t) continue;
      let since: number | null = null;
      if (a.every.by === 'rounds') {
        if (w.rounds >= a.nextRound) {
          if (a.dueSince == null) a.dueSince = t;
          since = a.dueSince;
        }
      } else if (t >= a.nextDue) since = a.nextDue;
      // The one waiting longest plays first; ties go to the list order (ads are sorted by order, then id).
      if (since != null && since < pickSince) {
        pick = a;
        pickSince = since;
      }
    }
  }
  if (pick) {
    const end = Math.min(t + Math.round(pick.slot.seconds * 1000), dayEnd);
    if (pick.every.by === 'rounds') {
      pick.nextRound = w.rounds + pick.every.n;
      pick.dueSince = null;
    } else {
      // A fixed grid from the anchor; grid points missed while another ad played are skipped, never stacked.
      const T = pick.every.n * 60_000;
      pick.nextDue = anchor + (Math.floor((t - anchor) / T) + 1) * T;
    }
    w.t = end;
    w.lastWasAd = true;
    return { slot: pick.slot, index: -1, start: t, end };
  }
  const index = w.i;
  const slot = stream[index];
  const end = Math.min(t + Math.round(slot.seconds * 1000), dayEnd);
  w.i = index + 1;
  if (w.i >= stream.length) {
    w.i = 0;
    w.rounds++;
  }
  w.lastWasAd = false;
  w.t = end;
  return { slot, index, start: t, end };
}

/** The last walk, so a TV asking again a moment later goes on from there instead of walking the whole day. */
let walkCache: { key: string; at: Item; state: WalkState } | null = null;

/**
 * The loop with ads that play by rounds or minutes:
 * - Menu pictures play in list order. An ad plays BETWEEN two pictures, on every TV at once; after it the menu goes
 *   on with the next picture (it never restarts). Rounds are counted by the menu, not by ads.
 * - "After every N rounds": at the end of every N-th pass of the menu list. "Every N minutes": at the first picture
 *   change at or after anchor + N, 2N, ... minutes.
 * - At most one ad per break, never two in a row: when two are due, the one waiting longest plays first and the
 *   other after one menu picture.
 * - "Stop after" on such an ad needs no restart: from that break on it is simply no longer picked.
 * - The walk starts at the latest of the loop anchor, 4:00 AM Arizona time today, and the end of a menu picture's
 *   "stop after"; every item ends by the next 4:00 AM, so all TVs start the day together and a walk covers one day.
 */
/** `inner`: only the item is wanted (the first item of the next day, as `next`); never looks further, so a slot
 *  a day or longer can't make it call itself without end. */
function walkPosition(slots: readonly Slot[], nowIn: number, loop?: LoopAnchor | null, inner = false): LoopPosition | null {
  let stream = streamSlots(slots, nowIn).filter((s) => lengthMs(s) >= 1);
  const first = loop?.firstSlotId ? stream.findIndex((s) => s.id === loop.firstSlotId) : -1;
  if (first > 0) stream = [...stream.slice(first), ...stream.slice(0, first)];
  // The day is taken from the later of this TV's time and the anchor: a TV clock a moment behind a phone that
  // restarted the loop just after 4 AM must not count from the day before (the walk would never end).
  const dayStart = lastDailyRestart(Math.max(nowIn, loop?.anchor ?? 0));
  let anchor = Math.max(loop?.anchor ?? 0, dayStart);
  for (const s of slots) if (s.seconds > 0 && !adEvery(s) && s.endsAt != null && s.endsAt <= nowIn && s.endsAt > anchor) anchor = s.endsAt;
  // A TV clock a moment behind the phone's: show the first item a moment early.
  const now = Math.max(nowIn, anchor);
  const dayEnd = dayStart + DAY;
  const ads = slots
    .filter((s) => s.seconds > 0 && lengthMs(s) >= 1 && adEvery(s))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  if (!stream.length) {
    return plainPosition(
      ads.filter((s) => isLive(s, now)),
      now,
      { anchor, firstSlotId: loop?.firstSlotId ?? null },
    );
  }
  const key = JSON.stringify([
    anchor,
    loop?.firstSlotId ?? null,
    stream.map((s) => [s.id, s.seconds, s.pictures, s.transition ?? null, s.kind ?? null]),
    ads.map((s) => [s.id, s.seconds, s.every, s.endsAt ?? null, s.order, s.pictures, s.transition ?? null]),
  ]);

  let w: WalkState;
  let item: Item;
  if (walkCache && walkCache.key === key && now >= walkCache.at.start) {
    w = cloneState(walkCache.state);
    item = walkCache.at;
  } else {
    w = {
      t: anchor,
      i: 0,
      rounds: 0,
      lastWasAd: false,
      ads: ads.map((slot) => {
        const every = adEvery(slot)!;
        return { slot, every, nextRound: every.n, dueSince: null, nextDue: anchor + every.n * 60_000 };
      }),
    };
    // Just added or changed (restartLoop(adId)): the ad shows first, and counts as played.
    const firstAd = anchor === (loop?.anchor ?? 0) && loop?.firstSlotId ? w.ads.find((a) => a.slot.id === loop.firstSlotId && isLive(a.slot, anchor)) : undefined;
    if (firstAd) {
      const end = Math.min(anchor + Math.round(firstAd.slot.seconds * 1000), dayEnd);
      w.t = end;
      w.lastWasAd = true;
      item = { slot: firstAd.slot, index: -1, start: anchor, end };
    } else {
      item = step(w, stream, anchor, dayEnd);
    }
  }
  // Walk to the item that holds `now`. `w` is always the state just after `item`. Every step moves time on (items
  // are at least 1 ms and end by `dayEnd`, which is after `now`); the step cap only guards against a mistake.
  let steps = 0;
  while (item.end <= now) {
    const prev = item.end;
    item = step(w, stream, anchor, dayEnd);
    if (item.end <= prev || ++steps > MAX_STEPS) {
      walkCache = null;
      return plainPosition(slots, nowIn, loop);
    }
  }
  if (inner) return { index: item.index, slot: item.slot, startedAt: item.start, endsAt: item.end, next: item.slot };
  walkCache = { key, at: item, state: cloneState(w) };
  let next: Slot;
  if (item.end >= dayEnd) {
    const live = slots.some((s) => adEvery(s) && isLive(s, dayEnd));
    next = (live ? walkPosition(slots, dayEnd, loop, true) : plainPosition(slots, dayEnd, loop))?.slot ?? item.slot;
  } else {
    next = step(cloneState(w), stream, anchor, dayEnd).slot;
  }
  return { index: item.index, slot: item.slot, startedAt: item.start, endsAt: item.end, next };
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
