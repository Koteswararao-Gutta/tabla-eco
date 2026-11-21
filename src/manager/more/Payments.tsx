// More > Payments: one day's catering orders with amount and Paid / Unpaid, and the day's totals.
import { Link, useSearchParams } from 'react-router-dom';
import { useCollection, useNow } from '@shared/data';
import { PageHeader } from '@shared/ui';
import { amountLabel, dayLabel, dayStart, fromInputs, timeLabel, toDateInput } from '../catering/orders';
import { useAmountsOf } from '../catering/data';
import { paymentsOn } from './payments';

export default function Payments() {
  const now = useNow(60_000);
  // The day lives in the link, so coming back from an order returns to the same day.
  const [params, setParams] = useSearchParams();
  const picked = fromInputs(params.get('day') ?? '', '12:00');
  const day = dayStart(picked ?? now);
  // Only that day's orders and their amounts are loaded.
  const orders = useCollection('orders', { dueFrom: day, dueTo: dayStart(day, 1) });
  const amounts = useAmountsOf(orders).current;
  const go = (ms: number) => setParams({ day: toDateInput(ms) }, { replace: true });
  const data = orders && amounts ? paymentsOn(orders, amounts, day) : null;
  const longDate = new Date(day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <main className="t-page">
      <Link className="mo-back" to="/manager/more">‹ More</Link>
      <PageHeader title="Payments" />
      <div className="mo-day">
        <button className="t-btn mo-arrow" aria-label="Day before" onClick={() => go(dayStart(day, -1))}>‹</button>
        <label className="mo-date">
          <span>{dayLabel(day, now)}</span>
          <input type="date" aria-label="Date" value={toDateInput(day)} onChange={(e) => e.target.value && go(fromInputs(e.target.value, '12:00') ?? day)} />
        </label>
        <button className="t-btn mo-arrow" aria-label="Day after" onClick={() => go(dayStart(day, 1))}>›</button>
      </div>
      <p className="mo-longdate">{longDate}</p>

      {!data ? (
        <p className="t-sub">Loading…</p>
      ) : data.rows.length === 0 ? (
        <p className="mo-empty">No catering orders on this day.</p>
      ) : (
        <>
          <ul className="mo-list" data-testid="payments">
            {data.rows.map((r) => (
              <li key={r.order.id}>
                <Link className="mo-row" to={'/manager/catering?order=' + encodeURIComponent(r.order.id)}>
                  <span className="mo-row-main">
                    <b>{r.order.customerName || 'No name'}</b>
                    <span className="mo-row-time">{timeLabel(r.order.dueAt)}</span>
                    {r.status === 'cancelled' && r.paidSoFar > 0 && (
                      <span className="mo-row-time mo-refund" data-testid="refund-line">{r.refundNote ?? 'Refund? Add a note on the order.'}</span>
                    )}
                  </span>
                  <span className="mo-row-amt">
                    {r.status === 'cancelled' ? (r.paidSoFar > 0 ? `${amountLabel(r.paidSoFar)} paid` : 'Nothing paid') : r.amount === null ? 'No amount' : amountLabel(r.amount)}
                  </span>
                  <span className={'t-badge ' + (r.status === 'paid' ? 'good' : r.status === 'part' ? '' : 'bad')}>
                    {r.status === 'paid' ? 'Paid' : r.status === 'part' ? 'Part paid' : r.status === 'cancelled' ? 'Cancelled' : 'Unpaid'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mo-totals" data-testid="payment-totals">
            <div><span>Paid</span><b className="mo-good">{amountLabel(data.paidTotal)}</b></div>
            <div><span>Unpaid</span><b className="mo-bad">{amountLabel(data.unpaidTotal)}</b></div>
          </div>
          {data.rows.some((r) => r.status === 'cancelled') && <p className="mo-note mo-noamount">Cancelled orders are not in the totals.</p>}
        </>
      )}
    </main>
  );
}
