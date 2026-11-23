import { describe, expect, it } from 'vitest';
import { defaults, encodeWeek, normalizeDB, fromHM, fmt, wrange, mondayOf, iso, SEED_WEEK } from './model';

describe('shift planner model', () => {
  it('defaults have the 7 staff and the seeded week', () => {
    const d = defaults();
    expect(d.config.people).toHaveLength(7);
    expect(Object.keys(d.weeks)).toEqual([SEED_WEEK]);
    expect(d.weeks[SEED_WEEK].shifts[0].p1).toEqual([[600, 840], [1020, 1260]]);
  });

  it('normalizeDB keeps valid data unchanged', () => {
    const d = defaults();
    expect(normalizeDB(d)).toEqual(d);
  });

  it('normalizeDB rejects non-planner data and cleans bad parts', () => {
    expect(normalizeDB(null)).toBeNull();
    expect(normalizeDB({ config: {} })).toBeNull();
    const n = normalizeDB({
      config: { id: 'staffConfig', people: [{ id: 'a', name: ' Ann ' }, { id: 'a', name: 'dup' }, { name: 'no id' }], settings: { minStaff: 0 } },
      weeks: {
        '2026-09-21': { id: '2026-09-21', shifts: [{ a: [[600, 700, 'prep'], [650, 800], [900, 800]], ghost: [[1, 2]] }] },
        nonsense: { shifts: [] },
      },
    });
    expect(n?.config.people).toEqual([{ id: 'a', name: 'Ann', active: true }]);
    expect(n?.config.settings.minStaff).toBe(2);
    expect(Object.keys(n!.weeks)).toEqual(['2026-09-21']);
    expect(n!.weeks['2026-09-21'].shifts[0]).toEqual({ a: [[600, 700, 'prep']] });
    expect(n!.weeks['2026-09-21'].shifts).toHaveLength(7);
  });

  it('normalizeDB drops person ids and break times that could break the page', () => {
    const n = normalizeDB({
      config: {
        people: [{ id: 'p1', name: 'Ann' }, { id: '"><img src=x onerror=alert(1)>', name: 'Bad' }],
        special: { '2026-12-24': { open: 600, close: 1200, brk: ['<b>', 700] }, '2026-12-25': { open: 600, close: 1200, brk: [700, 800] } },
      },
      weeks: {},
    });
    expect(n?.config.people.map((p) => p.id)).toEqual(['p1']);
    expect(n?.config.special['2026-12-24']).toEqual({ open: 600, close: 1200 });
    expect(n?.config.special['2026-12-25']).toEqual({ open: 600, close: 1200, brk: [700, 800] });
  });

  it('time helpers', () => {
    expect(fromHM('10:07')).toBe(600);
    expect(fmt(1020)).toBe('5pm');
    expect(fmt(645)).toBe('10:45am');
    expect(wrange('2026-09-21')).toBe('Sep 21 – 27');
    expect(iso(mondayOf(new Date(2026, 10, 18)))).toBe('2026-11-16');
  });

  it('a saved week has no array directly inside an array, and reads back the same', () => {
    const d = defaults();
    const w = d.weeks[SEED_WEEK];
    w.shifts[0].p1[0] = [600, 840, 'prep'];
    const stored = encodeWeek(w);
    const nested = (v: unknown, inArray: boolean): boolean =>
      Array.isArray(v)
        ? inArray || v.some((x) => nested(x, true))
        : !!v && typeof v === 'object' && Object.values(v).some((x) => nested(x, false));
    expect(nested(stored, false)).toBe(false);
    expect(stored.shifts[0].p1).toEqual([{ s: 600, e: 840, pos: 'prep' }, { s: 1020, e: 1260 }]);
    expect(JSON.stringify(stored)).not.toContain('undefined');
    const back = normalizeDB({ config: d.config, weeks: { [SEED_WEEK]: JSON.parse(JSON.stringify(stored)) } });
    expect(back?.weeks[SEED_WEEK]).toEqual(w);
  });
});
