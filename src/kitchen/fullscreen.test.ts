import { describe, expect, it } from 'vitest';
import { inTablaApp } from './fullscreen';

describe('kitchen full screen', () => {
  it('leaves full screen to the Tabla app when it runs inside it', () => {
    expect(inTablaApp('Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile Safari/537.36 TablaScreen/1.0')).toBe(true);
    expect(inTablaApp('Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile Safari/537.36')).toBe(false);
  });
});
