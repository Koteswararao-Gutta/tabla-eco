import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pairProblems, videoFormat, videoProblems, videoSummary, videoWarnings, type VideoInfo } from './adVideo';

const box = (type: string, payload: string | Uint8Array) => {
  const body = typeof payload === 'string' ? Uint8Array.from(payload, (c) => c.charCodeAt(0)) : payload;
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
};
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, at), (at += p.length);
  return out;
};
const ftyp = box('ftyp', 'isom\0\0\0\0isomavc1');

describe('videoFormat', () => {
  it('tells H.264 MP4 from HEVC and other files, looking only inside moov', () => {
    expect(videoFormat(join(ftyp, box('mdat', 'xxxx'), box('moov', '..trak..avc1..')))).toBe('ok');
    expect(videoFormat(join(ftyp, box('moov', '..hvc1..'), box('mdat', 'xxxx')))).toBe('hevc');
    expect(videoFormat(join(ftyp, box('moov', '..hev1..')))).toBe('hevc');
    expect(videoFormat(join(ftyp, box('moov', '..av01..')))).toBe('no-h264');
    // picture data that happens to hold "hvc1" doesn't make an H.264 file HEVC
    expect(videoFormat(join(ftyp, box('mdat', '..hvc1..hev1..'), box('moov', '..avc1..')))).toBe('ok');
    expect(videoFormat(join(ftyp, box('mdat', 'avc1')))).toBe('not-mp4'); // no moov
    expect(videoFormat(Uint8Array.from('\x1aE\xdf\xa3webm', (c) => c.charCodeAt(0)))).toBe('not-mp4');
    expect(videoFormat(new Uint8Array(3))).toBe('not-mp4');
  });

  it('reads the real ad files as H.264', () => {
    for (const f of ['catering-left-1.mp4', 'catering-right-1.mp4']) {
      expect(videoFormat(new Uint8Array(readFileSync(new URL('../../../public/ads/' + f, import.meta.url))))).toBe('ok');
    }
  });
});

describe('videoProblems', () => {
  const good: VideoInfo = { size: 11_000_000, width: 1920, height: 1080, duration: 15, format: 'ok' };
  it('accepts a wide 15 s MP4', () => {
    expect(videoProblems(good)).toEqual([]);
    expect(videoWarnings(good)).toEqual([]);
  });
  it('refuses tall, too short, too long, too big and the wrong format, in plain words', () => {
    expect(videoProblems({ ...good, width: 1080, height: 1920 })[0]).toMatch(/tall/);
    expect(videoProblems({ ...good, duration: 2 })[0]).toMatch(/3 to 60 seconds/);
    expect(videoProblems({ ...good, duration: 61 })[0]).toMatch(/3 to 60 seconds/);
    expect(videoProblems({ ...good, size: 40_000_000 })[0]).toMatch(/too big/);
    expect(videoProblems({ ...good, format: 'hevc' })[0]).toMatch(/format the TVs can't play/);
    expect(videoProblems({ ...good, format: 'not-mp4' })).toEqual(['Choose the MP4 file (from Files).']);
  });
  it('warns about a big file', () => {
    expect(videoWarnings({ ...good, size: 15 * 1024 * 1024 })[0]).toMatch(/Big file/);
  });
  it('the two halves must be the same length', () => {
    expect(pairProblems({ duration: 15 }, { duration: 15.3 })).toEqual([]);
    expect(pairProblems({ duration: 15 }, { duration: 16 })[0]).toMatch(/same length/);
  });
  it('summarises length and size', () => {
    expect(videoSummary({ duration: 15.04, size: 11.3 * 1024 * 1024 })).toBe('15 s · 11 MB');
    expect(videoSummary({ duration: 4, size: 500_000 })).toBe('4 s · <1 MB');
  });
});
