import { describe, expect, it } from 'vitest';
import { currentApp, deviceLabel, isRecent, mayManage, STALE_MS } from './access';

describe('currentApp', () => {
  it('names the app from the link', () => {
    expect(currentApp('#/tv/3', false)).toBe('tv3');
    expect(currentApp('#/kitchen', false)).toBe('kitchen');
    expect(currentApp('#/manager/more/devices', false)).toBe('manager');
    expect(currentApp('#/front/catering', false)).toBe('front');
    expect(currentApp('#/', false)).toBe('home');
    expect(currentApp('', true)).toBe('front');
    expect(currentApp('#/tv/9', false)).toBe('home');
  });
  it('labels a device by its name, else its app', () => {
    expect(deviceLabel({ name: 'Ravi phone', app: 'front' })).toBe('Ravi phone');
    expect(deviceLabel({ name: null, app: 'kitchen' })).toBe('Kitchen tablet');
  });
});

describe('manager phones', () => {
  const now = 100 * STALE_MS;
  const fresh = now - 1000;
  it('any device may manage until a manager phone is marked; then only manager phones seen in 30 days', () => {
    expect(mayManage('a', [], now)).toBe(true);
    const boss = { id: 'boss', manager: true, lastSeen: fresh };
    expect(mayManage('boss', [boss, { id: 'staff', lastSeen: fresh }], now)).toBe(true);
    expect(mayManage('staff', [boss, { id: 'staff', lastSeen: fresh }], now)).toBe(false);
    expect(mayManage(null, [boss], now)).toBe(false);
    expect(mayManage('staff', [{ ...boss, lastSeen: now - STALE_MS }], now)).toBe(true);
    expect(isRecent({ lastSeen: fresh }, now)).toBe(true);
    expect(isRecent({ lastSeen: now - STALE_MS }, now)).toBe(false);
  });
});
