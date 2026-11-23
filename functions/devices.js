// Approved devices: the plain rules behind checkIn, enterCode and manageDevices (index.js).
// Every phone, tablet and TV signs in anonymously. A device is "approved" when its sign-in carries the
// custom claim { tabla: true }; the Firestore rules let approved devices in.
// - Open (not locked): every device that opens the app is approved and listed by itself, so the devices
//   already in use get added before anything is locked.
// - Locked (access/locked exists): a new device needs the restaurant code once.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Which app a device opened: shown in the Devices list. Anything else is saved as 'other'. */
export const APPS = ['tv1', 'tv2', 'tv3', 'tv4', 'tv5', 'kitchen', 'front', 'manager', 'home'];
export const appName = (app) => (APPS.includes(app) ? app : 'other');

/** The restaurant code: 6 to 10 digits. */
export const CODE_RE = /^\d{6,10}$/;
export const CODE_RULE = 'The code must be 6 to 10 digits.';

/** Wrong codes allowed: per device, then for all devices together (anyone can make new anonymous sign-ins). */
export const DEVICE_TRIES = { max: 5, windowMs: 15 * 60_000 };
export const ALL_TRIES = { max: 20, windowMs: 60 * 60_000 };
/** Most devices that can ever be listed (stops junk sign-ins filling the list while open). */
export const MAX_DEVICES = 200;
/** checkIn refreshes a device's "last seen" at most this often. */
export const SEEN_EVERY_MS = 60 * 60_000;

/** { salt, hash } for a code. scrypt: slow on purpose, so a copied hash can't be tried quickly. */
export function hashCode(code, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(code, salt, 32).toString('hex') };
}

export function codeMatches(code, saved) {
  if (typeof code !== 'string' || !saved?.salt || !saved?.hash) return false;
  const a = Buffer.from(hashCode(code, saved.salt).hash, 'hex');
  const b = Buffer.from(saved.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A tries counter { count, since }: how many wrong codes in the current window. */
export function triesLeft(rec, limit, now) {
  if (!rec || typeof rec.since !== 'number' || now - rec.since >= limit.windowMs) return limit.max;
  return Math.max(0, limit.max - (rec.count ?? 0));
}

/** Minutes until a full counter opens again (at least 1). */
export function waitMinutes(rec, limit, now) {
  return Math.max(1, Math.ceil((rec.since + limit.windowMs - now) / 60_000));
}

export function afterWrong(rec, limit, now) {
  if (!rec || typeof rec.since !== 'number' || now - rec.since >= limit.windowMs) return { count: 1, since: now };
  return { count: (rec.count ?? 0) + 1, since: rec.since };
}

/** A short, plain description of the device from its browser's user agent. */
export function deviceModel(ua) {
  if (typeof ua !== 'string') return 'Unknown device';
  if (/AFT[A-Z0-9]|Fire TV|FireTV/i.test(ua)) return 'Fire TV';
  if (/Android TV|GoogleTV|BRAVIA|SMART-TV|SmartTV|Vizio|\bTV\b/i.test(ua)) return 'TV';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'Unknown device';
}

/** A device's name, as typed in the Devices list: trimmed, at most 40 characters; empty clears it. */
export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 40);
  return n || null;
}

/** A short id for logs (never the full sign-in id). */
export const shortId = (uid) => createHash('sha256').update(String(uid)).digest('hex').slice(0, 8);
