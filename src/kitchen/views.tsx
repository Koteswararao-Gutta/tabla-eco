// Kitchen list grouped by day (Today first), and the Calendar view: a month with order counts per day.
import { useState, type ReactNode } from 'react';
import type { CateringOrder, WithId } from '@shared/data';
import { countdown, dayLabel, dayStart, itemLines, ordersByDay, showsCountdown, timeLabel } from '../manager/catering/orders';
import { MonthCalendar } from '../manager/catering/calendar';
import { ItemList } from '../manager/catering';
import { orderLines } from '../manager/catering/lines';
import { kitchenGroups, weekdayLabel } from './days';

type Order = WithId<CateringOrder>;

const RELATIVE = ['Today', 'Tomorrow', 'Yesterday'];
const count = (n: number) => `${n} order${n === 1 ? '' : 's'}`;

/** Open orders under Today (big), Tomorrow, this week's day names, and Later. Empty groups are hidden.
 *  No count per group: the total is next to "Open orders" at the top. */
export function DayGroups({ orders, now, card }: { orders: Order[]; now: number; card: (o: Order, showDay: boolean) => ReactNode }) {
  return (
    <div className="k-groups">
      {kitchenGroups(orders, now).map((g) => (
        <section key={g.id} className={'k-group k-group-' + g.kind} aria-label={g.label} data-testid="kitchen-group">
          <h2>{g.label}</h2>
          {/* Today, Tomorrow and the weekday groups already name the day in the heading. */}
          <div className="k-grid">{g.orders.map((o) => card(o, g.kind === 'earlier' || g.kind === 'later'))}</div>
        </section>
      ))}
    </div>
  );
}

/** A month at a glance; tap a day to see its orders, tap an order to see all of it with its options. */
export function CalendarView({ orders, now, onOpen }: { orders: Order[]; now: number; onOpen: (o: Order) => void }) {
  const [picked, setPicked] = useState(() => dayStart(now));
  const dayOrders = ordersByDay(orders).get(picked) ?? [];
  const open = dayOrders.filter((o) => o.status === 'open').length;
  return (
    <div className="k-cal" data-testid="kitchen-calendar">
      <div className="cal k-cal-month">
        <MonthCalendar orders={orders} now={now} picked={picked} onPick={setPicked} />
      </div>
      <section className="k-cal-day" aria-label="Orders that day">
        <h2>
          {RELATIVE.includes(dayLabel(picked, now)) ? `${dayLabel(picked, now)}, ${weekdayLabel(picked)}` : weekdayLabel(picked)}
          <span className="k-group-count">{dayOrders.length === 0 ? 'No orders' : open === dayOrders.length ? count(open) : `${count(dayOrders.length)}, ${open} open`}</span>
        </h2>
        {dayOrders.length > 0 && (
          <div className="k-rows">
            {dayOrders.map((o) => {
              const done = o.status === 'completed';
              return (
                <button key={o.id} type="button" className={'k-row k-cal-row' + (done ? ' done' : '')} onClick={() => onOpen(o)} data-testid="kitchen-cal-row">
                  <span className="k-row-time">{timeLabel(o.dueAt)}</span>
                  <span className="k-row-main">
                    <span className="k-row-head">
                      <span className="k-row-name">{o.customerName}</span>
                      <span className={'t-badge' + (o.type === 'delivery' ? ' accent' : '')}>{o.type === 'delivery' ? 'Delivery' : 'Pickup'}</span>
                    </span>
                    <span className="k-row-items">
                      {o.people ? `${o.people} people · ` : ''}
                      {itemLines(o.items).join(' · ')}
                    </span>
                  </span>
                  <span className="k-row-side">
                    <span className={'k-row-status' + (done ? ' good' : '')}>{done ? '✓ Completed ›' : 'Open ›'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/** The whole order, as on a kitchen card (never amounts or payments, which the kitchen doesn't load). */
export function OrderDetails({ order: o, now }: { order: Order; now: number }) {
  const done = o.status === 'completed';
  const cd = countdown(o.dueAt, now);
  return (
    <div className="k-details" data-testid="kitchen-order-details">
      <div className="k-card-top">
        <div>
          <div className="k-due">{timeLabel(o.dueAt)}</div>
          <div className="k-day">{RELATIVE.includes(dayLabel(o.dueAt, now)) ? `${dayLabel(o.dueAt, now)}, ${weekdayLabel(dayStart(o.dueAt))}` : weekdayLabel(dayStart(o.dueAt))}</div>
        </div>
        <div className="k-card-right">
          {done ? (
            <span className="k-row-status good">✓ Completed{o.completedAt ? ` ${timeLabel(o.completedAt)}` : ''}</span>
          ) : (
            showsCountdown(o.dueAt, now) && <span className={'k-countdown' + (cd.late ? ' late' : '')}>{cd.text}</span>
          )}
          <span className={'t-badge k-type' + (o.type === 'delivery' ? ' accent' : '')}>{o.type === 'delivery' ? 'Delivery' : 'Pickup'}</span>
        </div>
      </div>
      <div className="k-who">
        <div className="k-phone">{o.phone}</div>
        {o.type === 'delivery' && o.address && <div className="k-address">{o.address}</div>}
        {!!o.people && <div className="k-people">{o.people} people</div>}
      </div>
      <ItemList lines={orderLines(o)} className="k-items" />
      {o.notes && <p className="k-notes">{o.notes}</p>}
    </div>
  );
}
