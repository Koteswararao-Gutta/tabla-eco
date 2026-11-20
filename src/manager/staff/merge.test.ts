import { describe, expect, it } from 'vitest';
import { clone, defaults, emptyWeek, mergeConfig, mergeWeek, SEED_WEEK } from './model';

describe('saving while another phone changed things', () => {
  it('Settings saved here keeps a person added on another phone', () => {
    const base = defaults().config;
    const local = clone(base);
    local.settings.minStaff = 3;
    const latest = clone(base);
    latest.people.push({ id: 'ravi', name: 'Ravi', active: true });
    const m = mergeConfig(base, local, latest);
    expect(m.settings.minStaff).toBe(3);
    expect(m.people.map((p) => p.name)).toContain('Ravi');
  });

  it('a rename here and a removal there both stick; a person added here is kept', () => {
    const base = defaults().config;
    const local = clone(base);
    local.people[0].name = 'Tarun K';
    local.people.push({ id: 'new', name: 'New', active: true });
    const latest = clone(base);
    latest.people = latest.people.filter((p) => p.id !== base.people[1].id);
    latest.settings.minStaff = 4;
    const m = mergeConfig(base, local, latest);
    expect(m.people[0].name).toBe('Tarun K');
    expect(m.people.some((p) => p.id === base.people[1].id)).toBe(false);
    expect(m.people.at(-1)!.name).toBe('New');
    expect(m.settings.minStaff).toBe(4);
  });

  it('a shift changed here keeps a shift changed on another phone the same day', () => {
    const base = defaults().weeks[SEED_WEEK];
    const local = clone(base);
    local.shifts[0].p1 = [[600, 840, 'runner']];
    const latest = clone(base);
    latest.shifts[0].p5 = [[1020, 1260, 'prep']];
    const m = mergeWeek(base, local, latest);
    expect(m.shifts[0].p1).toEqual([[600, 840, 'runner']]);
    expect(m.shifts[0].p5).toEqual([[1020, 1260, 'prep']]);
  });

  it('a shift removed here stays removed; a new week from another phone is merged', () => {
    const base = defaults().weeks[SEED_WEEK];
    const local = clone(base);
    delete local.shifts[0].p1;
    expect(mergeWeek(base, local, clone(base)).shifts[0].p1).toBeUndefined();
    const theirs = emptyWeek();
    theirs.shifts[2].p2 = [[600, 700]];
    const mine = emptyWeek();
    mine.shifts[3].p3 = [[600, 700]];
    const m = mergeWeek(undefined, mine, theirs);
    expect(m.shifts[2].p2).toEqual([[600, 700]]);
    expect(m.shifts[3].p3).toEqual([[600, 700]]);
  });
});
