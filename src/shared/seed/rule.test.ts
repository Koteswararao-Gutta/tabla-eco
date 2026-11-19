import { describe, expect, it } from 'vitest';
import { REAL_DATA, seedDecision } from './rule';
import type { CollectionName } from '../data/types';

function fake(mode: 'local' | 'firebase', opts: { seeded?: boolean; has?: CollectionName[]; fail?: boolean; hang?: boolean } = {}) {
  return {
    mode,
    getDoc: (async (col: string, id: string) => (col === 'singletons' && id === 'seeded' && opts.seeded ? { at: 1, id } : null)) as never,
    hasAnyDoc: (col: CollectionName) => {
      if (opts.hang) return new Promise<boolean>(() => {});
      if (opts.fail) return Promise.reject(new Error('offline'));
      return Promise.resolve(!!opts.has?.includes(col));
    },
  };
}

describe('seedDecision', () => {
  it('skips when already seeded, in both modes', async () => {
    expect(await seedDecision(fake('local', { seeded: true }))).toBe('skip');
    expect(await seedDecision(fake('firebase', { seeded: true }))).toBe('skip');
  });

  it('local preview seeds when the marker is missing, as before', async () => {
    expect(await seedDecision(fake('local', { has: ['orders'] }))).toBe('seed');
  });

  it('firebase never seeds or writes anything when any real collection has data', async () => {
    for (const col of REAL_DATA) expect(await seedDecision(fake('firebase', { has: [col] }))).toBe('skip');
  });

  it('firebase seeds only a confirmed empty project', async () => {
    expect(await seedDecision(fake('firebase'))).toBe('seed');
  });

  it('firebase does nothing when the server cannot be asked or is too slow', async () => {
    expect(await seedDecision(fake('firebase', { fail: true }))).toBe('skip');
    expect(await seedDecision(fake('firebase', { hang: true }), 20)).toBe('skip');
  });
});
