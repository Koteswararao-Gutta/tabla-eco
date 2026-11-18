// Manager > Catering > Calendar: a month at a glance, so a new order can go on a quiet day or time.
import { useState } from 'react';
import { Sheet } from '@shared/ui';
import type { CateringOrder, WithId } from '@shared/data';
import { dayLabel, dayStart, monthGrid, ordersByDay, timeLabel } from './orders';

type Order = WithId<CateringOrder>;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function CalendarSheet(props: { orders: Order[]; now: number; onClose: () => void; onOpen: (o: Order) => void; onNew: (day: number) => void }) {
  const { orders, now, onClose, onOpen, onNew } = props;
  const today = dayStart(now);
  const [month, setMonth] = useState(() => {
    const d = new Date(now);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [picked, setPicked] = useState(today);
  const byDay = ordersByDay(orders);
  const weeks = monthGrid(month.y, month.m);
  const move = (by: number) => {
    const d = new Date(month.y, month.m + by, 1);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  };
  const thisMonth = new Date(now).getMonth() === month.m && new Date(now).getFullYear() === month.y;
  const title = new Date(month.y, month.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const monthCount = weeks.flat().reduce((n: number, d) => n + (d ? byDay.get(d)?.length ?? 0 : 0), 0);

  const dayOrders = byDay.get(picked) ?? [];
  const people = dayOrders.reduce((n, o) => n + (o.people ?? 0), 0);

  return (
    <Sheet open title="Calendar" onClose={onClose}>
      <div className="cal" data-testid="calendar">
        <div className="cal-head">
          <button className="t-btn cal-nav" aria-label="Previous month" onClick={() => move(-1)}>
            ‹
          </button>
          <div className="cal-title">
            <b>{title}</b>
            <span>{monthCount === 0 ? 'No orders' : `${monthCount} order${monthCount === 1 ? '' : 's'}`}</span>
          </div>
          <button className="t-btn cal-nav" aria-label="Next month" onClick={() => move(1)}>
            ›
          </button>
        </div>
        {!thisMonth && (
          <button
            className="t-btn ghost cal-today"
            onClick={() => {
              const d = new Date(now);
              setMonth({ y: d.getFullYear(), m: d.getMonth() });
              setPicked(today);
            }}
          >
            Back to today
          </button>
        )}
        <div className="cal-grid" role="grid" aria-label={title}>
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="cal-wd" aria-hidden>
              {w}
            </span>
          ))}
          {weeks.flat().map((d, i) => {
            if (!d) return <span key={i} />;
            const list = byDay.get(d) ?? [];
            const n = list.length;
            const cls = ['cal-day', d < today ? 'past' : '', d === today ? 'today' : '', d === picked ? 'picked' : '', n >= 3 ? 'busy' : n > 0 ? 'some' : ''].filter(Boolean).join(' ');
            const label = `${new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: ${n === 0 ? 'no orders' : `${n} order${n === 1 ? '' : 's'}`}`;
            return (
              <button key={i} className={cls} aria-label={label} aria-pressed={d === picked} onClick={() => setPicked(d)}>
                <span className="cal-num">{new Date(d).getDate()}</span>
                <span className="cal-count">{n > 0 ? n : ''}</span>
              </button>
            );
          })}
        </div>
        <p className="cal-key">
          <span className="cal-dot some" /> 1–2 orders <span className="cal-dot busy" /> 3 or more
        </p>

        <section className="cal-list" aria-label="Orders that day">
          <h3>
            {dayLabel(picked, now)}
            <span>
              {dayOrders.length === 0 ? 'No orders' : `${dayOrders.length} order${dayOrders.length === 1 ? '' : 's'}`}
              {people > 0 && ` · ${people} people`}
            </span>
          </h3>
          {dayOrders.map((o) => (
            <button key={o.id} className={'cal-row' + (o.status === 'completed' ? ' done' : '')} onClick={() => onOpen(o)}>
              <b>{timeLabel(o.dueAt)}</b>
              <span className="cal-row-name">{o.customerName}</span>
              <span className="cal-row-meta">
                {o.status === 'completed' ? '✓ Done' : o.type === 'delivery' ? 'Delivery' : 'Pickup'}
                {o.people ? ` · ${o.people}` : ''}
              </span>
            </button>
          ))}
          {picked >= today && (
            <button className="t-btn accent block" onClick={() => onNew(picked)}>
              + New order on {new Date(picked).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </button>
          )}
        </section>
      </div>
    </Sheet>
  );
}
