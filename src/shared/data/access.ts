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

/** A device not seen for this long is hidden in More > Devices and no longer counts as a manager phone
 *  (the server uses the same rule: functions/devices.js). */
export const STALE_MS = 30 * 24 * 3600_000;

/** True when this device was seen in the last 30 days. */
export const isRecent = (d: Pick<DeviceRecord, 'lastSeen'>, now: number): boolean => typeof d.lastSeen === 'number' && now - d.lastSeen < STALE_MS;

/** Manager phones still in use. */
export const activeManagers = <T extends Pick<DeviceRecord, 'manager' | 'lastSeen'>>(devices: T[], now: number): T[] =>
  devices.filter((d) => d.manager === true && isRecent(d, now));

/** Whether device `uid` may change the code, the lock and the list: any device while no manager phone is
 *  marked, else only a manager phone. The server checks the same (manageDevices). */
export function mayManage(uid: string | null, devices: Pick<DeviceRecord, 'id' | 'manager' | 'lastSeen'>[], now: number): boolean {
  const managers = activeManagers(devices, now);
  return managers.length === 0 || (!!uid && managers.some((d) => d.id === uid));
}
