// Keeping live data and the shared clock alive on devices that run for days (TVs, the kitchen tablet).
// No Firebase imports here, so the timing can be unit tested.

import type { Unsubscribe } from './store';

export const LISTEN_RETRY_FIRST_MS = 10_000;
export const LISTEN_RETRY_MAX_MS = 60_000;

/**
 * Runs a live listener and starts it again after it fails (Firestore ends a listener for good on an
 * error, e.g. a lost sign-in or a permissions hiccup). Waits 10 s, then 20 s, 40 s, up to 60 s
 * between tries; a delivered value resets the wait. The screen keeps the last data meanwhile,
 * because nothing is sent to it on an error.
 */
export function keepListening(
  start: (onData: () => void, onError: (e: Error) => void) => Unsubscribe,
  label: string,
): Unsubscribe {
  let stop: Unsubscribe | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dead = false;
  let wait = LISTEN_RETRY_FIRST_MS;
  let round = 0;

  const run = () => {
    timer = null;
    if (dead) return;
    const mine = ++round;
    const onData = () => {
      if (mine === round) wait = LISTEN_RETRY_FIRST_MS;
    };
    const onError = (e: Error) => {
      if (dead || mine !== round || timer) return;
      console.warn(label, e?.message ?? e, `- trying again in ${wait / 1000} s`);
      const s = stop;
      stop = null;
      s?.();
      timer = setTimeout(run, wait);
      wait = Math.min(wait * 2, LISTEN_RETRY_MAX_MS);
    };
    const s = start(onData, onError);
    // An error may already have come in while starting; then this listener is finished.
    if (mine === round && !timer && !dead) stop = s;
    else s();
  };
  run();

  return () => {
    dead = true;
    if (timer) clearTimeout(timer);
    timer = null;
    stop?.();
    stop = null;
  };
}

export const CLOCK_RETRY_MS = 30_000;
export const CLOCK_REFRESH_MS = 60 * 60 * 1000;
export const CLOCK_JUMP_CHECK_MS = 60_000;
export const CLOCK_JUMP_MS = 2_000;

/**
 * Schedules clock syncs. `sync` resolves true when it reached the server.
 * - Until the first success: tries every 30 s. After that: every hour.
 * - Syncs again when the internet comes back (`online` event on `events`).
 * - Syncs again when the device's wall clock jumps (someone or the network changed the time),
 *   seen as a change of more than 2 s in wall clock minus monotonic clock, checked every minute.
 */
export function scheduleClockSync(
  sync: () => Promise<boolean>,
  opts: { events?: EventTarget | null; wall?: () => number; mono?: () => number } = {},
): () => void {
  const wall = opts.wall ?? (() => Date.now());
  const mono = opts.mono ?? (() => performance.now());
  let synced = false;
  let running = false;
  let again = false;
  let next: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const run = async () => {
    if (stopped) return;
    if (running) return void (again = true);
    running = true;
    if (next) clearTimeout(next);
    next = null;
    let ok = false;
    try {
      ok = await sync();
    } catch {
      ok = false;
    }
    running = false;
    if (stopped) return;
    if (ok) synced = true;
    if (again) {
      again = false;
      return void run();
    }
    next = setTimeout(run, synced ? CLOCK_REFRESH_MS : CLOCK_RETRY_MS);
  };

  let base = wall() - mono();
  const jumpCheck = setInterval(() => {
    const now = wall() - mono();
    if (Math.abs(now - base) > CLOCK_JUMP_MS) {
      base = now;
      void run();
    }
  }, CLOCK_JUMP_CHECK_MS);

  const onOnline = () => void run();
  opts.events?.addEventListener('online', onOnline);
  void run();

  return () => {
    stopped = true;
    if (next) clearTimeout(next);
    clearInterval(jumpCheck);
    opts.events?.removeEventListener('online', onOnline);
  };
}

/** Wraps an async job so a new call while the last one is still running starts nothing and returns null. */
export function singleFlight<T>(job: () => Promise<T>): () => Promise<T> | null {
  let running: Promise<T> | null = null;
  return () => {
    if (running) return null;
    const p = job();
    running = p;
    const done = () => {
      if (running === p) running = null;
    };
    p.then(done, done);
    return p;
  };
}

/** How long a save waits for the server before it counts as done. Firestore has already put the change in
 *  this device's copy (screens show it at once) and sends it when the internet is back. */
export const SAVE_WAIT_MS = 2500;

/** A save the server refused after the screen had already counted it as done. */
export interface SaveFailure {
  /** e.g. "updateDoc orders/abc" */
  what: string;
  message: string;
}

const saveFailureListeners = new Set<(f: SaveFailure) => void>();

/** Calls `listener` for every late refusal (see `queued`). Returns a function that stops listening. */
export function onSaveFailure(listener: (f: SaveFailure) => void): () => void {
  saveFailureListeners.add(listener);
  return () => void saveFailureListeners.delete(listener);
}

/** Tells every listener (the red "Not saved" banner) that a save was refused. */
export function reportSaveFailure(what: string, e: unknown): void {
  const f: SaveFailure = { what, message: String((e as { message?: unknown })?.message ?? e) };
  for (const l of [...saveFailureListeners]) {
    try {
      l(f);
    } catch (err) {
      console.error('save failure listener', err);
    }
  }
}

/**
 * A save as the screens see it: done once the server confirms it, or once it has waited SAVE_WAIT_MS (or at once
 * when the device knows it is offline), because Firestore keeps the change and sends it later. So "Saving…" never
 * hangs without internet. A refusal (e.g. the rules) that comes back in that time still fails the save as before;
 * one that comes back later is written to the console and reported with `reportSaveFailure`, so the app shows
 * a red "Not saved" banner.
 */
export function queued(write: Promise<void>, what: string, waitMs = SAVE_WAIT_MS, offline = isOffline()): Promise<void> {
  let settled = false;
  const sent = write.then(
    () => void (settled = true),
    (e) => {
      if (settled) {
        console.error(`${what}: the server refused this save`, e);
        reportSaveFailure(what, e);
      }
      settled = true;
      throw e;
    },
  );
  sent.catch(() => {}); // a late refusal is reported above, never an unhandled rejection
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      settled = true;
      resolve();
    }, offline ? 0 : waitMs);
  });
  return Promise.race([sent, waited]).finally(() => clearTimeout(timer));
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
