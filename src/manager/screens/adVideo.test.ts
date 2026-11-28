import { describe, expect, it } from 'vitest';
import { pairProblems, videoFormat, videoProblems, videoSummary, videoWarnings, type VideoInfo } from './adVideo';

const file = (...parts: string[]) => {
  const bytes = new Uint8Array(64);
  let at = 0;
  for (const p of parts) for (const c of p) bytes[at++] = c.charCodeAt(0);
  return bytes;
};

describe('videoFormat', () => {
  it('tells H.264 MP4 from HEVC and other files', () => {
    expect(videoFormat(file('\0\0\0 ftypisom....moov..avc1'))).toBe('ok');
    expect(videoFormat(file('\0\0\0 ftypqt  ....moov..hvc1'))).toBe('hevc');
    expect(videoFormat(file('\0\0\0 ftypisom....hev1'))).toBe('hevc');
    expect(videoFormat(file('\0\0\0 ftypisom....av01'))).toBe('no-h264');
    expect(videoFormat(file('\x1aE\xdf\xa3webm'))).toBe('not-mp4');
    expect(videoFormat(new Uint8Array(3))).toBe('not-mp4');
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
    expect(videoWarnings({ ...good, size: 20 * 1024 * 1024 })[0]).toMatch(/Big file/);
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
