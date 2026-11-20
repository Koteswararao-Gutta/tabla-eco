// The 1-hour heads-up as an alarm nobody can miss: the whole screen flashes and a loud siren repeats
// until someone touches the screen. Only while the kitchen is staffed (staff schedule hours).
import { useEffect } from 'react';
import { store } from '@shared/data';
import { countdown, timeLabel } from '../manager/catering/orders';
import { ackPatch, startAlarm, stopAlarm, type KitchenOrder } from './reminder';

/** Rings while `on`. Turning off lets it finish its first 2 rings (see stopAlarm). */
function useSiren(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    startAlarm();
    return stopAlarm;
  }, [on]);
}

/** Full-screen flashing alarm for the heads-ups in `reminders`. A touch anywhere acknowledges them all
 *  (saved on the orders, so every kitchen tablet goes quiet). No PIN needed. */
export function Alarm({ reminders, now, on }: { reminders: KitchenOrder[]; now: number; on: boolean }) {
  useSiren(on);
  if (!on) return null;
  const stop = () => {
    stopAlarm();
    reminders.forEach((o) => store.updateDoc('orders', o.id, ackPatch(o)).catch(() => {})); // an order deleted meanwhile just goes
  };
  return (
    <div className="k-alarm" role="alertdialog" aria-label="Catering order alarm" data-testid="kitchen-alarm" onClick={stop}>
      <div className="k-alarm-in">
        <p className="k-alarm-title">{reminders.length > 1 ? `${reminders.length} catering orders soon` : 'Catering order soon'}</p>
        <ul className="k-alarm-list">
          {reminders.map((o) => (
            <li key={o.id}>
              <b>{o.customerName}</b>
              <span>
                {o.type === 'delivery' ? 'Delivery' : 'Pickup'} at {timeLabel(o.dueAt)}, {countdown(o.dueAt, now).text}
              </span>
            </li>
          ))}
        </ul>
        <button type="button" className="k-alarm-btn">
          Touch anywhere to stop
        </button>
      </div>
    </div>
  );
}
