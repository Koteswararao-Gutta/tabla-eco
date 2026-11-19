// Per-device values: remembered on this one screen only, never synced to other devices.
// Same for both stores (local and Firebase). Fails quietly: no storage just means "not remembered".

const PREFIX = 'tabla-device:';

/** A value remembered on this device, or null if none (or storage is unavailable). */
export function deviceValue(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/** Remember a value on this device; null forgets it. */
export function setDeviceValue(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage unavailable: the value just isn't remembered.
  }
}
