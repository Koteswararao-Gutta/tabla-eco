import { describe, expect, it } from 'vitest';
import { DEFAULT_MANAGER_PIN, UNLOCK_MS, expectedManagerPin, unlockValue, unlockedUntil } from './pin';

describe('manager PIN', () => {
  it('waits for settings, then falls back to the default', () => {
    expect(expectedManagerPin(undefined)).toBeUndefined();
    expect(expectedManagerPin(null)).toBe(DEFAULT_MANAGER_PIN);
    expect(expectedManagerPin({ kitchenPin: '1234', restaurantName: 'Tabla' })).toBe(DEFAULT_MANAGER_PIN);
    expect(expectedManagerPin({ kitchenPin: '1234', restaurantName: 'Tabla', managerPin: '12a4' })).toBe(DEFAULT_MANAGER_PIN);
    expect(expectedManagerPin({ kitchenPin: '1234', restaurantName: 'Tabla', managerPin: ' 9081 ' })).toBe('9081');
  });

  it('stays unlocked until the time runs out', () => {
    const saved = unlockValue('5678', 1000 + UNLOCK_MS);
    expect(unlockedUntil(saved, '5678', 1000)).toBe(1000 + UNLOCK_MS);
    expect(unlockedUntil(saved, '5678', 1000 + UNLOCK_MS)).toBe(0);
  });

  it('locks when the PIN changes, or nothing was saved', () => {
    const saved = unlockValue('5678', 1000 + UNLOCK_MS);
    expect(unlockedUntil(saved, '1111', 1000)).toBe(0);
    expect(unlockedUntil(saved, undefined, 1000)).toBe(0);
    expect(unlockedUntil(null, '5678', 1000)).toBe(0);
    expect(unlockedUntil('junk', '5678', 1000)).toBe(0);
  });

  it('never stays open longer than 10 minutes from now', () => {
    const saved = unlockValue('5678', 1000 + 10 * UNLOCK_MS);
    // Saved with the clock far ahead (then put right): locked, not open for hours.
    expect(unlockedUntil(saved, '5678', 1000)).toBe(0);
    expect(unlockedUntil(saved, '5678', 1000 + 9 * UNLOCK_MS)).toBe(1000 + 10 * UNLOCK_MS);
  });
});
