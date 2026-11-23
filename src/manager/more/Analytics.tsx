// More > Analytics: catering money and orders for a week, month, year or picked dates, in one place.
// Sales, collected and still owed; how customers paid and who took it; top dishes; a chart; and every order
// in the range (tap a number to see the orders behind it). Manager app only: amounts never reach the kitchen.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCollection, useNow } from '@shared/data';
import { PageHeader } from '@shared/ui';
import { amountLabel, dayStart, fromInputs, timeLabel, toDateInput } from '../catering/orders';
import { useAmountsOf } from '../catering/data';
import { qtyNumber } from '../catering/lines';
import { useAppBase } from '../mode';
import {
  analyze,
  datesRange,
  filteredAmount,
  filterRows,
  periodOf,
  RANGE_KINDS,
  type Analytics as Data,
  type ListFilter,
  type Range,
  type RangeKind,
  type Row,
  type Split,
} from './analytics';

const STATUS: Record<Row['status'], [string, string]> = {
  paid: ['Paid', 'good'],
  part: ['Part paid', ''],
  unpaid: ['Unpaid', 'bad'],
  cancelled: ['Cancelled', ''],
};

const money = (n: number) => amountLabel(n) || '$0';
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export default function Analytics() {
  const now = useNow(60_000);
  const base = useAppBase();
  // Everything picked lives in the link, so coming back from an order returns to the same view.
  const [params, setParams] = useSearchParams();
  const kind = (RANGE_KINDS.some((k) => k.value === params.get('r')) ? params.get('r') : 'month') as RangeKind;
  const anchor = fromInputs(params.get('d') ?? '', '12:00') ?? now;
  const fromText = params.get('from') ?? toDateInput(dayStart(now, -29));
  const toText = params.get('to') ?? toDateInput(now);
  const filter: ListFilter = params.get('f') ?? 'all';
  const range: Range | null = kind === 'dates' ? datesRange(fromText, toText) : periodOf(kind, anchor);

  const set = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(change)) v === null ? next.delete(k) : next.set(k, v);
    setParams(next, { replace: true });
  };
  const step = (by: number) => kind !== 'dates' && range && set({ d: toDateInput(periodOf(kind, anchor, by).from), f: null });

  // Only the range's orders, and their amounts, are loaded (dueAt range: no composite index needed).
  const orders = useCollection('orders', range ? { dueFrom: range.from, dueTo: range.to } : { ids: [] });
  const amounts = useAmountsOf(range ? orders : null).current;
  const data = useMemo(() => (range && orders && amounts ? analyze(orders, amounts, range) : null), [range?.from, range?.to, orders, amounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFilter = (f: ListFilter) => {
    set({ f: f === filter || f === 'all' ? null : f });
    requestAnimationFrame(() => document.getElementById('an-orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <main className="t-page an">
      <Link className="mo-back" to={base + '/more'}>‹ More</Link>
      <PageHeader title="Analytics" />

      <div className="t-seg an-kinds" role="group" aria-label="Range">
        {RANGE_KINDS.map((k) => (
          <button key={k.value} aria-pressed={kind === k.value} onClick={() => set({ r: k.value === 'month' ? null : k.value, d: null, f: null })}>
            {k.label}
          </button>
        ))}
      </div>

      {kind === 'dates' ? (
        <div className="an-dates">
          <label className="t-field">
            <span>From</span>
            <input className="t-input" type="date" data-testid="an-from" value={fromText} onChange={(e) => set({ from: e.target.value, f: null })} />
          </label>
          <label className="t-field">
            <span>To</span>
            <input className="t-input" type="date" data-testid="an-to" value={toText} onChange={(e) => set({ to: e.target.value, f: null })} />
          </label>
        </div>
      ) : (
        <div className="mo-day">
          <button className="t-btn mo-arrow" aria-label={`${cap(kind)} before`} onClick={() => step(-1)}>‹</button>
          <span className="mo-date mo-week" data-testid="an-period">{range && periodLabel(kind, range, now)}</span>
          <button className="t-btn mo-arrow" aria-label={`${cap(kind)} after`} onClick={() => step(1)}>›</button>
        </div>
      )}
      {range ? <p className="mo-longdate">{rangeLabel(range)} · by order date</p> : <p className="an-error" role="alert">Please pick a start date on or before the end date.</p>}

      {range && !data && <p className="t-sub an-loading">Loading…</p>}
      {data && <Body data={data} filter={filter} pickFilter={pickFilter} base={base} />}
    </main>
  );
}

function Body({ data, filter, pickFilter, base }: { data: Data; filter: ListFilter; pickFilter: (f: ListFilter) => void; base: string }) {
  const rows = filterRows(data.rows, filter);
  return (
    <>
      <section className="an-hero" data-testid="an-sales">
        <span>Sales</span>
        <b>{money(data.sales)}</b>
        <small>
          {plural(data.orders, 'order')}
          {data.average !== null && ` · average ${money(Math.round(data.average))}`}
        </small>
      </section>

      <div className="an-pair" data-testid="an-money">
        <div>
          <span>Collected</span>
          <b className="mo-good">{money(data.collected)}</b>
        </div>
        <button className="an-tile-btn" onClick={() => pickFilter('unpaid')} aria-label={`Still owed ${money(data.owed)}: show unpaid orders`}>
          <span>Still owed</span>
          <b className={data.owed > 0 ? 'mo-bad' : ''}>{money(data.owed)}</b>
          <small>{data.unpaid > 0 ? plural(data.unpaid, 'order') + ' not paid ›' : 'All paid'}</small>
        </button>
      </div>

      {data.noAmount > 0 && (
        <button className="an-note" onClick={() => pickFilter('noamount')} data-testid="an-noamount">
          {data.noAmount === 1 ? '1 order has no amount' : `${data.noAmount} orders have no amount`}, so {data.noAmount === 1 ? 'it is' : 'they are'} not in Sales. <u>Show</u>
        </button>
      )}

      {data.orders > 0 && <Chart data={data} />}

      {data.byMethod.length > 0 && (
        <SplitList title="How customers paid" testId="an-methods" splits={data.byMethod} total={data.collected} prefix="m:" filter={filter} pickFilter={pickFilter} />
      )}
      {data.byStaff.length > 0 && (
        <SplitList title="Taken by" testId="an-staff" splits={data.byStaff} total={data.collected} prefix="s:" filter={filter} pickFilter={pickFilter} />
      )}

      {data.orders > 0 && (
        <section className="an-sec">
          <h2 className="an-h2">Orders</h2>
          <div className="an-facts">
            <span><b>{data.pickup}</b> pickup</span>
            <span><b>{data.delivery}</b> delivery</span>
            {data.cancelled.orders > 0 && (
              <button className="an-link" onClick={() => pickFilter('cancelled')}>
                <b>{data.cancelled.orders}</b> cancelled{data.cancelled.paid > 0 && ` (${money(data.cancelled.paid)} paid on them)`}
              </button>
            )}
          </div>
        </section>
      )}

      {data.dishes.length > 0 && <Dishes data={data} />}

      <section className="an-sec" id="an-orders">
        <h2 className="an-h2">{data.rows.length === 0 ? 'Orders' : 'Every order'}</h2>
        {data.rows.length === 0 ? (
          <p className="mo-empty">No catering orders in these dates.</p>
        ) : (
          <>
            <div className="an-chips" role="group" aria-label="Show">
              {(
                [
                  ['all', 'All', data.rows.length],
                  ['unpaid', 'Unpaid', data.unpaid],
                  ['noamount', 'No amount', data.noAmount],
                  ['cancelled', 'Cancelled', data.cancelled.orders],
                ] as const
              )
                .filter(([k, , n]) => k === 'all' || n > 0 || filter === k)
                .map(([k, label, n]) => (
                  <button key={k} className="an-chip" aria-pressed={filter === k} onClick={() => pickFilter(k)}>
                    {label} <span>{n}</span>
                  </button>
                ))}
              {(filter.startsWith('m:') || filter.startsWith('s:')) && (
                <button className="an-chip" aria-pressed="true" onClick={() => pickFilter('all')} aria-label="Clear filter">
                  {splitName(data, filter)} <span>×</span>
                </button>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="mo-empty">No orders here.</p>
            ) : (
              <ul className="mo-list" data-testid="an-list">
                {rows.map((r) => (
                  <OrderRow key={r.order.id} r={r} filter={filter} base={base} />
                ))}
              </ul>
            )}
            {filter === 'all' && data.cancelled.orders > 0 && <p className="mo-note mo-noamount">Cancelled orders are not in any total.</p>}
          </>
        )}
      </section>
    </>
  );
}

function OrderRow({ r, filter, base }: { r: Row; filter: ListFilter; base: string }) {
  const [label, tone] = STATUS[r.status];
  const part = filteredAmount(r, filter);
  const amt =
    part !== null
      ? money(part)
      : r.status === 'cancelled'
        ? r.collected > 0
          ? `${money(r.collected)} paid`
          : 'Nothing paid'
        : r.pay.amount === null
          ? 'No amount'
          : amountLabel(r.pay.amount);
  return (
    <li>
      <Link className="mo-row" to={base + '/catering?order=' + encodeURIComponent(r.order.id)}>
        <span className="mo-row-main">
          <b>{r.order.customerName || 'No name'}</b>
          <span className="mo-row-time">
            {dayShort(r.order.dueAt)} · {timeLabel(r.order.dueAt)}
          </span>
          {r.status === 'part' && <span className="mo-row-time an-owed">{money(r.owed)} still owed</span>}
          {r.status === 'cancelled' && r.collected > 0 && (
            <span className="mo-row-time mo-refund" data-testid="refund-line">{r.pay.refundNote ?? 'Refund? Add a note on the order.'}</span>
          )}
        </span>
        <span className="mo-row-amt">{amt}</span>
        <span className={'t-badge ' + tone}>{label}</span>
      </Link>
    </li>
  );
}

function SplitList(props: { title: string; testId: string; splits: Split[]; total: number; prefix: string; filter: ListFilter; pickFilter: (f: ListFilter) => void }) {
  const { title, testId, splits, total, prefix, filter, pickFilter } = props;
  return (
    <section className="an-sec" data-testid={testId}>
      <h2 className="an-h2">{title}</h2>
      <ul className="an-splits">
        {splits.map((s) => {
          const pct = total > 0 ? Math.round((s.amount / total) * 100) : 0;
          return (
            <li key={s.key}>
              <button className="an-split" aria-pressed={filter === prefix + s.key} onClick={() => pickFilter(prefix + s.key)}>
                <span className="an-split-top">
                  <span className={s.key ? '' : 'an-muted'}>{s.label}</span>
                  <b>{money(s.amount)}</b>
                </span>
                <span className="an-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(pct, s.amount > 0 ? 2 : 0)}%` }} />
                </span>
                <span className="an-split-sub">
                  {pct}% · {plural(s.orders, 'order')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Dishes({ data }: { data: Data }) {
  const [all, setAll] = useState(false);
  const shown = all ? data.dishes : data.dishes.slice(0, 8);
  const most = data.dishes[0]?.orders || 1;
  return (
    <section className="an-sec" data-testid="an-dishes">
      <h2 className="an-h2">Top dishes</h2>
      <ol className="an-dishes">
        {shown.map((d) => (
          <li key={d.name}>
            <span className="an-dish-name">{d.name}</span>
            <span className="an-bar" aria-hidden="true">
              <i style={{ width: `${(d.orders / most) * 100}%` }} />
            </span>
            <span className="an-split-sub">
              {plural(d.orders, 'order')}
              {d.trays > 0 && ` · ${qtyNumber(d.trays)} full ${d.trays === 1 ? 'tray' : 'trays'}`}
            </span>
          </li>
        ))}
      </ol>
      {data.dishes.length > 8 && (
        <button className="t-btn an-more" onClick={() => setAll(!all)}>
          {all ? 'Show top 8' : `Show all ${data.dishes.length}`}
        </button>
      )}
      <p className="mo-note an-small">Counted by orders. Trays: a half tray counts as half a full tray. Auto extras are left out.</p>
    </section>
  );
}

function Chart({ data }: { data: Data }) {
  const [mode, setMode] = useState<'sales' | 'orders'>(data.sales > 0 ? 'sales' : 'orders');
  const [picked, setPicked] = useState<number | null>(null);
  const vals = data.series.map((s) => (mode === 'sales' ? s.sales : s.orders));
  const max = Math.max(...vals, 0);
  const n = vals.length;
  const W = 100;
  const H = 120;
  const gap = n > 20 ? 0.6 : 1.6;
  const bw = (W - gap * (n - 1)) / n;
  const sel = picked !== null && picked < n ? data.series[picked] : null;
  const show = (v: number) => (mode === 'sales' ? money(v) : plural(v, 'order'));
  return (
    <section className="an-sec an-chart" data-testid="an-chart">
      <div className="an-chart-head">
        <h2 className="an-h2">{mode === 'sales' ? 'Sales' : 'Orders'} over time</h2>
        <div className="t-seg an-mini" role="group" aria-label="Chart shows">
          <button aria-pressed={mode === 'sales'} onClick={() => setMode('sales')}>$</button>
          <button aria-pressed={mode === 'orders'} onClick={() => setMode('orders')}>Orders</button>
        </div>
      </div>
      <p className="an-readout" aria-live="polite">
        {sel ? (
          <>
            <b>{show(mode === 'sales' ? sel.sales : sel.orders)}</b> · {sel.bucket.name}
            {mode === 'sales' && ` · ${plural(sel.orders, 'order')}`}
          </>
        ) : (
          <>Highest: <b>{show(max)}</b>. Tap a bar to see it.</>
        )}
      </p>
      <div className="an-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${mode === 'sales' ? 'Sales' : 'Orders'} by ${n > 31 ? 'period' : 'day'}`}>
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="an-axis" />
          {vals.map((v, i) => {
            const h = max > 0 ? (v / max) * (H - 4) : 0;
            const x = i * (bw + gap);
            return (
              <g key={i}>
                {v > 0 && <rect x={x} y={H - h} width={bw} height={h} rx={Math.min(1.2, bw / 3)} className={'an-col' + (picked === i ? ' on' : '')} />}
              </g>
            );
          })}
        </svg>
        {/* Tap targets as wide as each bar and as tall as the chart, easier to hit than the bars. */}
        <div className="an-hits" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {data.series.map((s, i) => (
            <button key={i} aria-label={`${s.bucket.name}: ${show(mode === 'sales' ? s.sales : s.orders)}`} onClick={() => setPicked(picked === i ? null : i)} />
          ))}
        </div>
      </div>
      <div className="an-labels" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }} aria-hidden="true">
        {data.series.map((s, i) => (
          <span key={i}>{s.bucket.label}</span>
        ))}
      </div>
    </section>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function splitName(data: Data, f: ListFilter): string {
  const list = f.startsWith('m:') ? data.byMethod : data.byStaff;
  return list.find((s) => s.key === f.slice(2))?.label ?? 'Filter';
}

function periodLabel(kind: Exclude<RangeKind, 'dates'>, r: Range, now: number): string {
  const cur = periodOf(kind, now);
  const prev = periodOf(kind, now, -1);
  const word = { week: 'week', month: 'month', year: 'year' }[kind];
  if (r.from === cur.from) return 'This ' + word;
  if (r.from === prev.from) return 'Last ' + word;
  const d = new Date(r.from);
  if (kind === 'week') return 'Week of ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
  if (kind === 'month') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return String(d.getFullYear());
}

/** "Mon, Nov 16 – Sun, Nov 22, 2026" */
function rangeLabel(r: Range): string {
  const last = dayStart(r.to, -1);
  const f = (ms: number, year: boolean) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
  if (last === r.from) return f(r.from, true);
  const sameYear = new Date(r.from).getFullYear() === new Date(last).getFullYear();
  return `${f(r.from, !sameYear)} – ${f(last, true)}`;
}

/** "Wed, Nov 18" */
const dayShort = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
