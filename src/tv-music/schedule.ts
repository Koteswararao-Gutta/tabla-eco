// Pure decisions for TV 5: settings defaults, when the catering clip plays, what plays after it,
// which video to skip to after an error, and when to fall back to the clip loop.
// No React, no YouTube, no clock: callers pass `now` in.

import type { MusicSettings } from '@shared/data';
import { parsePlaylistId } from './playlist';

export const DEFAULT_MUSIC: MusicSettings = {
  playlist: '',
  shuffle: true,
  clipMode: 'afterEachSong',
  everySeconds: 300,
  clipSeconds: 8,
  clipPictures: [],
  clipTitle: 'We do catering',
  clipLine: '',
};

export const CLIP_SECONDS = { min: 3, max: 120 };
export const EVERY_SECONDS = { min: 5, max: 24 * 3600 };

export interface MusicPlan {
  playlistId: string | null;
  shuffle: boolean;
  clipMode: MusicSettings['clipMode'];
  everyMs: number;
  clipMs: number;
  pictures: string[];
  title: string;
  line: string;
}

const num = (v: unknown, fallback: number, lo: number, hi: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

/** Settings as stored (possibly null or half-filled) → a complete, safe plan. */
export function planFrom(m: Partial<MusicSettings> | null | undefined): MusicPlan {
  const s = m ?? {};
  return {
    playlistId: parsePlaylistId(str(s.playlist, '')),
    shuffle: typeof s.shuffle === 'boolean' ? s.shuffle : DEFAULT_MUSIC.shuffle,
    clipMode: s.clipMode === 'everySeconds' ? 'everySeconds' : 'afterEachSong',
    everyMs: num(s.everySeconds, DEFAULT_MUSIC.everySeconds, EVERY_SECONDS.min, EVERY_SECONDS.max) * 1000,
    clipMs: num(s.clipSeconds, DEFAULT_MUSIC.clipSeconds, CLIP_SECONDS.min, CLIP_SECONDS.max) * 1000,
    pictures: Array.isArray(s.clipPictures) ? s.clipPictures.filter((p): p is string => typeof p === 'string' && !!p) : [],
    title: str(s.clipTitle, DEFAULT_MUSIC.clipTitle).trim(),
    line: str(s.clipLine, '').trim(),
  };
}

/** Shortest time one clip picture stays up, so each cross-fade (about 1 s) can finish. */
export const CLIP_PICTURE_MIN_MS = 2500;

/** How long each of `count` clip pictures stays up: the clip length shared out, never too short. */
export function clipEachMs(count: number, clipMs: number): number {
  if (count <= 1) return clipMs;
  return Math.max(CLIP_PICTURE_MIN_MS, Math.round(clipMs / count));
}

/** A video just ended: show the clip first, or let the playlist go on. */
export function onVideoEnded(plan: Pick<MusicPlan, 'clipMode'>): 'clip' | 'continue' {
  return plan.clipMode === 'afterEachSong' ? 'clip' : 'continue';
}

/** 'everySeconds' mode: is the clip due? `since` is when video last started counting (start or last clip end). */
export function clipDue(plan: Pick<MusicPlan, 'clipMode' | 'everyMs'>, now: number, since: number | null): boolean {
  return plan.clipMode === 'everySeconds' && since !== null && now - since >= plan.everyMs;
}

/** When the clip is over: start the next video, or carry on with the one that was paused.
 *  After an 'ended' clip the player may already have moved on by itself; then just play it. */
export function afterClip(cause: 'ended' | 'timer', endedIndex: number | null, currentIndex: number): 'next' | 'resume' {
  if (cause === 'timer') return 'resume';
  return endedIndex === null || currentIndex === endedIndex || currentIndex < 0 ? 'next' : 'resume';
}

/** Next index after `current` that hasn't failed, wrapping around; -1 if every video failed. */
export function nextPlayable(count: number, current: number, failed: ReadonlySet<number>): number {
  if (count <= 0) return -1;
  for (let step = 1; step <= count; step++) {
    const i = (((current + step) % count) + count) % count;
    if (!failed.has(i)) return i;
  }
  return -1;
}

/** Where to start the playlist. `rand` in [0, 1). */
export function startIndex(count: number, shuffle: boolean, rand: number): number {
  if (count <= 0 || !shuffle) return 0;
  return Math.min(count - 1, Math.floor(rand * count));
}

export const STALL_MS = 20_000;

/** Video mode: has the player gone `limitMs` without playing? (a spinner with no error event) */
export function stalled(lastPlayingAt: number, now: number, limitMs = STALL_MS): boolean {
  return now - lastPlayingAt >= limitMs;
}

export type Fallback ='noPlaylist' | 'offline' | 'apiFailed' | 'allFailed';
export type Mode = 'connecting' | 'video' | 'clip' | 'fallback';

/** What the screen shows. A fallback always wins: never a YouTube error or a blank page. */
export function screenMode(s: {
  hasPlaylist: boolean;
  online: boolean;
  apiFailed: boolean;
  allFailed: boolean;
  inClip: boolean;
  started: boolean;
}): { mode: Mode; reason: Fallback | null } {
  const reason: Fallback | null = !s.hasPlaylist ? 'noPlaylist' : !s.online ? 'offline' : s.apiFailed ? 'apiFailed' : s.allFailed ? 'allFailed' : null;
  if (reason) return { mode: 'fallback', reason };
  if (s.inClip) return { mode: 'clip', reason: null };
  return { mode: s.started ? 'video' : 'connecting', reason: null };
}
