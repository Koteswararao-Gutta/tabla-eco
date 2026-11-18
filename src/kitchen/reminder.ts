// 1-hour heads-up on the kitchen tablet. Pure helper so it is easy to test.
import type { CateringOrder, WithId } from '@shared/data';

export const REMIND_MS = 60 * 60_000;

/** Open orders due within the next hour (or already due) that this tablet hasn't acknowledged yet. */
export function dueReminders(orders: readonly WithId<CateringOrder>[], now: number, acked: ReadonlySet<string>): WithId<CateringOrder>[] {
  return orders
    .filter((o) => o.status === 'open' && o.dueAt - now <= REMIND_MS && !acked.has(o.id + ':' + o.dueAt))
    .sort((a, b) => a.dueAt - b.dueAt);
}

/** Acknowledgement key: changing an order's time brings its reminder back. */
export const ackKey = (o: { id: string; dueAt: number }) => o.id + ':' + o.dueAt;

/** A short two-note chime, made in the browser (no sound file needed). */
export function chime(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.65);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // No sound available: the banner still shows.
  }
}
