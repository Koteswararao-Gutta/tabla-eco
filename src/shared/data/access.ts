// Approved devices: small helpers shared by both stores and the screens.
import { isFrontPage } from './sw';
import type { DeviceApp, DeviceRecord } from './types';

/** Which app this page is (saved with the device in More > Devices). */
export function currentApp(hash = typeof location === 'undefined' ? '' : location.hash, frontPage = typeof location !== 'undefined' && isFrontPage()): DeviceApp {
  const a = /^#\/(tv\/[1-5]|kitchen|front|manager)/.exec(hash)?.[1];
  if (!a) return frontPage ? 'front' : 'home';
  return (a.startsWith('tv/') ? 'tv' + a.slice(3) : a) as DeviceApp;
}

const APP_LABELS: Record<DeviceApp, string> = {
  tv1: 'TV 1',
  tv2: 'TV 2',
  tv3: 'TV 3',
  tv4: 'TV 4',
  tv5: 'TV 5 (music)',
  kitchen: 'Kitchen tablet',
  front: 'Front app',
  manager: 'Manager app',
  home: 'Home page',
  other: 'Device',
};

/** The name shown for a device: the one typed in, else what it opens ("Kitchen tablet", "TV 1"). */
export function deviceLabel(d: Pick<DeviceRecord, 'name' | 'app'>): string {
  return d.name || APP_LABELS[d.app] || 'Device';
}

/** The app's own name for what a device opens, e.g. "Front app". */
export const appLabel = (app: DeviceApp): string => APP_LABELS[app] ?? 'Device';
