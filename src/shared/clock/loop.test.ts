import { describe, expect, it } from 'vitest';
import type { Screen, Slot } from '../data/types';
import { activeSlots, loopPosition, loopSlots, pictureFor } from './loop';

const slot = (id: string, order: number, seconds: number, extra: Partial<Slot> = {}): Slot => ({
  id, order, seconds, transition: 'fade', pictures: {}, ...extra,
});

describe('loopPosition', () => {
  const slots = [slot('b', 2, 5), slot('a', 1, 10), slot('c', 3, 15)];

  it('plays slots in order and wraps around', () => {
    const cycle = 30_000;
    const base = cycle * 1000; // a time that is an exact cycle start
    expect(loopPosition(slots, base)!.slot.id).toBe('a');
    expect(loopPosition(slots, base + 9_999)!.slot.id).toBe('a');
    expect(loopPosition(slots, base + 10_000)!.slot.id).toBe('b');
    expect(loopPosition(slots, base + 15_000)!.slot.id).toBe('c');
    expect(loopPosition(slots, base + 29_999)!.slot.id).toBe('c');
    expect(loopPosition(slots, base + 30_000)!.slot.id).toBe('a');
  });

  it('gives every device the same answer for the same time, whatever order slots arrive in', () => {
    const t = 1_763_490_000_123;
    const reversed = [...slots].reverse();
    expect(loopPosition(slots, t)).toEqual(loopPosition(reversed, t));
  });

  it('reports exact start and end times of the current slot', () => {
    const base = 30_000 * 500;
    const p = loopPosition(slots, base + 12_000)!;
    expect(p.startedAt).toBe(base + 10_000);
    expect(p.endsAt).toBe(base + 15_000);
    expect(p.next.id).toBe('c');
  });

  it('restarts from the anchor, beginning with the chosen slot', () => {
    const anchor = 1_763_490_000_000;
    const loop = { anchor, firstSlotId: 'c' };
    expect(loopPosition(slots, anchor, loop)!.slot.id).toBe('c');
    expect(loopPosition(slots, anchor + 14_999, loop)!.slot.id).toBe('c');
    expect(loopPosition(slots, anchor + 15_000, loop)!.slot.id).toBe('a');
    expect(loopPosition(slots, anchor + 25_000, loop)!.slot.id).toBe('b');
    expect(loopPosition(slots, anchor + 30_000, loop)!.slot.id).toBe('c');
  });

  it('ignores a first slot that is no longer playing', () => {
    const anchor = 5_000_000;
    expect(loopPosition(slots, anchor, { anchor, firstSlotId: 'gone' })!.slot.id).toBe('a');
  });

  it('counts from the latest end time when a special ended after the anchor, so nobody jumps mid-picture', () => {
    const anchor = 1_000_000;
    const ends = anchor + 7_000; // the special ends 7 s into the loop
    const list = [slot('a', 1, 10), slot('s', 2, 10, { endsAt: ends }), slot('b', 3, 10)];
    expect(loopPosition(list, ends - 1, { anchor })!.slot.id).toBe('a');
    // right after it ends, the shorter loop starts over from its top instead of jumping to the middle of a
    expect(loopPosition(list, ends, { anchor })).toMatchObject({ slot: { id: 'a' }, startedAt: ends });
    expect(loopPosition(list, ends + 10_000, { anchor })!.slot.id).toBe('b');
    // a later restart by the manager still wins
    const later = { anchor: ends + 3_000, firstSlotId: 'b' };
    expect(loopPosition(list, ends + 3_000, later)!.slot.id).toBe('b');
  });

  it('returns null when nothing can play', () => {
    expect(loopPosition([], 1000)).toBeNull();
    expect(loopPosition([slot('x', 1, 0)], 1000)).toBeNull();
  });
});

describe('activeSlots', () => {
  it('drops slots past their end time', () => {
    const list = activeSlots([slot('a', 1, 10), slot('s', 2, 8, { endsAt: 5000 })], 6000);
    expect(list.map((s) => s.id)).toEqual(['a']);
  });
});

describe('pictureFor', () => {
  const screens: Screen[] = [
    { id: 'tv1', name: 'TV 1', kind: 'menu', side: 'left' },
    { id: 'tv2', name: 'TV 2', kind: 'menu', side: 'right' },
    { id: 'tv3', name: 'TV 3', kind: 'menu', side: 'left', mirrorOf: 'tv1' },
    { id: 'tv4', name: 'TV 4', kind: 'menu', side: 'right', mirrorOf: null },
  ];

  it('uses the screen\'s own picture', () => {
    expect(pictureFor(slot('a', 1, 10, { pictures: { tv1: 'L', tv2: 'R' } }), 'tv2', screens)).toBe('R');
  });

  it('follows mirroring', () => {
    expect(pictureFor(slot('a', 1, 10, { pictures: { tv1: 'L', tv2: 'R' } }), 'tv3', screens)).toBe('L');
  });

  it('falls back to the partner picture for specials, so one special fills a pair', () => {
    expect(pictureFor(slot('s', 1, 10, { kind: 'special', pictures: { tv1: 'SPECIAL' } }), 'tv2', screens)).toBe('SPECIAL');
  });

  it('never borrows the partner picture in menu slots', () => {
    expect(pictureFor(slot('m', 1, 10, { kind: 'menu', pictures: { tv1: 'L' } }), 'tv2', screens)).toBeNull();
    expect(pictureFor(slot('m', 1, 10, { pictures: { tv1: 'L' } }), 'tv2', screens)).toBeNull();
  });

  it('a special fills the pair through mirroring; null when the pair has nothing', () => {
    expect(pictureFor(slot('s', 1, 10, { kind: 'special', pictures: { tv1: 'X' } }), 'tv4', screens)).toBe('X'); // TV 3 mirrors TV 1
    expect(pictureFor(slot('s', 1, 10, { kind: 'special', pictures: { tv5: 'X' } as Slot['pictures'] }), 'tv4', screens)).toBeNull();
  });

  it('TV 3 / TV 4 without mirroring: own picture first, else the main TV\'s, never blank where the main TV has one', () => {
    expect(pictureFor(slot('m', 1, 10, { pictures: { tv2: 'R', tv4: 'OWN' } }), 'tv4', screens)).toBe('OWN');
    expect(pictureFor(slot('m', 1, 10, { pictures: { tv1: 'L', tv2: 'R' } }), 'tv4', screens)).toBe('R');
    // a mirroring TV ignores its old own pictures
    expect(pictureFor(slot('m', 1, 10, { pictures: { tv1: 'L', tv3: 'OLD' } }), 'tv3', screens)).toBe('L');
    // menu spots still never borrow from the partner
    expect(pictureFor(slot('m', 1, 10, { pictures: { tv4: 'OWN' } }), 'tv3', screens)).toBeNull();
  });
});

describe('loopSlots', () => {
  const screens = (tv3: 'tv1' | null, tv4: 'tv2' | null): Screen[] => [
    { id: 'tv1', name: 'TV 1', kind: 'menu', side: 'left' },
    { id: 'tv2', name: 'TV 2', kind: 'menu', side: 'right' },
    { id: 'tv3', name: 'TV 3', kind: 'menu', side: 'left', mirrorOf: tv3 },
    { id: 'tv4', name: 'TV 4', kind: 'menu', side: 'right', mirrorOf: tv4 },
  ];
  const list = [
    slot('main', 1, 10, { pictures: { tv1: 'L' } }),
    slot('three', 2, 10, { pictures: { tv3: 'T3' } }),
    slot('four', 3, 10, { pictures: { tv4: 'T4' } }),
  ];
  const ids = (tv: 'tv1' | 'tv2' | 'tv3' | 'tv4', s: Screen[]) => loopSlots(list, tv, s).map((x) => x.id);

  it('TV 1 and TV 2 never play spots that exist only for TV 3 / TV 4', () => {
    expect(ids('tv1', screens(null, null))).toEqual(['main']);
    expect(ids('tv2', screens(null, null))).toEqual(['main']);
  });

  it('a pair gets the same list, with the own spots of whichever of TV 3 / TV 4 is not mirroring', () => {
    expect(ids('tv3', screens(null, 'tv2'))).toEqual(['main', 'three']);
    expect(ids('tv4', screens(null, 'tv2'))).toEqual(['main', 'three']);
    expect(ids('tv4', screens(null, null))).toEqual(['main', 'three', 'four']);
  });

  it('with both mirroring, all four TVs play the same spots', () => {
    for (const tv of ['tv1', 'tv2', 'tv3', 'tv4'] as const) expect(ids(tv, screens('tv1', 'tv2'))).toEqual(['main']);
  });
});
