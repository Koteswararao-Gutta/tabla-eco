import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from './chunkError';

describe('isChunkLoadError', () => {
  it('knows the browsers\' "could not load that file" errors', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/kitchen-abc.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
  });
  it('leaves ordinary crashes alone', () => {
    expect(isChunkLoadError(new Error('Test crash'))).toBe(false);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
