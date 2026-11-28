import { describe, expect, it } from 'vitest';
import { fixFor, MAX_RATE_CHANGE } from './adSync';

describe('ad video drift fix', () => {
  it('leaves an in-sync video alone', () => {
    expect(fixFor(5.01, 5, 15)).toEqual({ rate: 1 });
  });
  it('speeds up a video that is a little behind, slows one that is ahead', () => {
    const behind = fixFor(4.9, 5, 15) as { rate: number };
    const ahead = fixFor(5.1, 5, 15) as { rate: number };
    expect(behind.rate).toBeGreaterThan(1);
    expect(ahead.rate).toBeLessThan(1);
    expect(behind.rate).toBeLessThanOrEqual(1 + MAX_RATE_CHANGE);
    expect(ahead.rate).toBeGreaterThanOrEqual(1 - MAX_RATE_CHANGE);
  });
  it('jumps when far off', () => {
    expect(fixFor(3, 5, 15)).toEqual({ seek: 5 });
    expect(fixFor(7, 5, 15)).toEqual({ seek: 5 });
  });
  it('does nothing near the end or with an unknown length', () => {
    expect(fixFor(10, 14.95, 15)).toEqual({ rate: 1 });
    expect(fixFor(1, 5, NaN)).toEqual({ rate: 1 });
    expect(fixFor(1, -1, 15)).toEqual({ rate: 1 });
  });
});
