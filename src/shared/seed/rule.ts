// When the sample data may be written. Kept apart from seed.ts (no store import) so it is easy to test.
import type { DataStore } from '../data/store';
import type { CollectionName } from '../data/types';

/** Collections that hold the restaurant's real setup or orders. If any of them has anything in it,
 *  the database is in use and sample data must never be written over it. */
export const REAL_DATA: CollectionName[] = ['screens', 'slots', 'orders', 'singletons', 'pictures'];

export type SeedDecision = 'seed' | 'skip';

/**
 * - Already seeded (marker present): skip.
 * - Local preview / tests: seed when the marker is missing (one browser, nothing real to lose).
 * - Firebase: seed only when the server confirms every REAL_DATA collection is empty (a brand-new
 *   project). If anything exists, nothing is written at all (not even the marker): existing documents
 *   are never changed, cleared or removed. If the server can't be asked
 *   (offline, error, or no answer within `waitMs`, so a screen never waits long to open), do nothing;
 *   it is asked again on the next start.
 * So deleting the marker on a live system can never reset screens, slots, music, the PIN or orders.
 */
export async function seedDecision(s: Pick<DataStore, 'mode' | 'getDoc' | 'hasAnyDoc'>, waitMs = 8000): Promise<SeedDecision> {
  if (await s.getDoc('singletons', 'seeded')) return 'skip';
  if (s.mode === 'local') return 'seed';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tooSlow = new Promise<SeedDecision>((resolve) => (timer = setTimeout(() => resolve('skip'), waitMs)));
  const ask = (async (): Promise<SeedDecision> => {
    const found = await Promise.all(REAL_DATA.map((col) => s.hasAnyDoc(col)));
    return found.some(Boolean) ? 'skip' : 'seed';
  })().catch((): SeedDecision => 'skip');
  try {
    return await Promise.race([ask, tooSlow]);
  } finally {
    clearTimeout(timer);
  }
}
