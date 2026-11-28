// Keeps an ad video at the same point on every menu TV while it plays.
// Each TV knows when the ad started (shared clock, store.now()), so it knows where the video should be.
// Twice a second it compares: a small gap is closed by playing a little faster or slower (not noticeable),
// a big one by jumping straight to the right point.

import { useEffect, type RefObject } from 'react';
import { store } from '@shared/data';

export const CHECK_EVERY_MS = 500;
/** Closer than this counts as in sync (about one frame). */
export const IN_SYNC_S = 0.02;
/** Further off than this jumps instead of speeding up or slowing down. */
export const JUMP_S = 0.5;
/** Speed changes stay within 5% so the picture and music don't sound off. */
export const MAX_RATE_CHANGE = 0.05;
/** A gap is closed over about this many seconds. */
const CATCH_UP_S = 2;

export type Fix = { rate: number } | { seek: number };

/**
 * What to do with a video that is at `at` seconds when it should be at `want` (both in seconds).
 * `duration` is the video's length; near the start or end nothing is changed.
 */
export function fixFor(at: number, want: number, duration: number): Fix {
  if (!Number.isFinite(want) || want < 0 || !(duration > 0) || want > duration - 0.15) return { rate: 1 };
  const off = at - want; // + ahead, - behind
  if (Math.abs(off) > JUMP_S) return { seek: want };
  if (Math.abs(off) < IN_SYNC_S) return { rate: 1 };
  const change = Math.max(-MAX_RATE_CHANGE, Math.min(MAX_RATE_CHANGE, -off / CATCH_UP_S));
  return { rate: Math.round((1 + change) * 1000) / 1000 };
}

/** Runs the check on a playing ad video that started at `startedAt` (shared clock, ms). */
export function useAdDrift(ref: RefObject<HTMLVideoElement | null>, startedAt: number): void {
  useEffect(() => {
    const t = setInterval(() => {
      const v = ref.current;
      if (!v || v.paused || v.seeking || v.ended || v.readyState < 3) return;
      const fix = fixFor(v.currentTime, (store.now() - startedAt) / 1000, v.duration);
      if ('seek' in fix) {
        v.playbackRate = 1;
        v.currentTime = fix.seek;
      } else if (v.playbackRate !== fix.rate) {
        v.playbackRate = fix.rate;
      }
    }, CHECK_EVERY_MS);
    return () => clearInterval(t);
  }, [ref, startedAt]);
}
