// Name tags as a PDF, for phones. A phone can't print a web page the way a computer does (an app added to the
// home screen has no print at all), so on a phone the tag sheets are drawn into a PDF that the phone's own
// Share (Print, WhatsApp, Files) or a download can take. The drawing copies the printed sheets as the browser
// lays them out: every box, line and letter is read from the hidden .nt-print sheets, so the PDF matches
// the printout. No libraries: a canvas per sheet, saved as JPEG pages of a small PDF.

/** Dots per inch of the drawn sheets: sharp on paper, a few hundred KB a sheet. */
const DPI = 200;
const PX_PER_IN = 96;
/** US letter, in PDF points. */
const PAGE_W_PT = 612;
const PAGE_H_PT = 792;

/** Phones and tablets without the Tabla app: printing goes through a PDF. */
export function printsAsPdf(): boolean {
  if (typeof window === 'undefined' || window.TablaPrint?.print) return false;
  const mq = (q: string) => !!window.matchMedia?.(q).matches;
  const standalone = mq('(display-mode: standalone)') || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || mq('(pointer: coarse)') || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Draws every .nt-page inside `root` and returns them as one PDF file. */
export async function tagsPdf(root: HTMLElement, fileName: string): Promise<File> {
  // The sheets are hidden on screen; lay them out off to the side while they are read.
  root.classList.add('nt-measure');
  try {
    const pages = [...root.querySelectorAll<HTMLElement>('.nt-page')];
    const jpegs: Uint8Array[] = [];
    for (const page of pages) jpegs.push(await canvasJpeg(await drawPage(page)));
    return new File([pdfOf(jpegs) as BlobPart], fileName, { type: 'application/pdf' });
  } finally {
    root.classList.remove('nt-measure');
  }
}

async function drawPage(page: HTMLElement): Promise<HTMLCanvasElement> {
  const scale = DPI / PX_PER_IN;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(8.5 * DPI);
  canvas.height = Math.round(11 * DPI);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const origin = page.getBoundingClientRect();
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  };
  ctx.scale(scale, scale); // from here on, CSS pixels

  // Cut marks
  for (const m of page.querySelectorAll('.nt-marks i')) {
    const b = box(m);
    ctx.fillStyle = getComputedStyle(m).backgroundColor;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  for (const cell of page.querySelectorAll<HTMLElement>('.nt-cell')) {
    const c = box(cell);
    ctx.fillStyle = getComputedStyle(cell).backgroundColor;
    ctx.fillRect(c.x, c.y, c.w, c.h);

    const tag = cell.querySelector<HTMLElement>('.nt-tag');
    if (!tag) continue;
    const t = box(tag);
    const ts = getComputedStyle(tag);
    const bw = parseFloat(ts.borderTopWidth) || 0;
    const radius = parseFloat(ts.borderTopLeftRadius) || 0;
    roundRect(ctx, t.x, t.y, t.w, t.h, radius);
    ctx.fillStyle = ts.backgroundColor;
    ctx.fill();
    roundRect(ctx, t.x + bw / 2, t.y + bw / 2, t.w - bw, t.h - bw, Math.max(0, radius - bw / 2));
    ctx.strokeStyle = ts.borderTopColor;
    ctx.lineWidth = bw;
    ctx.stroke();

    // The thin gold line inside the border (the tag's ::before)
    const inner = getComputedStyle(tag, '::before');
    const iw = parseFloat(inner.borderTopWidth) || 0;
    if (iw) {
      const inset = bw + (parseFloat(inner.top) || 0);
      const ir = parseFloat(inner.borderTopLeftRadius) || 0;
      roundRect(ctx, t.x + inset + iw / 2, t.y + inset + iw / 2, t.w - 2 * inset - iw, t.h - 2 * inset - iw, ir);
      ctx.strokeStyle = inner.borderTopColor;
      ctx.lineWidth = iw;
      ctx.stroke();
    }

    for (const svg of tag.querySelectorAll<SVGSVGElement>('svg')) await drawSvg(ctx, svg, box(svg));

    const logo = tag.querySelector<HTMLImageElement>('.nt-logo');
    if (logo?.complete && logo.naturalWidth) {
      const l = box(logo);
      ctx.drawImage(logo, l.x, l.y, l.w, l.h);
    }

    const mark = tag.querySelector<HTMLElement>('.nt-mark');
    if (mark) drawDietMark(ctx, mark, box);
  }

  drawText(ctx, page, origin);
  return canvas;
}

/** Every letter on the sheet, drawn where the browser put it (keeps centring, wrapping and letter spacing). */
function drawText(ctx: CanvasRenderingContext2D, page: HTMLElement, origin: DOMRect) {
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const el = node.parentElement;
    if (!el || !node.data.trim()) continue;
    const s = getComputedStyle(el);
    ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    ctx.fillStyle = s.color;
    ctx.textBaseline = 'alphabetic';
    const upper = s.textTransform === 'uppercase';
    const metrics = ctx.measureText('Hg');
    const ascent = metrics.fontBoundingBoxAscent ?? parseFloat(s.fontSize) * 0.9;
    const fontH = ascent + (metrics.fontBoundingBoxDescent ?? parseFloat(s.fontSize) * 0.25);
    // A name longer than two lines is cut off on paper; leave out what the paper doesn't show.
    const clip = el.closest('.nt-name')?.getBoundingClientRect();
    for (let i = 0; i < node.data.length; i++) {
      const ch = node.data[i];
      if (!ch.trim()) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getClientRects()[0];
      if (!r || !r.width) continue;
      if (clip && r.top + r.height / 2 > clip.bottom) continue;
      // The letter's box is the font's full height, centred; its baseline sits the ascent below the top.
      const top = r.top + (r.height - fontH) / 2;
      ctx.fillText(upper ? ch.toUpperCase() : ch, r.left - origin.left, top - origin.top + ascent);
    }
  }
  range.detach?.();
}

/** The veg (green dot) or non-veg (red triangle) mark in its small square. */
function drawDietMark(ctx: CanvasRenderingContext2D, mark: HTMLElement, box: (el: Element) => { x: number; y: number; w: number; h: number }) {
  const m = box(mark);
  const ms = getComputedStyle(mark);
  const bw = parseFloat(ms.borderTopWidth) || 1;
  roundRect(ctx, m.x + bw / 2, m.y + bw / 2, m.w - bw, m.h - bw, parseFloat(ms.borderTopLeftRadius) || 0);
  ctx.fillStyle = ms.backgroundColor;
  ctx.fill();
  ctx.strokeStyle = ms.borderTopColor;
  ctx.lineWidth = bw;
  ctx.stroke();
  const dot = mark.querySelector('i');
  if (!dot) return;
  const d = box(dot);
  const ds = getComputedStyle(dot);
  ctx.beginPath();
  if (mark.closest('.nonveg')) {
    ctx.fillStyle = ds.borderBottomColor;
    ctx.moveTo(d.x + d.w / 2, d.y);
    ctx.lineTo(d.x + d.w, d.y + d.h);
    ctx.lineTo(d.x, d.y + d.h);
    ctx.closePath();
  } else {
    ctx.fillStyle = ds.backgroundColor;
    ctx.ellipse(d.x + d.w / 2, d.y + d.h / 2, d.w / 2, d.h / 2, 0, 0, Math.PI * 2);
  }
  ctx.fill();
}

/** An inline SVG (gold corners, divider), drawn as an image with its colours and flip. */
async function drawSvg(ctx: CanvasRenderingContext2D, svg: SVGSVGElement, b: { x: number; y: number; w: number; h: number }) {
  const s = getComputedStyle(svg);
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(b.w));
  copy.setAttribute('height', String(b.h));
  copy.removeAttribute('class');
  copy.removeAttribute('style');
  copy.setAttribute('fill', s.fill);
  copy.setAttribute('stroke', s.stroke);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
  const img = new Image();
  img.src = url;
  try {
    await (img.decode?.() ?? new Promise((r, e) => ((img.onload = () => r(undefined)), (img.onerror = e))));
  } catch {
    return;
  }
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
  const m = s.transform && s.transform !== 'none' ? new DOMMatrix(s.transform) : null;
  if (m) ctx.transform(m.a, m.b, m.c, m.d, 0, 0);
  ctx.drawImage(img, -b.w / 2, -b.h / 2, b.w, b.h);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

async function canvasJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  const data = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

/** A PDF with one JPEG filling each US letter page. */
export function pdfOf(jpegs: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const enc = new TextEncoder();
  const put = (p: string | Uint8Array) => {
    const b = typeof p === 'string' ? enc.encode(p) : p;
    parts.push(b);
    length += b.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = length;
    put(`${n} 0 obj\n`);
    body();
    put('\nendobj\n');
  };
  put('%PDF-1.4\n%\xC2\xB5\xC2\xB6\n');
  const n = jpegs.length;
  // 1 catalog, 2 pages, then per page: page, image, content
  const pageId = (i: number) => 3 + i * 3;
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => put(`<< /Type /Pages /Count ${n} /Kids [${jpegs.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`));
  jpegs.forEach((jpg, i) => {
    const { w, h } = jpegSize(jpg);
    const p = pageId(i);
    const draw = `q ${PAGE_W_PT} 0 0 ${PAGE_H_PT} 0 0 cm /Im0 Do Q`;
    obj(p, () =>
      put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W_PT} ${PAGE_H_PT}] /Resources << /XObject << /Im0 ${p + 1} 0 R >> >> /Contents ${p + 2} 0 R >>`),
    );
    obj(p + 1, () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
      put(jpg);
      put('\nendstream');
    });
    obj(p + 2, () => put(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
  });
  const count = 3 + n * 3;
  const xref = length;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) put(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Width and height of a JPEG, from its start-of-frame marker. */
export function jpegSize(b: Uint8Array): { w: number; h: number } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + len;
  }
  return { w: 1, h: 1 };
}
