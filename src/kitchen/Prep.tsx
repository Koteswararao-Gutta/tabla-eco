// Kitchen "Prep": pick a day, see what to cook for that day's open catering orders, added up.
// Self-contained so it is easy to change or take out: index.tsx only adds a "Prep" button.
import { useState, type ReactNode } from 'react';
import { Logo } from '@shared/ui';
import { useDoc, type CateringOrder, type WithId } from '@shared/data';
import { dayLabel, dayStart, timeLabel } from '../manager/catering/orders';
import { menuDishes } from '../manager/catering/lines';
import { prepFor } from './prep';
import './prep.css';

/** How far ahead the arrows go: today plus this many days. */
const MAX_DAYS = 13;

export function PrepView({ orders, now, banner, onBack }: { orders: WithId<CateringOrder>[] | null; now: number; banner: ReactNode; onBack: () => void }) {
  const [ahead, setAhead] = useState(0);
  const day = dayStart(now, ahead);
  const label = dayLabel(day, now);
  const date = new Date(day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  // The menu, so an order saved as plain text (before items had a dish picker) still adds up.
  const menu = useDoc('toastMenu', 'current');
  const prep = orders && menu !== undefined ? prepFor(orders, day, menuDishes(menu)) : null;

  return (
    <div className="k-board">
      <header className="k-bar">
        <div className="k-bar-title">
          <Logo className="k-logo" />
          <h1>Prep</h1>
        </div>
        <span className="k-clock">{timeLabel(now)}</span>
        <button className="t-btn primary k-bar-btn" onClick={onBack}>
          ← Back to open orders
        </button>
      </header>
      {banner}

      <div className="kp-days">
        <button className="t-btn kp-arrow" aria-label="Day before" disabled={ahead === 0} onClick={() => setAhead(ahead - 1)}>
          ‹
        </button>
        <div className="kp-day">
          <span className="kp-day-label">{label}</span>
          {label !== date && <span className="kp-day-date">{date}</span>}
        </div>
        <button className="t-btn kp-arrow" aria-label="Next day" disabled={ahead >= MAX_DAYS} onClick={() => setAhead(ahead + 1)}>
          ›
        </button>
      </div>

      {!prep ? null : prep.orders === 0 ? (
        <div className="t-empty k-empty">No open orders for {label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : date}.</div>
      ) : (
        <>
          <p className="kp-sum">
            {prep.orders} open {prep.orders === 1 ? 'order' : 'orders'}
          </p>
          {prep.dishes.length > 0 && (
            <ul className="kp-list" aria-label="Totals">
              {prep.dishes.map((d) => (
                <li key={d.name} className="kp-dish" data-testid="prep-dish">
                  <div className="kp-dish-main">
                    <span className="kp-dish-name">{d.name}</span>
                    <span className="kp-dish-total">{d.totals.join(', ')}</span>
                  </div>
                  <div className="kp-from">{d.from.join(' · ')}</div>
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
                    <span className="kp-from">{o.customer}</span>
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
