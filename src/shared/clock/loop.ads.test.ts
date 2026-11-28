import { describe, expect, it } from 'vitest';
import type { AdEvery, LoopAnchor, Slot } from '../data/types';
import { adEvery, lastDailyRestart, loopPosition, plainPosition, streamSlots } from './loop';

const slot = (id: string, order: number, seconds: number, extra: Partial<Slot> = {}): Slot => ({
  id, order, seconds, transition: 'fade', pictures: { tv1: id }, ...extra,
});
const ad = (id: string, order: number, seconds: number, every: AdEvery | null, extra: Partial<Slot> = {}) =>
  slot(id, order, seconds, { kind: 'catering', every, ...extra });

const HOUR = 3_600_000;
// 10:00 AM Arizona on some day: well after the 4 AM restart.
const DAY_START = lastDailyRestart(1_763_490_000_000);
const T0 = DAY_START + 6 * HOUR;
const menu = [slot('m1', 1, 15), slot('m2', 2, 15), slot('m3', 3, 15)];

/** What plays from `from` until `to`, as ids, following each item's end. */
function sequence(slots: Slot[], loop: LoopAnchor | null, from: number, to: number): string[] {
  const out: string[] = [];
  let t = from;
  while (t < to) {
    const p = loopPosition(slots, t, loop)!;
    out.push(p.slot.id);
    expect(p.endsAt).toBeGreaterThan(t);
    t = p.endsAt;
  }
  return out;
}

describe('lastDailyRestart', () => {
  it('is 4:00 AM Arizona (11:00 UTC)', () => {
    const d = new Date(DAY_START);
    expect(d.getUTCHours()).toBe(11);
    expect(d.getUTCMinutes()).toBe(0);
    expect(lastDailyRestart(DAY_START)).toBe(DAY_START);
    expect(lastDailyRestart(DAY_START - 1)).toBe(DAY_START - 86_400_000);
  });
});

describe('adEvery', () => {
  it('accepts only sensible values on ads', () => {
    expect(adEvery(ad('a', 1, 15, { by: 'rounds', n: 2 }))).toEqual({ by: 'rounds', n: 2 });
    expect(adEvery(ad('a', 1, 15, { by: 'minutes', n: 120 }))).toEqual({ by: 'minutes', n: 120 });
    expect(adEvery(ad('a', 1, 15, null))).toBeNull();
    expect(adEvery(ad('a', 1, 15, { by: 'rounds', n: 0 }))).toBeNull();
    expect(adEvery(ad('a', 1, 15, { by: 'rounds', n: 21 }))).toBeNull();
    expect(adEvery(ad('a', 1, 15, { by: 'minutes', n: 1.5 }))).toBeNull();
    expect(adEvery(ad('a', 1, 15, { by: 'hours', n: 1 } as unknown as AdEvery))).toBeNull();
    expect(adEvery(slot('m', 1, 15, { every: { by: 'rounds', n: 1 } }))).toBeNull(); // only ads
  });

  it('a bad value plays the ad the old way, in its place', () => {
    const slots = [...menu, ad('ad', 4, 15, { by: 'rounds', n: 99 })];
    expect(loopPosition(slots, T0 + 45_000, { anchor: T0, firstSlotId: null })!.slot.id).toBe('ad');
    expect(streamSlots(slots, T0).map((s) => s.id)).toEqual(['m1', 'm2', 'm3', 'ad']);
  });
});

describe('loopPosition without scheduled ads', () => {
  it('is exactly the plain loop (what older TVs compute)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 300; k++) {
      const n = 1 + Math.floor(rnd() * 5);
      const slots: Slot[] = [];
      for (let i = 0; i < n; i++) {
        const ends = rnd() < 0.3 ? T0 + Math.floor(rnd() * 600_000) : null;
        const kind = rnd() < 0.3 ? 'catering' : 'menu';
        slots.push(slot('s' + i, Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 30), { endsAt: ends, kind, every: null }));
      }
      const loop = rnd() < 0.5 ? { anchor: T0 - Math.floor(rnd() * 100_000), firstSlotId: rnd() < 0.5 ? 's0' : null } : null;
      const now = T0 + Math.floor(rnd() * 1_000_000);
      expect(loopPosition(slots, now, loop)).toEqual(plainPosition(slots, now, loop));
    }
  });
});

describe('ads by rounds', () => {
  it('after every round: m1 m2 m3 AD m1 ...', () => {
    const slots = [...menu, ad('ad', 4, 10, { by: 'rounds', n: 1 })];
    expect(sequence(slots, { anchor: T0, firstSlotId: null }, T0, T0 + 110_000)).toEqual(['m1', 'm2', 'm3', 'ad', 'm1', 'm2', 'm3', 'ad']);
  });

  it('after every 2 rounds', () => {
    const slots = [...menu, ad('ad', 4, 10, { by: 'rounds', n: 2 })];
    expect(sequence(slots, { anchor: T0, firstSlotId: null }, T0, T0 + 200_000)).toEqual(['m1', 'm2', 'm3', 'm1', 'm2', 'm3', 'ad', 'm1', 'm2', 'm3', 'm1', 'm2', 'm3', 'ad']);
  });

  it('the ad sits between pictures: start and end times line up', () => {
    const slots = [...menu, ad('ad', 0, 10, { by: 'rounds', n: 1 })];
    const loop = { anchor: T0, firstSlotId: null };
    const p = loopPosition(slots, T0 + 50_000, loop)!;
    expect(p.slot.id).toBe('ad');
    expect(p.index).toBe(-1);
    expect(p.startedAt).toBe(T0 + 45_000);
    expect(p.endsAt).toBe(T0 + 55_000);
    expect(p.next.id).toBe('m1');
    expect(loopPosition(slots, T0 + 40_000, loop)!.next.id).toBe('ad');
  });
});

describe('ads by minutes', () => {
  it('plays at the first change at or after every 2 minutes, and the menu goes on after it', () => {
    const slots = [...menu, ad('ad', 4, 15, { by: 'minutes', n: 2 })];
    const loop = { anchor: T0, firstSlotId: null };
    // 8 pictures fill 120 s, then the ad, then the menu goes on with m3 (not m1).
    const seq = sequence(slots, loop, T0, T0 + 150_000);
    expect(seq).toEqual(['m1', 'm2', 'm3', 'm1', 'm2', 'm3', 'm1', 'm2', 'ad', 'm3']);
    const p = loopPosition(slots, T0 + 121_000, loop)!;
    expect(p.startedAt).toBe(T0 + 120_000);
    // The grid stays fixed: next one at 240 s, i.e. the first change at or after it.
    const second = sequence(slots, loop, T0 + 135_000, T0 + 270_000);
    expect(second.filter((x) => x === 'ad')).toHaveLength(1);
    const pos = loopPosition(slots, T0 + 241_000, loop)!;
    expect(pos.slot.id).toBe('ad');
    expect(pos.startedAt).toBe(T0 + 240_000);
  });

  it('a picture is never cut: an ad due mid-picture waits for the change', () => {
    const slots = [slot('m1', 1, 50), ad('ad', 4, 10, { by: 'minutes', n: 1 })];
    const loop = { anchor: T0, firstSlotId: null };
    const p = loopPosition(slots, T0 + 101_000, loop)!;
    expect(p.slot.id).toBe('ad');
    expect(p.startedAt).toBe(T0 + 100_000);
  });
});

describe('several ads', () => {
  it('two due together: never back to back, the one waiting longest (then list order) first', () => {
    const slots = [...menu, ad('a1', 5, 10, { by: 'rounds', n: 1 }), ad('a2', 6, 10, { by: 'rounds', n: 1 })];
    const seq = sequence(slots, { anchor: T0, firstSlotId: null }, T0, T0 + 160_000);
    expect(seq.slice(0, 9)).toEqual(['m1', 'm2', 'm3', 'a1', 'm1', 'a2', 'm2', 'm3', 'a1']);
    for (let i = 1; i < seq.length; i++) expect(seq[i].startsWith('a') && seq[i - 1].startsWith('a')).toBe(false);
  });

  it('a rounds ad and a minutes ad', () => {
    const slots = [...menu, ad('r', 5, 10, { by: 'rounds', n: 2 }), ad('m', 6, 10, { by: 'minutes', n: 1 })];
    const seq = sequence(slots, { anchor: T0, firstSlotId: null }, T0, T0 + 300_000);
    expect(seq.filter((x) => x === 'r').length).toBeGreaterThan(0);
    expect(seq.filter((x) => x === 'm').length).toBeGreaterThan(2);
    for (let i = 1; i < seq.length; i++) expect(['r', 'm'].includes(seq[i]) && ['r', 'm'].includes(seq[i - 1])).toBe(false);
  });
});

describe('ending, pausing and restarting', () => {
  it('stop after: plays before, not after, and the menu before it does not move', () => {
    const until = T0 + 100_000;
    const withEnd = [...menu, ad('ad', 4, 10, { by: 'rounds', n: 1 }, { endsAt: until })];
    const loop = { anchor: T0, firstSlotId: null };
    const seq = sequence(withEnd, loop, T0, T0 + 200_000);
    // Due again at 100 s, exactly when it stops: it doesn't play, and the menu starts from the top then.
    expect(seq.slice(0, 8)).toEqual(['m1', 'm2', 'm3', 'ad', 'm1', 'm2', 'm3', 'm1']);
    expect(seq.slice(4).includes('ad')).toBe(false);
    const noEnd = [...menu, ad('ad', 4, 10, { by: 'rounds', n: 1 })];
    const brief = (p: ReturnType<typeof loopPosition>) => p && [p.slot.id, p.startedAt, p.endsAt];
    for (let t = T0; t < until; t += 3_000) expect(brief(loopPosition(withEnd, t, loop))).toEqual(brief(loopPosition(noEnd, t, loop)));
  });

  it('paused when it was the last scheduled ad: the plain loop, restarted at the pause', () => {
    const pausedAt = T0 + 70_000;
    const slots = [...menu, ad('ad', 4, 10, { by: 'rounds', n: 1 }, { endsAt: pausedAt })];
    const loop = { anchor: T0, firstSlotId: null };
    const p = loopPosition(slots, pausedAt + 1_000, loop)!;
    expect(p.slot.id).toBe('m1');
    expect(p.startedAt).toBe(pausedAt);
  });

  it('a just-added ad (restartLoop(adId)) shows first, then waits its turn', () => {
    const slots = [...menu, ad('ad', 4, 10, { by: 'rounds', n: 2 })];
    const seq = sequence(slots, { anchor: T0, firstSlotId: 'ad' }, T0, T0 + 110_000);
    expect(seq).toEqual(['ad', 'm1', 'm2', 'm3', 'm1', 'm2', 'm3', 'ad']);
  });

  it('a minutes ad shown first counts from the anchor', () => {
    const slots = [...menu, ad('ad', 4, 15, { by: 'minutes', n: 2 })];
    const loop = { anchor: T0, firstSlotId: 'ad' };
    expect(loopPosition(slots, T0 + 1_000, loop)!.slot.id).toBe('ad');
    const p = loopPosition(slots, T0 + 125_000, loop)!;
    expect(p.slot.id).toBe('ad');
    expect(p.startedAt).toBe(T0 + 120_000);
  });

  it('a time before the anchor (a TV clock slightly behind) shows the first item', () => {
    const slots = [...menu, ad('ad', 4, 10, { by: 'rounds', n: 1 })];
    expect(loopPosition(slots, T0 - 500, { anchor: T0, firstSlotId: null })!.slot.id).toBe('m1');
  });

  it('every TV starts fresh at 4:00 AM Arizona', () => {
    const slots = [slot('m1', 1, 7), ad('ad', 4, 10, { by: 'rounds', n: 3 })];
    const nextDay = DAY_START + 86_400_000;
    const loop = { anchor: T0, firstSlotId: null };
    const late = loopPosition(slots, nextDay - 5_000, loop)!;
    expect(late.endsAt).toBeLessThanOrEqual(nextDay);
    const p = loopPosition(slots, nextDay + 1, loop)!;
    expect(p.slot.id).toBe('m1');
    expect(p.startedAt).toBe(nextDay);
  });
});

describe('same answer everywhere', () => {
  const slots = [...menu, ad('a1', 5, 10, { by: 'rounds', n: 2 }), ad('a2', 6, 12, { by: 'minutes', n: 3 })];
  const loop = { anchor: T0, firstSlotId: null };

  it('whatever order the slots arrive in', () => {
    const shuffled = [slots[4], slots[1], slots[3], slots[0], slots[2]];
    for (let t = T0; t < T0 + 900_000; t += 7_777) expect(loopPosition(shuffled, t, loop)).toEqual(loopPosition(slots, t, loop));
  });

  it('with or without the walk cache, forwards or backwards in time', () => {
    const times: number[] = [];
    for (let t = T0; t < T0 + 1_200_000; t += 9_131) times.push(t);
    const forward = times.map((t) => loopPosition(slots, t, loop));
    const backward = [...times].reverse().map((t) => loopPosition(slots, t, loop)).reverse();
    expect(backward).toEqual(forward);
    // A copy of the slot list (a new key object) gives the same too.
    const fresh = times.map((t) => loopPosition(slots.map((s) => ({ ...s })), t, { ...loop }));
    expect(fresh).toEqual(forward);
  });

  it('only ads live: they take turns', () => {
    const only = [ad('a1', 1, 10, { by: 'rounds', n: 1 }), ad('a2', 2, 10, { by: 'minutes', n: 2 })];
    expect(sequence(only, loop, T0, T0 + 40_000)).toEqual(['a1', 'a2', 'a1', 'a2']);
  });

  it('a whole day of 1 s pictures with three ads stays fast', () => {
    const quick = [slot('m1', 1, 1), slot('m2', 2, 1), ad('a', 3, 5, { by: 'rounds', n: 3 }), ad('b', 4, 5, { by: 'minutes', n: 2 }), ad('c', 5, 5, { by: 'rounds', n: 7 })];
    const start = performance.now();
    loopPosition(quick, DAY_START + 86_000_000, { anchor: DAY_START, firstSlotId: null });
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('never stuck', () => {
  it('a TV a moment behind a phone that restarted the loop just after 4 AM', () => {
    const fourAm = DAY_START + 86_400_000;
    const slots = [slot('m1', 1, 15), ad('a', 2, 10, { by: 'rounds', n: 1 })];
    const p = loopPosition(slots, fourAm - 100, { anchor: fourAm + 200, firstSlotId: null })!;
    expect(p.slot.id).toBe('m1');
    expect(p.startedAt).toBe(fourAm + 200);
  });

  it('a slot shorter than 1 ms is left out instead of freezing the walk', () => {
    const slots = [slot('m0', 1, 0.0004), slot('m1', 2, 15), ad('a', 3, 10, { by: 'minutes', n: 5 })];
    const p = loopPosition(slots, DAY_START + 3_600_000, { anchor: DAY_START + 1000, firstSlotId: null })!;
    expect(['m1', 'a']).toContain(p.slot.id);
    const only = [slot('m0', 1, 0.0004), ad('a', 3, 10, { by: 'minutes', n: 5 })];
    expect(() => loopPosition(only, DAY_START + 3_600_000, { anchor: DAY_START + 1000, firstSlotId: null })).not.toThrow();
  });
});

describe('pausing at a picture change', () => {
  it('pausing one of two ads at the end of the current item moves nothing before it and nothing jumps at it', () => {
    const loop = { anchor: T0, firstSlotId: null };
    const both = [...menu, ad('a1', 5, 10, { by: 'rounds', n: 1 }), ad('a2', 6, 10, { by: 'minutes', n: 2 })];
    const at = T0 + 200_000;
    const cur = loopPosition(both, at, loop)!;
    const paused = both.map((s) => (s.id === 'a1' ? { ...s, endsAt: cur.endsAt } : s));
    const brief = (p: ReturnType<typeof loopPosition>) => p && [p.slot.id, p.startedAt, p.endsAt];
    for (let t = T0; t < cur.endsAt; t += 2_500) expect(brief(loopPosition(paused, t, loop))).toEqual(brief(loopPosition(both, t, loop)));
    // the next item starts exactly where the current one ends, and a1 never plays again
    const after = loopPosition(paused, cur.endsAt, loop)!;
    expect(after.startedAt).toBe(cur.endsAt);
    expect(sequence(paused, loop, cur.endsAt, cur.endsAt + 600_000)).not.toContain('a1');
  });

  it('pausing the last scheduled ad at a picture change: the menu goes on from the top at that change', () => {
    const loop = { anchor: T0, firstSlotId: null };
    const one = [...menu, ad('a1', 5, 10, { by: 'rounds', n: 1 })];
    const cur = loopPosition(one, T0 + 100_000, loop)!;
    const paused = one.map((s) => (s.id === 'a1' ? { ...s, endsAt: cur.endsAt } : s));
    const after = loopPosition(paused, cur.endsAt, loop)!;
    expect(after.startedAt).toBe(cur.endsAt);
    expect(after.slot.id).toBe('m1');
  });
});
