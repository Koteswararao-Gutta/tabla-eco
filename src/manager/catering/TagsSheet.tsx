// "Print tags" for one catering order: a name tag per dish, printed on plain letter paper
// (10 per sheet, cut along the marks). Used by the manager Catering tab and the kitchen tablet.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LOGO_URL as logo, Segmented, Sheet } from '@shared/ui';
import { useDoc, useSingleton, type CateringOrder } from '@shared/data';
import { dayLabel, timeLabel } from './orders';
import { DIET_LABEL, nameSize, sheets, tagsForOrder, TAG_SITE, type Diet, type NameTag } from './tags';
import './tags.css';

declare global {
  interface Window {
    /** The Tabla Android app's print bridge (a web view has no window.print). */
    TablaPrint?: { print: (jobName: string) => void };
  }
}

/** How long to wait for the Toast menu before making tags without it (it only helps with veg/non-veg). */
const MENU_WAIT_MS = 1500;

type Order = Pick<CateringOrder, 'customerName' | 'dueAt' | 'type' | 'items'>;

export function TagsSheet({ order, now, onClose }: { order: Order; now: number; onClose: () => void }) {
  const menu = useDoc('toastMenu', 'current');
  const settings = useSingleton('settings');
  const brand = settings?.restaurantName?.trim() || 'Tabla';
  const [tags, setTags] = useState<NameTag[] | null>(null);
  const [waited, setWaited] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), MENU_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (tags === null && (menu !== undefined || waited)) setTags(tagsForOrder(order, menu ?? null));
  }, [menu, waited, tags, order]);

  // While this sheet is open, printing shows only the tag sheets.
  useEffect(() => {
    document.body.classList.add('nt-printing');
    return () => document.body.classList.remove('nt-printing');
  }, []);

  const list = tags ?? [];
  const ready = list.filter((t) => t.name.trim());
  const pages = sheets(ready);
  const when = `${dayLabel(order.dueAt, now) === 'Today' ? 'Today' : shortDate(order.dueAt)} · ${timeLabel(order.dueAt)} ${order.type}`;
  const pageNote = `Catering · ${order.customerName} · ${when}`;

  const change = (i: number, patch: Partial<NameTag>) => setTags(list.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const remove = (i: number) => setTags(list.filter((_, j) => j !== i));
  const add = () => setTags([...list, { name: '', sub: '', diet: 'veg' }]);

  const print = async () => {
    setPrinting(true);
    try {
      await readyToPrint();
      const job = `Tags ${order.customerName} ${shortDate(order.dueAt)}`;
      if (window.TablaPrint?.print) window.TablaPrint.print(job);
      else {
        const title = document.title;
        document.title = job; // the file name when saving as PDF
        window.print();
        document.title = title;
      }
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Sheet open title="Name tags" onClose={onClose}>
      <p className="nt-intro">
        One tag per dish for <b>{order.customerName}</b>. Check the names and veg or non-veg, then print on plain letter paper and cut along the marks.
      </p>
      {tags === null ? (
        <p className="nt-intro">Getting the dishes…</p>
      ) : (
        <ul className="nt-rows" aria-label="Tags">
          {list.map((t, i) => (
            <li key={i} className="nt-row" data-testid="tag-row">
              <div className="nt-row-top">
                <input
                  className="t-input nt-row-name"
                  aria-label={`Dish ${i + 1}`}
                  value={t.name}
                  placeholder="Dish name"
                  maxLength={60}
                  onChange={(e) => change(i, { name: e.target.value })}
                />
                <button type="button" className="t-btn ghost nt-row-del" aria-label={`Remove ${t.name || 'this tag'}`} onClick={() => remove(i)}>
                  ✕
                </button>
              </div>
              {t.sub && <span className="nt-row-sub">{t.sub}</span>}
              <Segmented<Diet>
                label={`Veg or non-veg: ${t.name}`}
                value={t.diet ?? 'veg'}
                options={[
                  { value: 'veg', label: 'Veg' },
                  { value: 'nonveg', label: 'Non-veg' },
                ]}
                onChange={(diet) => change(i, { diet })}
              />
            </li>
          ))}
          {list.length === 0 && <li className="t-empty">This order has no dishes yet.</li>}
        </ul>
      )}
      <button type="button" className="t-btn block" onClick={add}>
        + Add a tag
      </button>
      <button type="button" className="t-btn primary block" disabled={!ready.length || printing} onClick={print}>
        {ready.length ? `Print ${ready.length} ${ready.length === 1 ? 'tag' : 'tags'} (${pages.length} ${pages.length === 1 ? 'sheet' : 'sheets'})` : 'Print tags'}
      </button>
      <button type="button" className="t-btn ghost block" onClick={onClose}>
        Close
      </button>
      {createPortal(<TagPages pages={pages} note={pageNote} brand={brand} />, document.body)}
    </Sheet>
  );
}

/** "Sat Nov 14" */
function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

/** Fonts and the logo only load once used, and the print sheets are hidden on screen: load them first. */
async function readyToPrint(): Promise<void> {
  const fonts = document.fonts;
  const wait = Promise.all([
    fonts?.load('700 20px "Tabla Playfair"'),
    fonts?.load('700 10px "Tabla Montserrat"'),
    fonts?.load('600 10px "Tabla Montserrat"'),
    ...Array.from(document.querySelectorAll<HTMLImageElement>('.nt-print img')).map((img) => img.decode?.().catch(() => {})),
  ]).catch(() => {});
  // Never hold the print up for long (offline with nothing cached): print with what there is.
  await Promise.race([wait, new Promise((r) => setTimeout(r, 3000))]);
}

/** The printed sheets: hidden on screen, the only thing shown when printing. */
export function TagPages({ pages, note, brand }: { pages: NameTag[][]; note: string; brand: string }) {
  return (
    <div className="nt-print" aria-hidden="true">
      {pages.map((tags, p) => (
        <section className="nt-page" key={p}>
          <CropMarks />
          <div className="nt-grid">
            {tags.map((t, i) => (
              <div className="nt-cell" key={i}>
                <Tag tag={t} brand={brand} />
              </div>
            ))}
          </div>
          <footer className="nt-page-foot">
            <span>{note}</span>
            <span>
              Sheet {p + 1} of {pages.length}
            </span>
          </footer>
        </section>
      ))}
    </div>
  );
}

export function Tag({ tag, brand }: { tag: NameTag; brand: string }) {
  const diet = tag.diet;
  return (
    <div className="nt-tag" data-testid="name-tag">
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <Corner key={c} at={c} />
      ))}
      <img className="nt-logo" src={logo} alt="" />
      <div className="nt-mid">
        <div className={'nt-name ' + nameSize(tag.name)}>{tag.name}</div>
        <Divider />
        {tag.sub && <div className="nt-sub">{tag.sub}</div>}
      </div>
      {diet && (
        <div className={'nt-diet ' + diet}>
          <span className="nt-mark" aria-hidden="true">
            <i />
          </span>
          {DIET_LABEL[diet]}
        </div>
      )}
      <div className="nt-foot">
        Catered by <b>{brand}</b> · {TAG_SITE}
      </div>
    </div>
  );
}

function Corner({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  return (
    <svg className={'nt-corner ' + at} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M2 40V10a8 8 0 0 1 8-8h30" fill="none" strokeWidth="1.8" />
      <path d="M6.5 40V13.5a7 7 0 0 1 7-7H40" fill="none" strokeWidth="0.9" />
      <circle cx="15" cy="15" r="2.6" />
      <path d="M20.5 15c2.6-2.8 6.4-2.8 9 0-2.6 2.8-6.4 2.8-9 0z" />
      <path d="M15 20.5c2.8 2.6 2.8 6.4 0 9-2.8-2.6-2.8-6.4 0-9z" />
    </svg>
  );
}

function Divider() {
  return (
    <svg className="nt-divider" viewBox="0 0 120 10" aria-hidden="true">
      <path d="M0 5h47M73 5h47" strokeWidth="0.8" />
      <circle cx="51.5" cy="5" r="1.3" />
      <circle cx="68.5" cy="5" r="1.3" />
      <path d="M60 1l4 4-4 4-4-4z" />
    </svg>
  );
}

function CropMarks() {
  const xs = [0.75, 4.25, 7.75];
  const ys = [0.5, 2.5, 4.5, 6.5, 8.5, 10.5];
  return (
    <div className="nt-marks" aria-hidden="true">
      {xs.map((x) => (
        <i key={'t' + x} className="v" style={{ left: `${x}in`, top: '0.12in' }} />
      ))}
      {xs.map((x) => (
        <i key={'b' + x} className="v" style={{ left: `${x}in`, top: '10.58in' }} />
      ))}
      {ys.map((y) => (
        <i key={'l' + y} className="h" style={{ top: `${y}in`, left: '0.4in' }} />
      ))}
      {ys.map((y) => (
        <i key={'r' + y} className="h" style={{ top: `${y}in`, left: '7.82in' }} />
      ))}
    </div>
  );
}
