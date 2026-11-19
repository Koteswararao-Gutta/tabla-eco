// Kitchen in a plain browser (Chrome on the tablet): go full screen on the first tap, and again on the
// next tap after anything takes it out of full screen. Browsers only allow this from a tap.
// Inside the Tabla Android app the app itself hides the bars, so this does nothing there.
import { useEffect } from 'react';

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

/** True inside the Tabla Android app (it adds "TablaScreen" to the user agent). */
export const inTablaApp = (ua: string = navigator.userAgent): boolean => ua.includes('TablaScreen');

function isFullscreen(d: FsDoc): boolean {
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Asks the browser for full screen. Never throws: a refusal just leaves the page as it is. */
export function enterFullscreen(d: FsDoc = document): void {
  if (isFullscreen(d)) return;
  const el = d.documentElement as FsEl;
  try {
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    else el.webkitRequestFullscreen?.();
  } catch {
    // not allowed here (e.g. inside a frame): stay as is
  }
}

export function useBrowserFullscreen(): void {
  useEffect(() => {
    if (inTablaApp()) return;
    const d = document as FsDoc;
    if (!(d.fullscreenEnabled || d.webkitFullscreenEnabled)) return;
    const onTap = () => enterFullscreen(d);
    window.addEventListener('pointerup', onTap, true);
    return () => window.removeEventListener('pointerup', onTap, true);
  }, []);
}
