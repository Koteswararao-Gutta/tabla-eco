import { describe, expect, it } from 'vitest';
import { clone, defaults, emptyWeek, mergeConfig, mergeSettings, mergeShifts, mergeWeek, SEED_WEEK } from './model';
import type { Shift } from './model';

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

  it('same person, same day: a time edited here and another shift deleted there both stick', () => {
    const base: Shift[] = [[600, 840], [1020, 1260]];
    const local: Shift[] = [[600, 840], [1035, 1260]]; // evening start moved here
    const latest: Shift[] = [[1020, 1260]]; // morning deleted there
    expect(mergeShifts(base, local, latest)).toEqual([[1035, 1260]]);
    expect(mergeShifts(base, latest, local)).toEqual([[1035, 1260]]);
    // the same through mergeWeek
    const b = emptyWeek(), l = emptyWeek(), t = emptyWeek();
    b.shifts[4].p5 = base;
    l.shifts[4].p5 = local;
    t.shifts[4].p5 = latest;
    expect(mergeWeek(b, l, t).shifts[4].p5).toEqual([[1035, 1260]]);
  });

  it('same person, same day: shifts added on both phones are both kept', () => {
    const base: Shift[] = [[720, 840]];
    expect(mergeShifts(base, [[600, 660], [720, 840]], [[720, 840], [1020, 1200, 'prep']])).toEqual([
      [600, 660],
      [720, 840],
      [1020, 1200, 'prep'],
    ]);
    // added on both phones at the same time: this phone's one is kept, no overlap
    expect(mergeShifts([], [[600, 700]], [[630, 720]])).toEqual([[600, 700]]);
  });

  it('same shift edited on both phones: this phone wins; a removal on either side sticks', () => {
    const base: Shift[] = [[600, 840], [1020, 1260]];
    expect(mergeShifts(base, [[600, 900], [1020, 1260]], [[600, 780, 'runner'], [1020, 1260]])).toEqual([
      [600, 900],
      [1020, 1260],
    ]);
    expect(mergeShifts(base, [[600, 900], [1020, 1260]], [[600, 840]])).toEqual([[600, 900]]);
  });

  it('Settings merge field by field: different days and rules changed on two phones all stick', () => {
    const base = defaults().config.settings;
    const local = clone(base), latest = clone(base);
    local.days[0].close = 1200;
    local.minStaff = 3;
    latest.days[1].close = 1230;
    latest.days[0].brk = null;
    latest.prepStart = 570;
    const m = mergeSettings(base, local, latest);
    expect(m.days[0]).toEqual({ open: 660, close: 1200, brk: null });
    expect(m.days[1].close).toBe(1230);
    expect(m.minStaff).toBe(3);
    expect(m.prepStart).toBe(570);
    // the same field on both: this phone wins
    latest.minStaff = 5;
    expect(mergeSettings(base, local, latest).minStaff).toBe(3);
    // through mergeConfig too
    const c = defaults().config, cl = clone(c), ct = clone(c);
    cl.settings.days[0].close = 1200;
    ct.settings.days[1].close = 1230;
    const mc = mergeConfig(c, cl, ct);
    expect([mc.settings.days[0].close, mc.settings.days[1].close]).toEqual([1200, 1230]);
  });
});
