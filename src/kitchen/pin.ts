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
