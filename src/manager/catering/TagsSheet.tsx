// "Print tags" for one catering order: a name tag per dish, printed on plain letter paper
// (10 per sheet, cut along the marks). Used by the manager Catering tab and the kitchen tablet.
import { forwardRef, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LOGO_URL as logo, Segmented, Sheet } from '@shared/ui';
import { useDoc, useSingleton, type CateringOrder } from '@shared/data';
import { DIET_LABEL, nameSize, sheets, tagsForOrder, TAG_SITE, tooLong, type Diet, type NameTag } from './tags';
import { printsAsPdf, tagsPdf } from './tagsPdf';
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

export function TagsSheet({ order, onClose }: { order: Order; now?: number; onClose: () => void }) {
  const menu = useDoc('toastMenu', 'current');
  const settings = useSingleton('settings');
  const brand = settings?.restaurantName?.trim() || 'Tabla';
  const [tags, setTags] = useState<NameTag[] | null>(null);
  const [waited, setWaited] = useState(false);
  const [printing, setPrinting] = useState(false);
  // Phones print through a PDF: made on the first tap, then handed to the phone's Share or saved.
  const [asPdf] = useState(printsAsPdf);
  const [pdf, setPdf] = useState<{ file: File; url: string } | null>(null);
  const [pdfError, setPdfError] = useState(false);
  const pagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => void (pdf && URL.revokeObjectURL(pdf.url)), [pdf]);

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), MENU_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (tags === null && (menu !== undefined || waited)) setTags(tagsForOrder(order, menu ?? null));
  }, [menu, waited, tags, order]);

  // While this sheet is open, printing shows only the tag sheets.
  useEffect(() => {
    loadTagAssets();
    document.body.classList.add('nt-printing');
    return () => document.body.classList.remove('nt-printing');
  }, []);

  const list = tags ?? [];
  const ready = list.filter((t) => t.name.trim());
  const pages = sheets(ready);

  // Any change to the tags makes a new PDF next time.
  const edit = (next: NameTag[]) => {
    setTags(next);
    setPdf(null);
  };
  const change = (i: number, patch: Partial<NameTag>) => edit(list.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const remove = (i: number) => edit(list.filter((_, j) => j !== i));
  const add = () => edit([...list, { name: '', sub: '', diet: 'veg' }]);
  const job = `Tags ${order.customerName} ${shortDate(order.dueAt)}`;

  const makePdf = async () => {
    setPrinting(true);
    setPdfError(false);
    try {
      await readyToPrint();
      if (!pagesRef.current) return;
      const file = await tagsPdf(pagesRef.current, `${job.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.pdf`);
      setPdf({ file, url: URL.createObjectURL(file) });
      await sharePdf(file); // straight to the phone's Share sheet when the phone allows it
    } catch {
      setPdfError(true);
    } finally {
      setPrinting(false);
    }
  };

  const print = async () => {
    setPrinting(true);
    try {
      await readyToPrint();
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
              {tooLong(t.name) && <span className="nt-row-warn">Too long for the tag</span>}
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
      {asPdf && pdf ? (
        <>
          <p className="nt-pdf-note" role="status">
            The PDF is ready. Share it to print (choose Print or your printer's app), or save it and print from Files.
          </p>
          {canShare(pdf.file) && (
            <button type="button" className="t-btn primary block" onClick={() => void sharePdf(pdf.file)}>
              Share PDF to print
            </button>
          )}
          <a className={'t-btn block' + (canShare(pdf.file) ? '' : ' primary')} href={pdf.url} download={pdf.file.name}>
            Save PDF
          </a>
        </>
      ) : (
        <button type="button" className="t-btn primary block" disabled={!ready.length || printing} onClick={asPdf ? makePdf : print}>
          {printing && asPdf
            ? 'Making the PDF…'
            : ready.length
              ? `Print ${ready.length} ${ready.length === 1 ? 'tag' : 'tags'} (${pages.length} ${pages.length === 1 ? 'sheet' : 'sheets'})`
              : 'Print tags'}
        </button>
      )}
      {pdfError && <p className="nt-row-warn" role="alert">Couldn't make the PDF. Try again, or print from a computer.</p>}
      <button type="button" className="t-btn ghost block" onClick={onClose}>
        Close
      </button>
      {createPortal(<TagPages ref={pagesRef} pages={pages} brand={brand} />, document.body)}
    </Sheet>
  );
}

/** "Sat Nov 14" */
function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

/** The tag fonts and logo, loaded once per app run. The print sheets are hidden on screen, so nothing would
 *  load them until printing: start as soon as the tags sheet opens, so Print has nothing left to wait for.
 *  (Safari never finishes decoding an image that isn't shown, so the logo is loaded on its own here.) */
let assets: Promise<unknown> | null = null;
function loadTagAssets(): Promise<unknown> {
  if (!assets) {
    const fonts = document.fonts;
    const logoImg = new Image();
    logoImg.src = logo;
    assets = Promise.all([
      fonts?.load('700 20px "Tabla Playfair"'),
      fonts?.load('700 10px "Tabla Montserrat"'),
      fonts?.load('600 10px "Tabla Montserrat"'),
      logoImg.decode?.() ?? new Promise((r) => (logoImg.onload = logoImg.onerror = r)),
    ]).catch(() => {});
  }
  return assets;
}

/** Waits for the fonts and logo, but never long (offline with nothing cached): prints with what there is. */
async function readyToPrint(): Promise<void> {
  await Promise.race([loadTagAssets(), new Promise((r) => setTimeout(r, 800))]);
}

/** The phone's Share sheet with the PDF (Print, WhatsApp, Files). Quietly does nothing when the phone has none,
 *  when the person closes it, or when the phone wants a fresh tap first: the Share and Save buttons stay. */
async function sharePdf(file: File): Promise<void> {
  if (!canShare(file)) return;
  try {
    await navigator.share({ files: [file], title: file.name });
  } catch {
    /* closed, or needs a tap on Share */
  }
}

function canShare(file: File): boolean {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/** The printed sheets: hidden on screen, the only thing shown when printing. Only the tags print: no
 *  times, dates or sheet numbers on the page. */
export const TagPages = forwardRef<HTMLDivElement, { pages: NameTag[][]; brand: string }>(function TagPages({ pages, brand }, ref) {
  return (
    <div className="nt-print" aria-hidden="true" ref={ref}>
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
        </section>
      ))}
    </div>
  );
});

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
