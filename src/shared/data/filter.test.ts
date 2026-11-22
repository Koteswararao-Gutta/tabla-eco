import { describe, expect, it } from 'vitest';
import { filterKey, idChunks, IDS_PER_QUERY, matchesFilter, recentSince, RECENT_DAYS } from './filter';

const DAY = 24 * 60 * 60_000;
const now = Date.UTC(2026, 10, 21, 12);
const since = recentSince(now);

describe('openOrRecent', () => {
  it('starts the window RECENT_DAYS days back', () => {
    expect(now - since).toBe(RECENT_DAYS * DAY);
  });
  it('keeps every open order, however old', () => {
    expect(matchesFilter({ status: 'open', dueAt: now - 400 * DAY }, 'openOrRecent', since)).toBe(true);
  });
  it('keeps completed orders due in the window or later', () => {
    expect(matchesFilter({ status: 'completed', dueAt: now - 10 * DAY }, 'openOrRecent', since)).toBe(true);
    expect(matchesFilter({ status: 'completed', dueAt: since }, 'openOrRecent', since)).toBe(true);
    expect(matchesFilter({ status: 'completed', dueAt: now + 5 * DAY }, 'openOrRecent', since)).toBe(true);
  });
  it('drops completed orders from before the window', () => {
    expect(matchesFilter({ status: 'completed', dueAt: since - 1 }, 'openOrRecent', since)).toBe(false);
  });
  it('drops a completed order with no usable date', () => {
    expect(matchesFilter({ status: 'completed' }, 'openOrRecent', since)).toBe(false);
  });
});

describe('openOrRecentlyUpdated (estimates)', () => {
  it('keeps open ones and ones updated in the window, whatever their date', () => {
    expect(matchesFilter({ status: 'open', updatedAt: now - 400 * DAY, dueAt: null }, 'openOrRecentlyUpdated', since)).toBe(true);
    expect(matchesFilter({ status: 'ordered', updatedAt: now - DAY, dueAt: null }, 'openOrRecentlyUpdated', since)).toBe(true);
    expect(matchesFilter({ status: 'ordered', updatedAt: since - 1, dueAt: now }, 'openOrRecentlyUpdated', since)).toBe(false);
  });
});

describe('notPaid (orderAmounts)', () => {
  it('keeps only paid === false', () => {
    expect(matchesFilter({ paid: false }, 'notPaid', since)).toBe(true);
    expect(matchesFilter({ paid: true }, 'notPaid', since)).toBe(false);
    // Missing is left out, the same as Firestore's where('paid', '==', false).
    expect(matchesFilter({ amount: 5 }, 'notPaid', since)).toBe(false);
  });
});

describe('due range', () => {
  const f = { dueFrom: now, dueTo: now + DAY };
  it('includes the start and leaves out the end', () => {
    expect(matchesFilter({ dueAt: now }, f, since)).toBe(true);
    expect(matchesFilter({ dueAt: now + DAY - 1 }, f, since)).toBe(true);
    expect(matchesFilter({ dueAt: now + DAY }, f, since)).toBe(false);
    expect(matchesFilter({ dueAt: now - 1, status: 'open' }, f, since)).toBe(false);
    expect(matchesFilter({}, f, since)).toBe(false);
  });
});

describe('ids', () => {
  it('keeps the listed documents', () => {
    expect(matchesFilter({}, { ids: ['a', 'b'] }, since, 'a')).toBe(true);
    expect(matchesFilter({}, { ids: ['a', 'b'] }, since, 'c')).toBe(false);
    expect(matchesFilter({}, { ids: [] }, since, 'a')).toBe(false);
  });
  it('asks in parts of 30, once each, in a fixed order', () => {
    const ids = Array.from({ length: 65 }, (_, i) => `id${String(i).padStart(2, '0')}`);
    const chunks = idChunks([...ids].reverse().concat(['id00']));
    expect(chunks.map((c) => c.length)).toEqual([IDS_PER_QUERY, IDS_PER_QUERY, 5]);
    expect(chunks.flat()).toEqual(ids);
    expect(idChunks([])).toEqual([]);
  });
});

describe('filterKey', () => {
  it('is the same for the same ids in any order, and differs between filters', () => {
    expect(filterKey({ ids: ['b', 'a'] })).toBe(filterKey({ ids: ['a', 'b', 'a'] }));
    expect(filterKey({ dueFrom: 1, dueTo: 2 })).not.toBe(filterKey({ dueFrom: 1, dueTo: 3 }));
    expect(filterKey(undefined)).toBe('');
    expect(filterKey('openOrRecent')).toBe('openOrRecent');
  });
});
