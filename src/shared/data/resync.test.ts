import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepListening, queued, SAVE_WAIT_MS, scheduleClockSync, singleFlight } from './resync';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A fake listener: records each start, lets the test push data or an error into the latest one. */
function fakeListener() {
  const starts: { ok: () => void; fail: (e: Error) => void; stopped: boolean }[] = [];
  const start = (ok: () => void, fail: (e: Error) => void) => {
    const l = { ok, fail, stopped: false };
    starts.push(l);
    return () => void (l.stopped = true);
  };
  return { starts, start, last: () => starts[starts.length - 1] };
}

describe('keepListening', () => {
  it('starts again after an error, waiting longer each time up to 60 s', () => {
    const f = fakeListener();
    const stop = keepListening(f.start, 'test');
    expect(f.starts).toHaveLength(1);

    f.last().fail(new Error('gone'));
    expect(f.starts[0].stopped).toBe(true);
    vi.advanceTimersByTime(9_999);
    expect(f.starts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(f.starts).toHaveLength(2);

    f.last().fail(new Error('gone'));
    vi.advanceTimersByTime(19_999);
    expect(f.starts).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(f.starts).toHaveLength(3);

    f.last().fail(new Error('gone')); // 40 s
    vi.advanceTimersByTime(40_000);
    f.last().fail(new Error('gone')); // capped at 60 s
    vi.advanceTimersByTime(59_999);
    expect(f.starts).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(f.starts).toHaveLength(5);
    stop();
    expect(f.last().stopped).toBe(true);
  });

  it('data resets the wait; stopping cancels a pending retry', () => {
    const f = fakeListener();
    const stop = keepListening(f.start, 'test');
    f.last().fail(new Error('x'));
    vi.advanceTimersByTime(10_000);
    f.last().ok();
    f.last().fail(new Error('x'));
    vi.advanceTimersByTime(10_000);
    expect(f.starts).toHaveLength(3);

    f.last().fail(new Error('x'));
    stop();
    vi.advanceTimersByTime(120_000);
    expect(f.starts).toHaveLength(3);
  });

  it('ignores errors from an old listener and handles an error during start', () => {
    let calls = 0;
    const stops: boolean[] = [];
    const stop = keepListening((_ok, fail) => {
      const i = calls++;
      stops[i] = false;
      if (i === 0) fail(new Error('at once'));
      return () => void (stops[i] = true);
    }, 'test');
    expect(stops[0]).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(calls).toBe(2);
    stop();
    expect(stops[1]).toBe(true);
  });
});

describe('scheduleClockSync', () => {
  it('retries every 30 s until it works, then hourly', async () => {
    let ok = false;
    const sync = vi.fn(async () => ok);
    const stop = scheduleClockSync(sync, { wall: () => Date.now(), mono: () => Date.now() });
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sync).toHaveBeenCalledTimes(2);
    ok = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sync).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(sync).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(sync).toHaveBeenCalledTimes(4);
    stop();
  });

  it('syncs again when the internet comes back', async () => {
    const sync = vi.fn(async () => true);
    const events = new EventTarget();
    const stop = scheduleClockSync(sync, { events, wall: () => Date.now(), mono: () => Date.now() });
    await vi.advanceTimersByTimeAsync(0);
    events.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
    stop();
    events.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('syncs again when the wall clock jumps', async () => {
    const sync = vi.fn(async () => true);
    let skew = 0;
    const stop = scheduleClockSync(sync, { wall: () => Date.now() + skew, mono: () => Date.now() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(1);
    skew = 1_500; // small drift: ignored
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(1);
    skew = -3_600_000; // clock set back an hour
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('singleFlight', () => {
  it('skips a new attempt while the last one is still waiting', async () => {
    let finish: (v: boolean) => void = () => {};
    const job = vi.fn(() => new Promise<boolean>((r) => (finish = r)));
    const once = singleFlight(job);
    const first = once();
    expect(first).not.toBeNull();
    expect(once()).toBeNull();
    expect(once()).toBeNull();
    expect(job).toHaveBeenCalledTimes(1);
    finish(true);
    await expect(first).resolves.toBe(true);
    expect(once()).not.toBeNull();
    expect(job).toHaveBeenCalledTimes(2);
  });

  it('with the clock schedule: a write that never ends is queued only once', async () => {
    const write = vi.fn(() => new Promise<boolean>(() => {})); // internet down behind working Wi-Fi
    const once = singleFlight(write);
    const sync = async () => {
      const a = once();
      if (!a) return false;
      return Promise.race([a, new Promise<false>((r) => setTimeout(() => r(false), 10_000))]);
    };
    const stop = scheduleClockSync(sync, { wall: () => Date.now(), mono: () => Date.now() });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(write).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('queued (a save never waits for the internet)', () => {
  const never = () => new Promise<void>(() => {});
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    errors.mockRestore();
  });

  it('is done as soon as the server confirms', async () => {
    let done = false;
    queued(Promise.resolve(), 'x', SAVE_WAIT_MS, false).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('is done after the wait when the server does not answer (internet down)', async () => {
    let done = false;
    queued(never(), 'x', SAVE_WAIT_MS, false).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('is done at once when the device knows it is offline', async () => {
    let done = false;
    queued(never(), 'x', SAVE_WAIT_MS, true).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('still fails when the server refuses in time', async () => {
    const p = queued(Promise.reject(new Error('permission-denied')), 'x', SAVE_WAIT_MS, false);
    await expect(p).rejects.toThrow('permission-denied');
  });

  it('logs a refusal that comes after the save already counted as done, with no unhandled rejection', async () => {
    let refuse!: (e: Error) => void;
    const p = queued(new Promise<void>((_, j) => (refuse = j)), 'setDoc orders/1', SAVE_WAIT_MS, false);
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS);
    await expect(p).resolves.toBeUndefined();
    refuse(new Error('permission-denied'));
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveBeenCalledWith('setDoc orders/1: the server refused this save', expect.any(Error));
  });
});
