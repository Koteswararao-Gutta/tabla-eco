import { describe, expect, it } from 'vitest';
import type { Slot } from '@shared/data/types';
import { adLine, adSeconds, adVideos, everyLabel, isVideoAd, parseEvery, roundsHint, tvsOnOldCode, formatWhen, fromLocalInput, insertOrder, isPin, moveSlot, moveSlotTo, parseSeconds, pictureInUse, pictureWarnings, slotLine, sortSlots, tileLine, toLocalInput, withoutPicture } from './logic';

const s = (id: string, order: number, extra: Partial<Slot> = {}): Slot => ({ id, order, seconds: 10, transition: 'fade', pictures: { tv1: 'p' + id }, ...extra });

describe('slot order', () => {
  const list = sortSlots([s('c', 3), s('a', 1), s('b', 2)]);
  it('sorts by order', () => expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c']));
  it('inserts between neighbours', () => {
    expect(insertOrder(list, 0)).toBe(1.5);
    expect(insertOrder(list, 2)).toBe(4);
    expect(insertOrder(list, -1)).toBe(0);
    expect(insertOrder([], 0)).toBe(1);
  });
  it('moves and renumbers only what changed', () => {
    expect(moveSlot(list, 1, -1).map((x) => [x.id, x.order])).toEqual([['b', 1], ['a', 2]]);
    expect(moveSlot(list, 0, -1)).toEqual([]);
    expect(moveSlot(list, 2, 1)).toEqual([]);
    const odd = sortSlots([s('a', 1), s('n', 1.5), s('b', 2)]);
    expect(moveSlot(odd, 2, -1).map((x) => [x.id, x.order])).toEqual([['n', 3]]);
  });
  it('moves to the top or the bottom in one go', () => {
    expect(moveSlotTo(list, 2, 0).map((x) => [x.id, x.order])).toEqual([['c', 1], ['a', 2], ['b', 3]]);
    expect(moveSlotTo(list, 0, 2).map((x) => [x.id, x.order])).toEqual([['b', 1], ['c', 2], ['a', 3]]);
    expect(moveSlotTo(list, 0, 0)).toEqual([]);
    expect(moveSlotTo(list, 1, 5)).toEqual([]);
  });
});

describe('withoutPicture', () => {
  it('keeps the slot while another TV has a picture', () => {
    expect(withoutPicture(s('a', 1, { pictures: { tv1: 'x', tv2: 'y' } }), 'tv1')?.pictures).toEqual({ tv2: 'y' });
  });
  it('returns null when nothing is left', () => expect(withoutPicture(s('a', 1), 'tv1')).toBeNull());
});

describe('words', () => {
  const sun9pm = new Date(2026, 10, 22, 21, 0).getTime(); // Sunday
  const now = new Date(2026, 10, 18, 12, 0).getTime();
  it('formats times', () => {
    expect(formatWhen(sun9pm, now)).toBe('Sun 9 PM');
    expect(formatWhen(new Date(2026, 10, 22, 9, 30).getTime(), now)).toBe('Sun 9:30 AM');
    expect(formatWhen(new Date(2026, 11, 3, 0, 0).getTime(), now)).toBe('Dec 3 12 AM');
  });
  it('builds the line under a picture', () => {
    expect(slotLine(s('a', 1), now)).toBe('Fade · 10 s');
    expect(slotLine(s('a', 1, { transition: 'slide', seconds: 8, endsAt: sun9pm }), now)).toBe('Slide · 8 s · until Sun 9 PM');
    expect(slotLine(s('a', 1, { endsAt: now - 1000 }), now)).toMatch(/ended Wed/);
  });
  it('round-trips datetime-local values', () => {
    expect(fromLocalInput(toLocalInput(sun9pm))).toBe(sun9pm);
    expect(fromLocalInput('')).toBeNull();
  });
  it('validates input', () => {
    expect(parseSeconds('10')).toBe(10);
    expect(parseSeconds('0')).toBeNull();
    expect(parseSeconds('2.5')).toBeNull();
    expect(isPin('0420')).toBe(true);
    expect(isPin('123')).toBe(false);
    expect(isPin('12a4')).toBe(false);
  });
  it('labels tiles', () => {
    expect(tileLine({ id: 'tv3', mirrorOf: 'tv1' })).toBe('Mirrors TV 1');
    expect(tileLine({ id: 'tv4', mirrorOf: null })).toBe('Own pictures');
    expect(tileLine({ id: 'kitchen' })).toBe('Tablet');
  });
});

describe('pictureInUse', () => {
  const slots = [s('a', 1, { pictures: { tv1: 'x', tv2: 'y' } }), s('b', 2, { pictures: { tv1: 'z' } })];
  it('finds pictures in slots and the TV 5 clip', () => {
    expect(pictureInUse('y', slots)).toBe(true);
    expect(pictureInUse('q', slots)).toBe(false);
    expect(pictureInUse('q', slots, ['q'])).toBe(true);
    expect(pictureInUse('z', [])).toBe(false);
  });
});

describe('pictureWarnings', () => {
  it('is quiet for a large 16:9 picture', () => expect(pictureWarnings(1920, 1080)).toEqual([]));
  it('warns for tall, very wide and small pictures', () => {
    expect(pictureWarnings(1080, 1920)[0]).toMatch(/tall/);
    expect(pictureWarnings(3000, 1000)[0]).toMatch(/very wide/);
    expect(pictureWarnings(800, 450)).toEqual(['This picture is small and may look blurry on the TV.']);
    expect(pictureWarnings(600, 800)).toHaveLength(2);
    expect(pictureWarnings(0, 0)).toEqual([]);
  });
});

describe('ads', () => {
  const now = 1_763_490_000_000;
  it('everyLabel and adLine in plain words', () => {
    expect(everyLabel(null)).toBe('once every round, in its place');
    expect(everyLabel({ by: 'rounds', n: 1 })).toBe('after every round');
    expect(everyLabel({ by: 'rounds', n: 3 })).toBe('after every 3 rounds');
    expect(everyLabel({ by: 'minutes', n: 2 })).toBe('every 2 min');
    expect(adLine({ seconds: 15, endsAt: null, every: { by: 'minutes', n: 2 } }, now)).toBe('15 s · every 2 min');
    expect(adLine({ seconds: 15, endsAt: now - 1, every: null }, now)).toBe('Paused');
    expect(adLine({ seconds: 15, endsAt: now + 3_600_000, every: { by: 'rounds', n: 1 } }, now)).toMatch(/^15 s · after every round · until /);
  });

  it('tvsOnOldCode names menu TVs without the new version, ignoring TVs not seen for a day', () => {
    const fresh = now - 60_000;
    expect(tvsOnOldCode([], now)).toEqual([]);
    expect(tvsOnOldCode([
      { id: 'tv1', lastSeen: fresh, version: 2 },
      { id: 'tv2', lastSeen: fresh, version: 2 },
      { id: 'tv3', lastSeen: fresh },
      { id: 'tv4', lastSeen: now - 27 * 3_600_000 },
      { id: 'kitchen', lastSeen: fresh },
    ], now)).toEqual(['TV 3']);
    expect(tvsOnOldCode(['tv1', 'tv2', 'tv3', 'tv4'].map((id) => ({ id, lastSeen: fresh, version: 2 })), now)).toEqual([]);
  });

  it('adSeconds never cuts the video; parseEvery keeps to the limits', () => {
    expect(adSeconds(15.04, 15.0)).toBe(15);
    expect(adSeconds(15.3)).toBe(16);
    expect(adSeconds(0.2)).toBe(1);
    expect(parseEvery('rounds', '2')).toEqual({ by: 'rounds', n: 2 });
    expect(parseEvery('rounds', '21')).toBeNull();
    expect(parseEvery('minutes', '120')).toEqual({ by: 'minutes', n: 120 });
    expect(parseEvery('minutes', '0')).toBeNull();
    expect(parseEvery('minutes', '1.5')).toBeNull();
  });

  it('finds the video pictures of an ad', () => {
    const pics = [{ id: 'L', video: { src: 'a', sound: true } }, { id: 'R', video: { src: 'b', sound: false } }, { id: 'P', video: null }];
    const s = { kind: 'catering' as const, pictures: { tv1: 'L', tv2: 'R' } };
    expect(adVideos(s, pics).map((p) => p.id)).toEqual(['L', 'R']);
    expect(isVideoAd(s, pics)).toBe(true);
    expect(isVideoAd({ kind: 'catering', pictures: { tv1: 'P' } }, pics)).toBe(false);
    expect(isVideoAd({ kind: 'menu', pictures: { tv1: 'L' } }, pics)).toBe(false);
  });

  it('roundsHint', () => {
    expect(roundsHint(1, 45)).toBe('One round of the menu is now 45 s, so about every 45 s.');
    expect(roundsHint(2, 45)).toBe('One round of the menu is now 45 s, so about every 1½ min.');
    expect(roundsHint(4, 45)).toBe('One round of the menu is now 45 s, so about every 3 min.');
  });
});
