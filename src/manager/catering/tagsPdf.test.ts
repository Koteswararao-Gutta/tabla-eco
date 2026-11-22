import { describe, expect, it } from 'vitest';
import { jpegSize, pdfOf } from './tagsPdf';

// A JPEG header with just a start-of-frame: 1700 wide, 2200 high.
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x08, 0x98, 0x06, 0xa4, 0x03, 0, 0, 0, 0xff, 0xd9]);

describe('name tags PDF', () => {
  it('reads a JPEG size', () => {
    expect(jpegSize(jpeg)).toEqual({ w: 1700, h: 2200 });
  });

  it('makes one letter page per sheet with a working cross-reference table', () => {
    const pdf = pdfOf([jpeg, jpeg]);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2 ');
    expect(text.match(/\/MediaBox \[0 0 612 792\]/g)).toHaveLength(2);
    expect(text).toContain('/Width 1700 /Height 2200');
    // Every xref entry points at its object.
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1]);
    const entries = text.slice(xrefAt).split('\n').slice(3, 3 + 8);
    entries.forEach((e, i) => expect(text.slice(Number(e.slice(0, 10)))).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });
});
