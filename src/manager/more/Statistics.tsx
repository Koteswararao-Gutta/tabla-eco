// More > Statistics: one week's catering orders (Monday to Sunday) with amounts, and the week's totals.
import { Link, useSearchParams } from 'react-router-dom';
import { useCollection, useNow } from '@shared/data';
import { PageHeader } from '@shared/ui';
import { amountLabel, dayStart, fromInputs, timeLabel, toDateInput } from '../catering/orders';
import { useAmountsOf } from '../catering/data';
import { weekStart, weekStats } from './stats';

const STATUS = { paid: ['Paid', 'good'], part: ['Part paid', ''], unpaid: ['Unpaid', 'bad'] } as const;

export default function Statistics() {
  const now = useNow(60_000);
  // The week lives in the link (its Monday), so coming back from an order returns to the same week.
  const [params, setParams] = useSearchParams();
  const picked = fromInputs(params.get('week') ?? '', '12:00');
  const week = weekStart(picked ?? now);
  // Only that week's orders and their amounts are loaded.
  const orders = useCollection('orders', { dueFrom: week, dueTo: weekStart(week, 1) });
  const amounts = useAmountsOf(orders).current;
  const go = (ms: number) => setParams({ week: toDateInput(ms) }, { replace: true });
  const data = orders && amounts ? weekStats(orders, amounts, week) : null;

  return (
    <main className="t-page">
      <Link className="mo-back" to="/manager/more">‹ More</Link>
      <PageHeader title="Statistics" />
      <div className="mo-day">
        <button className="t-btn mo-arrow" aria-label="Week before" onClick={() => go(weekStart(week, -1))}>‹</button>
        <span className="mo-date mo-week" data-testid="week-label">{weekLabel(week, now)}</span>
        <button className="t-btn mo-arrow" aria-label="Week after" onClick={() => go(weekStart(week, 1))}>›</button>
      </div>
      <p className="mo-longdate">{rangeLabel(week)}</p>

      {!data ? (
        <p className="t-sub">Loading…</p>
      ) : (
        <>
          <div className="mo-total" data-testid="week-total">
            <span>Week total</span>
            <b>{amountLabel(data.total) || '$0'}</b>
            <small>{data.rows.length === 1 ? '1 order' : `${data.rows.length} orders`}</small>
          </div>
          <div className="mo-totals" data-testid="week-paid-unpaid">
            <div><span>Paid</span><b className="mo-good">{amountLabel(data.paid)}</b></div>
            <div><span>Unpaid</span><b className="mo-bad">{amountLabel(data.unpaid)}</b></div>
          </div>
          {data.noAmount > 0 && (
            <p className="mo-note mo-noamount">
              {data.noAmount === 1 ? '1 order has no amount yet and is not counted.' : `${data.noAmount} orders have no amount yet and are not counted.`}
            </p>
          )}
          {data.rows.length === 0 ? (
            <p className="mo-empty">No catering orders this week.</p>
          ) : (
            <ul className="mo-list mo-week-list" data-testid="week-orders">
              {data.rows.map((r) => {
                const [label, tone] = STATUS[r.status];
                return (
                  <li key={r.order.id}>
                    <Link className="mo-row" to={'/manager/catering?order=' + encodeURIComponent(r.order.id)}>
                      <span className="mo-row-main">
                        <b>{r.order.customerName || 'No name'}</b>
                        <span className="mo-row-time">{dayShort(r.order.dueAt)} · {timeLabel(r.order.dueAt)}</span>
                      </span>
                      <span className="mo-row-amt">{r.amount === null ? 'No amount' : amountLabel(r.amount)}</span>
                      <span className={'t-badge ' + tone}>{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function weekLabel(monday: number, now: number): string {
  const diff = Math.round((monday - weekStart(now)) / (7 * 24 * 3600_000));
  if (diff === 0) return 'This week';
  if (diff === -1) return 'Last week';
  if (diff === 1) return 'Next week';
  return 'Week of ' + new Date(monday).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Mon, Nov 16 – Sun, Nov 22" */
function rangeLabel(monday: number): string {
  const f = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${f(monday)} – ${f(dayStart(monday, 6))}`;
}

/** "Wed 18" */
const dayShort = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + new Date(ms).getDate();
