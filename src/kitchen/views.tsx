// Kitchen list grouped by day (Today first), and the Calendar view: a month with order counts per day.
import { useState, type ReactNode } from 'react';
import type { CateringOrder, WithId } from '@shared/data';
import { dayLabel, dayStart, itemLines, ordersByDay, timeLabel } from '../manager/catering/orders';
import { MonthCalendar } from '../manager/catering/calendar';
import { kitchenGroups, weekdayLabel } from './days';

type Order = WithId<CateringOrder>;

const RELATIVE = ['Today', 'Tomorrow', 'Yesterday'];
const count = (n: number) => `${n} order${n === 1 ? '' : 's'}`;

/** Open orders under Today (big), Tomorrow, this week's day names, and Later. Empty groups are hidden. */
export function DayGroups({ orders, now, card }: { orders: Order[]; now: number; card: (o: Order) => ReactNode }) {
  return (
    <div className="k-groups">
      {kitchenGroups(orders, now).map((g) => (
        <section key={g.id} className={'k-group k-group-' + g.kind} aria-label={g.label} data-testid="kitchen-group">
          <h2>
            {g.label}
            <span className="k-group-count">{count(g.orders.length)}</span>
          </h2>
          <div className="k-grid">{g.orders.map(card)}</div>
        </section>
      ))}
    </div>
  );
}

/** A month at a glance; tap a day to see its orders. Open orders open their options. */
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
                <button key={o.id} type="button" className={'k-row k-cal-row' + (done ? ' done' : '')} disabled={done} onClick={() => onOpen(o)} data-testid="kitchen-cal-row">
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
                    <span className={'k-row-status' + (done ? ' good' : '')}>{done ? '✓ Completed' : 'Open ›'}</span>
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
