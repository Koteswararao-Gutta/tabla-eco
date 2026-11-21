import { describe, expect, it } from 'vitest';
import { matchesFilter, recentSince, RECENT_DAYS } from './filter';

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
