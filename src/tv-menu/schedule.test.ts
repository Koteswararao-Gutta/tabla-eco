import { describe, expect, it } from 'vitest';
import type { Screen, Slot } from '@shared/data';
import { msUntilNextChange, targetFor } from './schedule';

const slot = (id: string, order: number, seconds: number, extra: Partial<Slot> = {}): Slot => ({
  id, order, seconds, transition: 'fade', pictures: {}, ...extra,
});
const screens: Screen[] = [
  { id: 'tv1', name: 'TV 1', kind: 'menu', side: 'left', mirrorOf: null },
  { id: 'tv2', name: 'TV 2', kind: 'menu', side: 'right', mirrorOf: null },
  { id: 'tv3', name: 'TV 3', kind: 'menu', side: 'left', mirrorOf: 'tv1' },
  { id: 'tv4', name: 'TV 4', kind: 'menu', side: 'right', mirrorOf: 'tv2' },
];
const slots = [
  slot('a', 1, 10, { pictures: { tv1: 'a1', tv2: 'a2' } }),
  slot('b', 2, 5, { transition: 'slide', pictures: { tv1: 'b1' } }),
];
const base = 15_000 * 1000; // an exact cycle start

describe('targetFor', () => {
  it('gives the current slot, picture and next picture', () => {
    expect(targetFor(slots, screens, null, 'tv1', base)).toEqual({
      key: 'a|a1', slotId: 'a', pictureId: 'a1', transition: 'fade', nextPictureId: 'b1',
    });
    const t = targetFor(slots, screens, null, 'tv1', base + 10_000);
    expect(t.slotId).toBe('b');
    expect(t.transition).toBe('slide');
    expect(t.nextPictureId).toBe('a1');
  });

  it('mirrors: TV 3 shows TV 1, TV 4 shows TV 2', () => {
    expect(targetFor(slots, screens, null, 'tv3', base).pictureId).toBe('a1');
    expect(targetFor(slots, screens, null, 'tv4', base).pictureId).toBe('a2');
  });

  it('a menu slot with no picture for this TV shows nothing (idle)', () => {
    const t = targetFor(slots, screens, null, 'tv2', base + 10_000);
    expect(t).toMatchObject({ slotId: 'b', pictureId: null, key: 'b|' });
  });

  it('a spot with only a TV 3 picture never shows on TV 1 / TV 2', () => {
    const own: Screen[] = screens.map((s) => (s.id === 'tv3' ? { ...s, mirrorOf: null } : s));
    const withThree = [...slots, slot('c', 3, 10, { pictures: { tv3: 'c3' } })];
    // TV 1 / TV 2 loop is a (10 s) + b (5 s): at 15 s they are back on a
    expect(targetFor(withThree, own, null, 'tv1', base + 15_000).slotId).toBe('a');
    // TV 3 / TV 4 loop is a + b + c (25 s); at a 25 s cycle start TV 3 shows a, falling back to TV 1's picture
    const b3 = 25_000 * 1000;
    expect(targetFor(withThree, own, null, 'tv3', b3)).toMatchObject({ slotId: 'a', pictureId: 'a1' });
    expect(targetFor(withThree, own, null, 'tv3', b3 + 15_000)).toMatchObject({ slotId: 'c', pictureId: 'c3' });
    expect(targetFor(withThree, own, null, 'tv4', b3 + 15_000)).toMatchObject({ slotId: 'c', pictureId: null });
  });

  it('nothing playing gives an empty target', () => {
    expect(targetFor([], screens, null, 'tv1', base)).toMatchObject({ key: 'none', slotId: null, pictureId: null });
  });

  it('follows the loop anchor', () => {
    expect(targetFor(slots, screens, { anchor: base + 3_000, firstSlotId: 'b' }, 'tv1', base + 3_000).slotId).toBe('b');
  });
});

describe('msUntilNextChange', () => {
  it('wakes just after the current slot ends', () => {
    expect(msUntilNextChange(slots, null, base + 4_000)).toBe(6_005);
  });

  it('wakes when a slot drops out of the loop before that', () => {
    const s = [slots[0], slot('b', 2, 5, { endsAt: base + 2_000 })];
    expect(msUntilNextChange(s, null, base)).toBe(2_005);
  });

  it('sleeps at most 30 s, also when nothing plays', () => {
    expect(msUntilNextChange([], null, base)).toBe(30_000);
    expect(msUntilNextChange([slot('long', 1, 600)], null, base)).toBe(30_000);
  });
});
