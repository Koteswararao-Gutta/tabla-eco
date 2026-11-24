import { describe, expect, it } from 'vitest';
import { appendItems, clean, isAppend, isRemove, removeItems, sameValue } from './store';

describe('appendItems', () => {
  it('marks a list to be added to the end of the saved one, and the mark survives clean()', () => {
    const a = appendItems([1, 2]);
    expect(a).toEqual([1, 2]);
    expect(isAppend(a)).toBe(true);
    expect(isAppend([1, 2])).toBe(false);
    expect(isAppend(clean({ log: a }).log)).toBe(true);
    expect(JSON.stringify(a)).toBe('[1,2]');
  });
});

describe('removeItems', () => {
  it('marks a list of items to take out of the saved one, and the mark survives clean()', () => {
    const d = { amount: 50, method: 'cash', takenBy: 'Ravi', at: 1 };
    const r = removeItems([d]);
    expect(r).toEqual([d]);
    expect(isRemove(r)).toBe(true);
    expect(isAppend(r)).toBe(false);
    expect(isRemove([d])).toBe(false);
    expect(isRemove(clean({ deposits: r }).deposits)).toBe(true);
  });

  it('compares items like Firestore: maps by their keys in any order', () => {
    expect(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(sameValue({ a: 1, at: 2 }, { a: 1, at: 3 })).toBe(false);
    expect(sameValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });
});
