import { describe, expect, it, vi } from 'vitest';
import { GUARD_MS, guardTaps, ignoreGuardedTap, tapGuarded } from './tapGuard';

const tap = (x: number, y: number, now: number, detail = 1) => {
  const e = { clientX: x, clientY: y, detail, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  ignoreGuardedTap(e, now);
  return e.stopPropagation.mock.calls.length > 0; // dropped?
};

describe('tapGuard', () => {
  it('drops the second tap of a double tap after a save, in the same place only, for a moment', () => {
    expect(tap(100, 200, 1000)).toBe(false); // the tap that saves
    guardTaps(1010);
    expect(tap(110, 205, 1100, 2)).toBe(true); // its second tap
    expect(tap(300, 600, 1150, 2)).toBe(false); // a tap elsewhere still works
    expect(tapGuarded(100, 200, 1010 + GUARD_MS)).toBe(false); // later, the same place works again
  });
  it('never drops a separate tap or a click from the keyboard', () => {
    tap(50, 50, 5000);
    guardTaps(5000);
    expect(tap(50, 50, 5100, 0)).toBe(false);
    expect(tap(50, 50, 5100, 1)).toBe(false);
  });
});
