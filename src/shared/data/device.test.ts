import { afterEach, describe, expect, it } from 'vitest';
import { deviceValue, setDeviceValue } from './device';

const g = globalThis as { localStorage?: unknown };

describe('device values', () => {
  afterEach(() => delete g.localStorage);

  it('remembers and forgets a value', () => {
    const m = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) };
    expect(deviceValue('a')).toBeNull();
    setDeviceValue('a', 'x');
    expect(deviceValue('a')).toBe('x');
    expect([...m.keys()]).toEqual(['tabla-device:a']); // never mixed up with synced data
    setDeviceValue('a', null);
    expect(deviceValue('a')).toBeNull();
  });

  it('without storage: null, and no error', () => {
    expect(deviceValue('a')).toBeNull();
    expect(() => setDeviceValue('a', 'x')).not.toThrow();
  });
});
