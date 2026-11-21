import { describe, expect, it, vi } from 'vitest';
import type { CateringOrder } from '@shared/data';
import { ALARM_BEEPS, ALARM_CYCLE_MS, CHIME_PEAK, MIN_RINGS, RING_MS, ackPatch, alarmRings, alarmTitle, dueReminders, whenText, ring, ringAt, staffedAt, startAlarm, stopAlarm, wakeAudio, type KitchenOrder } from './reminder';

const H = 3_600_000;
const MIN = 60_000;
const order = (id: string, dueAt: number, status: CateringOrder['status'] = 'open', kitchenAckFor?: number) =>
  ({ id, dueAt, status, customerName: id, phone: '', type: 'pickup', items: '', createdAt: 0, updatedAt: 0, kitchenAckFor }) as KitchenOrder;

describe('dueReminders', () => {
  const now = 100 * H;
  it('reminds open orders due within the hour, soonest first', () => {
    const list = [order('later', now + 2 * H), order('b', now + 50 * MIN), order('a', now + 10 * MIN)];
    expect(dueReminders(list, now).map((o) => o.id)).toEqual(['a', 'b']);
  });
  it('skips completed and acknowledged orders', () => {
    const done = order('done', now + 1000, 'completed');
    const seen = order('seen', now + 1000, 'open', now + 1000);
    expect(dueReminders([done, seen], now)).toEqual([]);
  });
  it('the acknowledgement is stored as the due time it was for', () => {
    expect(ackPatch(order('x', now + 1000))).toEqual({ kitchenAckFor: now + 1000 });
  });
  it('reminds again when the order time changes', () => {
    const moved = order('x', now + 2000, 'open', now + 1000); // acked for the old time
    expect(dueReminders([moved], now)).toHaveLength(1);
  });
  it('keeps a late order for an hour, then leaves it to its card', () => {
    expect(dueReminders([order('late', now - 59 * MIN)], now)).toHaveLength(1);
    expect(dueReminders([order('old', now - 61 * MIN)], now)).toEqual([]);
    expect(dueReminders([order('days', now - 72 * H)], now)).toEqual([]);
  });
});

describe('ringAt: only while the kitchen is staffed', () => {
  // Weekdays: prep from 10:00, open 11:00 to 21:00, break 14:00 to 17:00. Sunday closed on a special date.
  const wd = { open: 660, close: 1260, brk: [840, 1020] };
  const staff = { settings: { prepStart: 600, days: [wd, wd, wd, wd, wd, wd, wd] }, special: { '2026-11-22': { closed: true } } };
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime(); // Wed Nov 18 2026 is d=18

  it('rings 1 hour before when people are there', () => {
    expect(ringAt(at(18, 13), staff)).toBe(at(18, 12));
    expect(ringAt(at(18, 19), staff)).toBe(at(18, 18));
  });
  it('during the break, waits until people are back', () => {
    expect(ringAt(at(18, 17, 30), staff)).toBe(at(18, 17)); // 5:30 order: rings at 5:00, not 4:30
  });
  it('if people are back only after it is due, rings just before the break', () => {
    expect(ringAt(at(18, 16), staff)).toBe(at(18, 13, 45)); // 4:00 order, during the break
  });
  it('back only minutes before it is due: rings before they leave instead', () => {
    expect(ringAt(at(18, 17, 5), staff)).toBe(at(18, 13, 45)); // 5:05 order: not at 5:00 with 5 minutes left
    expect(ringAt(at(19, 10, 15), staff)).toBe(at(18, 20, 45)); // 10:15 AM order: the night before
    expect(ringAt(at(19, 10, 0), staff)).toBe(at(18, 20, 45)); // 10:00 AM, closing exactly 12 hours back counts
  });
  it('early morning orders ring when prep starts', () => {
    expect(ringAt(at(18, 10, 30), staff)).toBe(at(18, 10));
  });
  it('without staff hours, rings exactly 1 hour before', () => {
    expect(ringAt(at(18, 17, 30))).toBe(at(18, 16, 30));
    expect(ringAt(at(18, 17, 30), { nothing: true })).toBe(at(18, 16, 30));
  });
  it('dueReminders holds the 5:30 order during the break, then shows it at 5:00', () => {
    const o = order('x', at(18, 17, 30));
    expect(dueReminders([o], at(18, 16, 30), staff)).toEqual([]);
    expect(dueReminders([o], at(18, 17), staff)).toEqual([o]);
  });
  it('staffedAt: true only during staffed hours (never in the 2 to 5 break)', () => {
    expect(staffedAt(at(18, 12), staff)).toBe(true);
    expect(staffedAt(at(18, 15), staff)).toBe(false); // break
    expect(staffedAt(at(18, 9, 59), staff)).toBe(false); // before prep
    expect(staffedAt(at(18, 21, 30), staff)).toBe(false); // after closing
    expect(staffedAt(at(22, 12), staff)).toBe(false); // closed day
    expect(staffedAt(at(18, 3))).toBe(true); // no hours set up: always
  });
  it('no staff schedule saved (null): uses the planner\'s starting hours, so no alarm at 3 AM', () => {
    // Planner defaults: Mon-Thu open 11-9 with a 2-5 break, Fri-Sun 11-10, prep from 10.
    expect(staffedAt(at(18, 3), null)).toBe(false);
    expect(staffedAt(at(18, 12), null)).toBe(true); // Wednesday noon
    expect(staffedAt(at(18, 15), null)).toBe(false); // Wednesday break
    expect(staffedAt(at(20, 15), null)).toBe(true); // Friday, no break
    expect(ringAt(at(19, 10, 15), null)).toBe(at(18, 20, 45)); // 10:15 AM order: before closing the night before
  });
  it('on a special-hours day, prep starts the usual lead before that day\'s opening', () => {
    const special = { ...staff, special: { '2026-11-18': { open: 900, close: 1260 } } }; // opens 3 PM; prep normally 1 h ahead
    expect(staffedAt(at(18, 13, 59), special)).toBe(false);
    expect(staffedAt(at(18, 14), special)).toBe(true);
    expect(staffedAt(at(19, 10), special)).toBe(true); // a normal day keeps prep at 10
  });
  it('an order before opening, with nobody there the night before, rings at opening and is not dropped', () => {
    const noPrep = { settings: { days: [wd, wd, wd, wd, wd, wd, wd] }, special: { '2026-11-22': { closed: true } } };
    expect(ringAt(at(23, 11), noPrep)).toBe(at(23, 11)); // Monday 11:00 order after a closed Sunday
    expect(ringAt(at(23, 10, 30), noPrep)).toBe(at(23, 11)); // due before opening: rings at opening
    const o = order('x', at(23, 10, 30));
    expect(dueReminders([o], at(23, 9, 30), noPrep)).toEqual([]);
    expect(dueReminders([o], at(23, 11), noPrep)).toEqual([o]);
    expect(dueReminders([o], at(23, 11, 59), noPrep)).toEqual([o]);
    expect(dueReminders([o], at(23, 12, 1), noPrep)).toEqual([]);
  });
  it('a 4:00 order rung before the break stays until an hour after it is due', () => {
    const o = order('x', at(18, 16));
    expect(dueReminders([o], at(18, 13, 45), staff)).toEqual([o]);
    expect(dueReminders([o], at(18, 17, 1), staff)).toEqual([]);
  });
});

describe('heads-up wording names the day when it is not today', () => {
  const now = new Date(2026, 10, 23, 20, 46).getTime();
  const tomorrow = { type: 'pickup', dueAt: new Date(2026, 10, 24, 10, 15).getTime() };
  const today = { type: 'delivery', dueAt: new Date(2026, 10, 23, 21, 16).getTime() };
  it('says the day', () => {
    expect(whenText(tomorrow, now, true)).toBe('Pickup tomorrow at 10:15 AM');
    expect(whenText(tomorrow, now)).toBe('pickup tomorrow at 10:15 AM');
    expect(whenText({ ...tomorrow, dueAt: new Date(2026, 10, 25, 10, 15).getTime() }, now)).toBe('pickup on Wed, Nov 25 at 10:15 AM');
    expect(whenText(today, now, true)).toBe('Delivery at 9:16 PM, in 30 min');
  });
  it('the headline says "soon" only for today', () => {
    expect(alarmTitle([today], now)).toBe('Catering order soon');
    expect(alarmTitle([tomorrow], now)).toBe('Catering order tomorrow');
    // Just before midnight, an order 30 minutes away is "soon", with its countdown, not "tomorrow".
    const late = new Date(2026, 10, 23, 23, 50).getTime();
    const pastMidnight = { type: 'pickup', dueAt: late + 30 * 60_000 };
    expect(alarmTitle([pastMidnight], late)).toBe('Catering order soon');
    expect(whenText(pastMidnight, late)).toBe('pickup at 12:20 AM, in 30 min');
    expect(alarmTitle([today, tomorrow], now)).toBe('2 catering orders coming up');
    expect(alarmTitle([today, today], now)).toBe('2 catering orders soon');
  });
});

class FakeCtx {
  static made: FakeCtx[] = [];
  state = 'suspended';
  currentTime = 0;
  destination = {};
  peaks: number[] = [];
  oscillators: { type: string; stopped: number }[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  constructor() {
    FakeCtx.made.push(this);
  }
  createOscillator() {
    const o = { type: '', stopped: 0, frequency: { value: 0 }, connect: (g: unknown) => g, start() {}, stop() { o.stopped++; } };
    this.oscillators.push(o);
    return o;
  }
  createGain = () => ({
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime: (v: number) => this.peaks.push(v) },
    connect: (d: unknown) => d,
  });
}

describe('alarm sound', () => {
  const loud: boolean[] = [];
  (globalThis as { window?: unknown }).window = { AudioContext: FakeCtx, TablaAlarm: { loud: (on: boolean) => loud.push(on) } };
  const ctx = () => FakeCtx.made[0];
  const beeps = () => ctx().oscillators.length;

  it('wakes the sound on a tap, reuses it, and plays loud beeps that never clip', () => {
    wakeAudio();
    expect(FakeCtx.made).toHaveLength(1);
    expect(ctx().resume).toHaveBeenCalledTimes(1);
    ring();
    ring();
    expect(FakeCtx.made).toHaveLength(1); // one sound output for the page
    expect(beeps()).toBe(2 * ALARM_BEEPS);
    expect(ctx().oscillators.every((o) => o.type === 'square')).toBe(true);
    expect(Math.max(...ctx().peaks)).toBe(CHIME_PEAK);
    expect(CHIME_PEAK).toBeGreaterThan(0.4);
    expect(CHIME_PEAK).toBeLessThanOrEqual(1);
  });

  it('repeats until stopped, and always plays at least 2 full rings', () => {
    vi.useFakeTimers();
    ctx().oscillators = [];
    startAlarm();
    expect(loud).toEqual([true]); // the app turns the volume up
    expect(alarmRings()).toBe(1);
    stopAlarm(); // touched during the first ring
    vi.advanceTimersByTime(ALARM_CYCLE_MS);
    expect(alarmRings()).toBe(MIN_RINGS); // still plays the second
    vi.advanceTimersByTime(ALARM_CYCLE_MS);
    expect(alarmRings()).toBe(0); // then quiet
    expect(beeps()).toBe(MIN_RINGS * ALARM_BEEPS);
    expect(loud).toEqual([true, false]); // and the volume goes back

    // Nobody touches it: keeps ringing.
    startAlarm();
    vi.advanceTimersByTime(10 * ALARM_CYCLE_MS);
    expect(alarmRings()).toBe(11);
    // Touched later on: stops at once, mid-ring.
    vi.advanceTimersByTime(RING_MS / 2);
    stopAlarm();
    expect(alarmRings()).toBe(0);
    expect(ctx().oscillators.slice(-ALARM_BEEPS).every((o) => o.stopped > 0)).toBe(true);
    vi.advanceTimersByTime(5 * ALARM_CYCLE_MS);
    expect(beeps()).toBe((MIN_RINGS + 11) * ALARM_BEEPS);

    // A new heads-up during the last 2 rings calls the stop off.
    startAlarm();
    stopAlarm();
    startAlarm();
    vi.advanceTimersByTime(5 * ALARM_CYCLE_MS);
    expect(alarmRings()).toBe(6);
    stopAlarm();
    vi.useRealTimers();
  });
});
