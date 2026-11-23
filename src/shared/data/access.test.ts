import { describe, expect, it } from 'vitest';
import { currentApp, deviceLabel } from './access';

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
