// Kitchen PIN keypad logic (pure).
import type { AppSettings } from '@shared/data';

export const PIN_LENGTH = 4;
export const DEFAULT_PIN = '1234';

/** The PIN to unlock with: `undefined` while settings load, the default when settings are missing. */
export function expectedPin(settings: AppSettings | null | undefined): string | undefined {
  if (settings === undefined) return undefined;
  const pin = settings?.kitchenPin?.trim();
  return pin && /^\d{4}$/.test(pin) ? pin : DEFAULT_PIN;
}

export type Key = string; // '0'..'9', 'back', 'clear'

/** The entry after a key press. Never longer than PIN_LENGTH. */
export function press(entry: string, key: Key): string {
  if (key === 'back') return entry.slice(0, -1);
  if (key === 'clear') return '';
  if (/^\d$/.test(key) && entry.length < PIN_LENGTH) return entry + key;
  return entry;
}

/** A short fingerprint of the PIN, kept with "unlocked" on this tablet (not the PIN itself).
 *  When the manager changes the PIN, the fingerprint no longer matches and the tablet locks. */
export function pinFingerprint(pin: string): string {
  let h = 0x811c9dc5; // FNV-1a
  for (const c of 'tabla-kitchen:' + pin) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Unlocked on this tablet: the saved fingerprint matches the current PIN. */
export const isUnlocked = (saved: string | null, pin: string | undefined): boolean =>
  !!saved && pin !== undefined && saved === pinFingerprint(pin);
