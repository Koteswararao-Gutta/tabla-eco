// Kitchen "Prep": pick a day, see what to cook for that day's open catering orders, added up.
// One of the kitchen board's views (List / Calendar / Prep), so it shares the header and goes back to the
// list after 3 minutes with no touch. Self-contained so it is easy to change or take out.
import { useState } from 'react';
import { useDoc, type CateringOrder, type WithId } from '@shared/data';
import { dayLabel, dayStart } from '../manager/catering/orders';
import { menuDishes } from '../manager/catering/lines';
import { prepFor } from './prep';
import './prep.css';

/** How far ahead the arrows go: today plus this many days. */
export const PREP_MAX_DAYS = 13;

export function PrepView({ orders, now }: { orders: WithId<CateringOrder>[]; now: number }) {
  // The picked day itself (its midnight), not "days from today", so it doesn't move on at midnight.
  const today = dayStart(now);
  const last = dayStart(now, PREP_MAX_DAYS);
  const [picked, setPicked] = useState(today);
  const day = Math.min(Math.max(picked, today), last);
  const label = dayLabel(day, now);
  const date = new Date(day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const near = label === 'Today' || label === 'Tomorrow';
  // The menu gives dish names and order; orders show without it (it may still be loading, or missing).
  const menu = useDoc('toastMenu', 'current');
  const prep = prepFor(orders, day, menuDishes(menu));

  return (
    <div className="kp">
      <div className="kp-days">
        <button className="t-btn kp-arrow" aria-label="Day before" disabled={day <= today} onClick={() => setPicked(dayStart(day, -1))}>
          ‹
        </button>
        <div className="kp-day" aria-live="polite">
          <span className="kp-day-label">{near ? label : date}</span>
          {near && <span className="kp-day-date">{date}</span>}
        </div>
        <button className="t-btn kp-arrow" aria-label="Next day" disabled={day >= last} onClick={() => setPicked(dayStart(day, 1))}>
          ›
        </button>
      </div>

      {prep.orders === 0 ? (
        <div className="t-empty k-empty">No open orders for {near ? label.toLowerCase() : date}.</div>
      ) : (
        <>
          <p className="kp-sum">
            {prep.orders} open {prep.orders === 1 ? 'order' : 'orders'}
          </p>
          {prep.notes.length > 0 && (
            <section className="kp-notes" aria-label="Order notes">
              {prep.notes.map((n, i) => (
                <p key={i} className="kp-note" data-testid="prep-note">
                  <b>{n.customer}:</b> {n.text}
                </p>
              ))}
            </section>
          )}
          {prep.dishes.length > 0 && (
            <ul className="kp-list" aria-label="Totals">
              {prep.dishes.map((d) => (
                <li key={d.key} className="kp-dish" data-testid="prep-dish">
                  <div className="kp-dish-main">
                    <span className="kp-dish-name">{d.name}</span>
                    <span className="kp-dish-total">{d.totals.join(', ')}</span>
                  </div>
                  <ul className="kp-from">
                    {d.from.map((f, i) => (
                      <li key={i}>
                        {f.text}
                        {f.check && <span className="kp-check"> Check order</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {prep.others.length > 0 && (
            <section className="kp-others" aria-label="Other items">
              <h2>Other items (not added up)</h2>
              <ul className="kp-list">
                {prep.others.map((o, i) => (
                  <li key={i} className="kp-other" data-testid="prep-other">
                    <span>{o.text}</span>
                    <span className="kp-who">{o.customer}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
