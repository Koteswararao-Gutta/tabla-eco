import { describe, expect, it } from 'vitest';
import type { Slot } from '@shared/data/types';
import { formatWhen, fromLocalInput, insertOrder, isPin, moveSlot, parseSeconds, pictureInUse, pictureWarnings, slotLine, sortSlots, tileLine, toLocalInput, withoutPicture } from './logic';

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
