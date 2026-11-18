import { describe, expect, it } from 'vitest';
import { afterClip, clipDue, DEFAULT_MUSIC, nextPlayable, onVideoEnded, planFrom, screenMode, stalled, startIndex } from './schedule';

describe('stalled', () => {
  it('is stalled after 20 s without playing', () => {
    expect(stalled(1000, 1000 + 19_999)).toBe(false);
    expect(stalled(1000, 1000 + 20_000)).toBe(true);
    expect(stalled(1000, 1000 + 4000, 3000)).toBe(true);
  });
});

const ID = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';

describe('planFrom', () => {
  it('null means defaults: no playlist', () => {
    const p = planFrom(null);
    expect(p.playlistId).toBeNull();
    expect(p.clipMode).toBe('afterEachSong');
    expect(p.clipMs).toBe(DEFAULT_MUSIC.clipSeconds * 1000);
    expect(p.title).toBe(DEFAULT_MUSIC.clipTitle);
    expect(p.pictures).toEqual([]);
  });

  it('reads settings and parses the playlist', () => {
    const p = planFrom({ ...DEFAULT_MUSIC, playlist: `https://www.youtube.com/playlist?list=${ID}`, shuffle: false, clipMode: 'everySeconds', everySeconds: 90, clipSeconds: 10, clipPictures: ['a', '', 'b'], clipTitle: ' Hi ', clipLine: 'x' });
    expect(p).toEqual({ playlistId: ID, shuffle: false, clipMode: 'everySeconds', everyMs: 90_000, clipMs: 10_000, pictures: ['a', 'b'], title: 'Hi', line: 'x' });
  });

  it('clamps bad numbers', () => {
    expect(planFrom({ clipSeconds: 0, everySeconds: 1 })).toMatchObject({ clipMs: 3000, everyMs: 5000 });
    expect(planFrom({ clipSeconds: 9999 })).toMatchObject({ clipMs: 120_000 });
    expect(planFrom({ clipSeconds: NaN })).toMatchObject({ clipMs: 8000 });
  });
});

describe('clip scheduling', () => {
  it('afterEachSong shows the clip when a video ends', () => {
    expect(onVideoEnded({ clipMode: 'afterEachSong' })).toBe('clip');
    expect(onVideoEnded({ clipMode: 'everySeconds' })).toBe('continue');
  });

  it('everySeconds is due after N seconds of video', () => {
    const plan = { clipMode: 'everySeconds' as const, everyMs: 60_000 };
    expect(clipDue(plan, 1000 + 59_999, 1000)).toBe(false);
    expect(clipDue(plan, 1000 + 60_000, 1000)).toBe(true);
    expect(clipDue(plan, 1_000_000, null)).toBe(false); // not playing yet
    expect(clipDue({ clipMode: 'afterEachSong', everyMs: 60_000 }, 1_000_000, 0)).toBe(false);
  });

  it('after the clip: next video after an ended one, resume after a timed one', () => {
    expect(afterClip('timer', null, 3)).toBe('resume');
    expect(afterClip('ended', 3, 3)).toBe('next');
    expect(afterClip('ended', 3, 4)).toBe('resume'); // player already moved on
    expect(afterClip('ended', 3, -1)).toBe('next');
    expect(afterClip('ended', null, 2)).toBe('next');
  });
});

describe('skipping broken videos', () => {
  it('finds the next video that has not failed, wrapping', () => {
    expect(nextPlayable(5, 1, new Set())).toBe(2);
    expect(nextPlayable(5, 4, new Set())).toBe(0);
    expect(nextPlayable(5, 1, new Set([2, 3]))).toBe(4);
    expect(nextPlayable(3, 2, new Set([0, 1]))).toBe(2);
  });

  it('returns -1 when everything failed or the list is empty', () => {
    expect(nextPlayable(3, 0, new Set([0, 1, 2]))).toBe(-1);
    expect(nextPlayable(0, 0, new Set())).toBe(-1);
  });

  it('start index', () => {
    expect(startIndex(10, false, 0.7)).toBe(0);
    expect(startIndex(10, true, 0.7)).toBe(7);
    expect(startIndex(10, true, 0.9999)).toBe(9);
    expect(startIndex(0, true, 0.5)).toBe(0);
  });
});

describe('screenMode', () => {
  const ok = { hasPlaylist: true, online: true, apiFailed: false, allFailed: false, inClip: false, started: true };
  it('plays video when all is well', () => {
    expect(screenMode(ok)).toEqual({ mode: 'video', reason: null });
    expect(screenMode({ ...ok, started: false })).toEqual({ mode: 'connecting', reason: null });
    expect(screenMode({ ...ok, inClip: true })).toEqual({ mode: 'clip', reason: null });
  });
  it('falls back for each problem', () => {
    expect(screenMode({ ...ok, hasPlaylist: false })).toEqual({ mode: 'fallback', reason: 'noPlaylist' });
    expect(screenMode({ ...ok, online: false, inClip: true })).toEqual({ mode: 'fallback', reason: 'offline' });
    expect(screenMode({ ...ok, apiFailed: true })).toEqual({ mode: 'fallback', reason: 'apiFailed' });
    expect(screenMode({ ...ok, allFailed: true })).toEqual({ mode: 'fallback', reason: 'allFailed' });
  });
});
