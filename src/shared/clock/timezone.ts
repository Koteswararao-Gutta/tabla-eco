// The restaurant runs on Arizona time (America/Phoenix: UTC-7 all year, no daylight saving).
// Times are shown and reminders ring in the device's own time zone, so a device set to another
// zone with a different offset right now shows times off by an hour or more.

export const RESTAURANT_ZONE = 'America/Phoenix';

/** Minutes ahead of UTC that `zone` is at time `at` (Phoenix: -420). `null` if the zone is unknown. */
export function zoneOffsetMinutes(zone: string, at: number): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(at);
  } catch {
    return null;
  }
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  if (!Number.isFinite(wall)) return null;
  return Math.round((wall - Math.floor(at / 1000) * 1000) / 60_000);
}

/** True when a device in `zone` shows a different clock time than Arizona at time `at`.
 *  `fallbackOffset` (minutes ahead of UTC) is used when the zone name is missing or unknown. */
export function zoneDiffersFromArizona(zone: string | undefined, at: number, fallbackOffset: number): boolean {
  const arizona = zoneOffsetMinutes(RESTAURANT_ZONE, at) ?? -420;
  const device = (zone ? zoneOffsetMinutes(zone, at) : null) ?? fallbackOffset;
  return device !== arizona;
}

/** Checks this device right now. */
export function deviceZoneIsWrong(at = Date.now()): boolean {
  let zone: string | undefined;
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    zone = undefined;
  }
  return zoneDiffersFromArizona(zone, at, -new Date(at).getTimezoneOffset());
}
