// Checks and a still picture for an ad video picked on the phone, before anything is uploaded.
// videoFormat and the problem lists are pure (adVideo.test.ts); readVideo needs a browser.

export type VideoFormat = 'ok' | 'hevc' | 'not-mp4' | 'no-h264';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const FTYP = ascii('ftyp');
const AVC1 = ascii('avc1');
const HVC1 = ascii('hvc1');
const HEV1 = ascii('hev1');

function has(bytes: Uint8Array, tag: number[], from = 0): boolean {
  const [a, b, c, d] = tag;
  for (let i = from; i + 3 < bytes.length; i++) {
    if (bytes[i] === a && bytes[i + 1] === b && bytes[i + 2] === c && bytes[i + 3] === d) return true;
  }
  return false;
}

/** From the file's bytes: 'ok' (MP4 with H.264, which every TV plays), 'hevc' (the iPhone's newer format, which the
 *  TVs may not play), 'not-mp4', or 'no-h264'. Looks at the whole file: the part that names the format can be at
 *  the end. */
export function videoFormat(bytes: Uint8Array): VideoFormat {
  if (bytes.length < 12 || !FTYP.every((c, i) => bytes[4 + i] === c)) return 'not-mp4';
  if (has(bytes, HVC1) || has(bytes, HEV1)) return 'hevc';
  return has(bytes, AVC1) ? 'ok' : 'no-h264';
}

export interface VideoInfo {
  size: number;
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  format: VideoFormat;
}

export const MIN_AD_SECONDS = 3;
export const MAX_AD_SECONDS = 60;
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const BIG_VIDEO_BYTES = 15 * 1024 * 1024;

/** Plain problems that stop the ad from being saved (empty = fine). */
export function videoProblems(v: VideoInfo): string[] {
  const out: string[] = [];
  if (v.format === 'not-mp4') out.push('Choose the MP4 file (from Files).');
  else if (v.format !== 'ok') out.push("This video is in a format the TVs can't play. Download it from Higgsfield again as MP4 and pick it from Files.");
  if (v.size > MAX_VIDEO_BYTES) out.push('This file is too big (over 30 MB).');
  if (v.format !== 'not-mp4') {
    if (v.width > 0 && v.height > 0 && v.width <= v.height) out.push('This video is tall. The TVs need a wide (landscape) video.');
    if (!(v.duration >= MIN_AD_SECONDS && v.duration <= MAX_AD_SECONDS)) out.push(`Ads must be ${MIN_AD_SECONDS} to ${MAX_AD_SECONDS} seconds long.`);
  }
  return out;
}

/** Plain warnings that don't stop saving. */
export function videoWarnings(v: VideoInfo): string[] {
  return v.size > BIG_VIDEO_BYTES && v.size <= MAX_VIDEO_BYTES ? ['Big file: the TVs take longer to load it.'] : [];
}

/** Problems with the two videos of one ad together. */
export function pairProblems(left: Pick<VideoInfo, 'duration'>, right: Pick<VideoInfo, 'duration'>): string[] {
  return Math.abs(left.duration - right.duration) > 0.5 ? ['The two videos must be the same length.'] : [];
}

/** "15 s · 11 MB" */
export function videoSummary(v: Pick<VideoInfo, 'duration' | 'size'>): string {
  const mb = v.size / (1024 * 1024);
  return `${Math.round(v.duration)} s · ${mb < 1 ? '<1' : Math.round(mb)} MB`;
}

const STILL_W = 1920;
const STILL_H = 1080;

/** Reads length and size from a hidden muted video, then draws its LAST frame into a 1920x1080 picture (whole, on
 *  black), shown on the TVs while the video loads or if it can't play. Gives up after 15 s. */
export function readVideo(file: Blob): Promise<{ width: number; height: number; duration: number; still: Blob }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      fn();
    };
    const fail = () => finish(() => reject(new Error("This video can't be opened on this phone.")));
    const timer = setTimeout(fail, 15_000);
    v.onerror = fail;
    v.onloadedmetadata = async () => {
      const duration = v.duration;
      if (!Number.isFinite(duration) || !v.videoWidth) return fail();
      // iPhone only draws frames of a video that has played once.
      if (v.readyState < 2) {
        try {
          await v.play();
          v.pause();
        } catch {
          /* a still from the first frame is fine too */
        }
      }
      v.onseeked = () => {
        try {
          const c = document.createElement('canvas');
          c.width = STILL_W;
          c.height = STILL_H;
          const g = c.getContext('2d')!;
          g.fillStyle = '#000';
          g.fillRect(0, 0, STILL_W, STILL_H);
          const k = Math.min(STILL_W / v.videoWidth, STILL_H / v.videoHeight);
          const w = v.videoWidth * k;
          const h = v.videoHeight * k;
          g.drawImage(v, (STILL_W - w) / 2, (STILL_H - h) / 2, w, h);
          c.toBlob((b) => (b ? finish(() => resolve({ width: v.videoWidth, height: v.videoHeight, duration, still: b })) : fail()), 'image/jpeg', 0.85);
        } catch {
          fail();
        }
      };
      v.currentTime = Math.max(0, duration - 0.1);
    };
    v.src = url;
  });
}
