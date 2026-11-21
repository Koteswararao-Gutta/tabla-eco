// More > Export: catering orders in a date range as a CSV file (opens in Excel or Google Sheets). Manager app only.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { store, useCollection } from '@shared/data';
import { Field, PageHeader, Segmented } from '@shared/ui';
import { toDateInput } from '../catering/orders';
import { useAmountsOf } from '../catering/data';
import { csvFileName, csvRows, lastDay, RANGE_KINDS, rangeFor, toCsv, type RangeKind } from './export';

// A range that can't be asked for yet (custom dates not filled in): loads nothing.
const NOTHING = { ids: [] as string[] };

export default function Export() {
  const [now] = useState(() => store.now());
  const [kind, setKind] = useState<RangeKind>('thisMonth');
  const [custom, setCustom] = useState(() => {
    const month = rangeFor('thisMonth', now)!;
    return { from: toDateInput(month.from), to: toDateInput(now) };
  });
  const range = rangeFor(kind, now, custom);
  const orders = useCollection('orders', range ? { dueFrom: range.from, dueTo: range.to } : NOTHING);
  const amounts = useAmountsOf(range ? orders : null).current;
  const rows = useMemo(() => (range && orders && amounts ? csvRows(orders, amounts, range) : null), [range?.from, range?.to, orders, amounts]);
  const count = rows ? rows.length - 1 : 0;
  const file = useMemo(() => (rows && range ? new File([toCsv(rows)], csvFileName(range), { type: 'text/csv' }) : null), [rows]);
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  // A link the browser downloads; let go of it when the file changes or the page closes.
  const href = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (href && URL.revokeObjectURL(href)), [href]);
  const [shareError, setShareError] = useState('');

  const share = async () => {
    if (!file) return;
    setShareError('');
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setShareError('Could not share the file. Use Download instead.');
    }
  };

  const fmt = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <main className="t-page mo-export">
      <Link className="mo-back" to="/manager/more">‹ More</Link>
      <PageHeader title="Export" sub="Catering orders as a spreadsheet file (CSV)." />
      <div className="t-stack">
        <Segmented label="Dates" value={kind} options={RANGE_KINDS} onChange={setKind} />
        {kind === 'custom' && (
          <div className="mo-export-dates">
            <Field label="From">
              <input className="t-input" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} data-testid="export-from" />
            </Field>
            <Field label="To">
              <input className="t-input" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} data-testid="export-to" />
            </Field>
          </div>
        )}

        {!range ? (
          <p className="mo-note" role="alert">Please pick a start date and an end date on or after it.</p>
        ) : (
          <div className="mo-total" data-testid="export-summary">
            <span>{fmt(range.from)} – {fmt(lastDay(range))}</span>
            <b>{rows ? count : '…'}</b>
            <small>{!rows ? 'Loading…' : count === 1 ? 'order' : 'orders'}</small>
          </div>
        )}

        {file && href && (
          <>
            <a className="t-btn primary block" href={href} download={file.name} data-testid="export-download">
              Download CSV
            </a>
            {canShare && (
              <button className="t-btn block" onClick={share} data-testid="export-share">
                Share file…
              </button>
            )}
            {shareError && <p className="mo-note" role="alert">{shareError}</p>}
            <p className="mo-note mo-export-help">
              One row per order: date, time, customer, phone, pickup or delivery, people, items, status, amount, deposits, paid, payment method, taken by and refund note. Deleted orders are left out.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
