// Manager PIN (pure): Screens, Staff and More ask for it; Catering stays open for front staff.
import type { AppSettings } from '@shared/data';
import { pinFingerprint } from '../../kitchen/pin';

export const DEFAULT_MANAGER_PIN = '5678';
/** After the PIN, these tabs stay open this long. Using them keeps them open. */
export const UNLOCK_MS = 10 * 60_000;

/** The manager PIN: `undefined` while settings load, the default when it was never set. */
export function expectedManagerPin(settings: AppSettings | null | undefined): string | undefined {
  if (settings === undefined) return undefined;
  const pin = settings?.managerPin?.trim();
  return pin && /^\d{4}$/.test(pin) ? pin : DEFAULT_MANAGER_PIN;
}

/** What this phone remembers after the PIN: a fingerprint (not the PIN) and when it locks again. */
export function unlockValue(pin: string, until: number): string {
  return pinFingerprint('manager:' + pin) + ':' + Math.round(until);
}

/** When the tabs lock again, or 0 if they are locked now (no unlock, it ran out, or the PIN changed). */
export function unlockedUntil(saved: string | null, pin: string | undefined, now: number): number {
  if (!saved || pin === undefined) return 0;
  const [fp, until] = saved.split(':');
  const end = Number(until);
  if (fp !== pinFingerprint('manager:' + pin) || !Number.isFinite(end) || end <= now) return 0;
  // A phone clock far ahead must not keep it open for hours.
  return Math.min(end, now + UNLOCK_MS);
}
