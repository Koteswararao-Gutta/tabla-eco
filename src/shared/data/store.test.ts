import { describe, expect, it } from 'vitest';
import { appendItems, clean, isAppend } from './store';

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
