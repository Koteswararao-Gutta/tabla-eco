import { describe, expect, it } from 'vitest';
import { DEFAULT_PIN, expectedPin, isUnlocked, pinFingerprint, press } from './pin';

describe('kitchen PIN', () => {
  it('waits while settings load and defaults when missing', () => {
    expect(expectedPin(undefined)).toBeUndefined();
    expect(expectedPin(null)).toBe(DEFAULT_PIN);
    expect(expectedPin({ kitchenPin: '', restaurantName: 'T' })).toBe(DEFAULT_PIN);
    expect(expectedPin({ kitchenPin: '9876', restaurantName: 'T' })).toBe('9876');
  });
  it('builds the entry from key presses', () => {
    let e = '';
    for (const k of ['1', '2', 'back', '3', '4', '5', '6']) e = press(e, k);
    expect(e).toBe('1345');
    expect(press(e, 'clear')).toBe('');
    expect(press('', 'x')).toBe('');
  });
  it('stays unlocked only for the PIN it was unlocked with', () => {
    const saved = pinFingerprint('1234');
    expect(saved).not.toContain('1234');
    expect(isUnlocked(saved, '1234')).toBe(true);
    expect(isUnlocked(saved, '9876')).toBe(false); // PIN changed: locks
    expect(isUnlocked(null, '1234')).toBe(false);
    expect(isUnlocked(saved, undefined)).toBe(false); // still loading
  });
});
