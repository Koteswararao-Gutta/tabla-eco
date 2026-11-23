// LocalStore: the whole system inside one browser.
// Documents live in localStorage (one key per collection), pictures in IndexedDB.
// Other windows hear changes through the browser's "storage" event, so /tv/1 to /tv/4,
// /kitchen and /manager open side by side in Chrome behave like the real devices.

import { matchesFilter, recentSince, type CollectionFilter } from './filter';
import type { DataStore, Unsubscribe, WithId } from './store';
import { clean, isAppend, newId } from './store';
import type { AlertState, CollectionName, Collections, DeviceAccess, DeviceAction, DeviceRecord, Picture, ScannedOrder } from './types';
import { currentApp } from './access';

const PREFIX = 'tabla:';
type Table = Record<string, unknown>;
type Listener = () => void;

const MAX_W = 1920;
const MAX_H = 1080;

export class LocalStore implements DataStore {
  readonly mode = 'local' as const;
  private listeners = new Map<CollectionName, Set<Listener>>();
  private urlCache = new Map<string, string>();
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    window.addEventListener('storage', (e) => {
      if (!e.key || !e.key.startsWith(PREFIX)) return;
      this.emit(e.key.slice(PREFIX.length) as CollectionName);
    });
  }

  now(): number {
    return Date.now();
  }

  // ---------- documents ----------
  private read(col: CollectionName): Table {
    try {
      return JSON.parse(localStorage.getItem(PREFIX + col) || '{}') as Table;
    } catch {
      return {};
    }
  }

  private write(col: CollectionName, table: Table): void {
    localStorage.setItem(PREFIX + col, JSON.stringify(table));
    this.emit(col);
  }

  private emit(col: CollectionName): void {
    this.listeners.get(col)?.forEach((l) => l());
  }

  private listen(col: CollectionName, l: Listener): Unsubscribe {
    if (!this.listeners.has(col)) this.listeners.set(col, new Set());
    this.listeners.get(col)!.add(l);
    return () => this.listeners.get(col)?.delete(l);
  }

  watchDoc<C extends CollectionName>(col: C, id: string, cb: (doc: WithId<Collections[C]> | null) => void): Unsubscribe {
    let last = '\u0000';
    const run = () => {
      const raw = this.read(col)[id];
      const s = JSON.stringify(raw ?? null);
      if (s === last) return;
      last = s;
      cb(raw ? ({ ...(raw as object), id } as WithId<Collections[C]>) : null);
    };
    run();
    return this.listen(col, run);
  }

  watchCollection<C extends CollectionName>(col: C, cb: (docs: WithId<Collections[C]>[]) => void, filter?: CollectionFilter): Unsubscribe {
    let last = '\u0000';
    const since = recentSince(this.now());
    // { ids }: just those documents (the same rule as matchesFilter, without looking at every document).
    const ids = filter && typeof filter === 'object' && 'ids' in filter ? new Set(filter.ids) : null;
    const run = () => {
      const table = this.read(col);
      const s = JSON.stringify(table);
      if (s === last) return;
      last = s;
      const entries = ids ? [...ids].filter((id) => table[id]).map((id) => [id, table[id]] as const) : Object.entries(table);
      const docs = entries.map(([id, d]) => ({ ...(d as object), id }) as WithId<Collections[C]>);
      cb(filter && !ids ? docs.filter((d) => matchesFilter(d, filter, since, d.id)) : docs);
    };
    run();
    return this.listen(col, run);
  }

  async getDoc<C extends CollectionName>(col: C, id: string): Promise<WithId<Collections[C]> | null> {
    const raw = this.read(col)[id];
    return raw ? ({ ...(raw as object), id } as WithId<Collections[C]>) : null;
  }

  async hasAnyDoc(col: CollectionName): Promise<boolean> {
    return Object.keys(this.read(col)).length > 0;
  }

  async createIfMissing<C extends CollectionName>(col: C, id: string, data: Collections[C]): Promise<boolean> {
    if (this.read(col)[id]) return false;
    await this.setDoc(col, id, data);
    return true;
  }

  async updateIf<C extends CollectionName>(col: C, id: string, test: (cur: WithId<Collections[C]> | null) => boolean, patch: Partial<Collections[C]>): Promise<boolean> {
    const cur = (this.read(col)[id] as WithId<Collections[C]> | undefined) ?? null;
    if (!test(cur)) return false;
    await this.updateDoc(col, id, patch);
    return true;
  }

  async setDoc<C extends CollectionName>(col: C, id: string, data: Collections[C]): Promise<void> {
    const t = this.read(col);
    t[id] = { ...clean(data as object), id };
    this.write(col, t);
  }

  async updateDoc<C extends CollectionName>(col: C, id: string, patch: Partial<Collections[C]>): Promise<void> {
    const t = this.read(col);
    const cur = ((t[id] as Record<string, unknown>) || {});
    const next: Record<string, unknown> = { ...cur };
    for (const [k, v] of Object.entries(clean(patch as object))) next[k] = isAppend(v) ? [...(Array.isArray(cur[k]) ? (cur[k] as unknown[]) : []), ...v] : v;
    t[id] = { ...next, id };
    this.write(col, t);
  }

  async deleteDoc(col: CollectionName, id: string): Promise<void> {
    const t = this.read(col);
    delete t[id];
    this.write(col, t);
  }

  async addDoc<C extends CollectionName>(col: C, data: Omit<Collections[C], 'id'>): Promise<string> {
    const id = newId();
    const t = this.read(col);
    t[id] = { ...clean(data as object), id };
    this.write(col, t);
    return id;
  }

  // ---------- pictures ----------
  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('tabla-pictures', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('blobs');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private async idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction('blobs', mode).objectStore('blobs'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async uploadPicture(file: Blob, name: string): Promise<WithId<Picture>> {
    const { blob, width, height } = await fitPicture(file);
    const id = newId();
    await this.idb('readwrite', (s) => s.put(blob, id));
    const pic: Picture = { id, name, width, height, createdAt: this.now() };
    await this.setDoc('pictures', id, pic);
    return { ...pic, id };
  }

  async pictureUrl(id: string): Promise<string | null> {
    const hit = this.urlCache.get(id);
    if (hit) return hit;
    const blob = await this.idb<Blob | undefined>('readonly', (s) => s.get(id));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urlCache.set(id, url);
    return url;
  }

  async deletePicture(id: string): Promise<void> {
    await this.idb('readwrite', (s) => s.delete(id));
    const url = this.urlCache.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urlCache.delete(id);
    await this.deleteDoc('pictures', id);
  }

  // ---------- approved devices ----------
  // No server here: the same steps, kept in this browser so the screens can be tried and tested.
  // access/locked (exists = locked) and access/code (the code itself, local only) stand in for the server's.
  // A tab is one device (its id is kept per tab), so two tabs can play a new and an approved device.
  private localDeviceId(): string {
    try {
      let id = sessionStorage.getItem('tabla-local-device');
      if (!id) sessionStorage.setItem('tabla-local-device', (id = newId()));
      return id;
    } catch {
      return 'this-device';
    }
  }

  private approveHere(how: DeviceRecord['how']) {
    const d: DeviceRecord = { id: this.localDeviceId(), app: currentApp(), model: 'This browser', name: null, how, approvedAt: this.now(), lastSeen: this.now() };
    void this.setDoc('devices', d.id, d);
  }

  private accessNow(): DeviceAccess {
    if (this.read('devices')[this.localDeviceId()]) return 'ok';
    if (this.read('access').locked) return 'needs-code';
    this.approveHere('open');
    return 'ok';
  }

  watchAccess(cb: (a: DeviceAccess) => void): Unsubscribe {
    let last: DeviceAccess | null = null;
    const run = () => {
      const a = this.accessNow();
      if (a !== last) cb((last = a));
    };
    run();
    const a = this.listen('access', run);
    const d = this.listen('devices', run);
    return () => {
      a();
      d();
    };
  }

  thisDeviceId(): string | null {
    return this.localDeviceId();
  }

  async enterDeviceCode(code: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 200));
    const saved = (this.read('access').code as { code?: string } | undefined)?.code;
    if (!saved) throw new Error('No restaurant code is set yet. Set one in the manager app: More > Devices.');
    if (code !== saved) throw new Error("That code didn't work. Please try again.");
    this.approveHere('code');
  }

  async manageDevices(req: DeviceAction): Promise<void> {
    const now = this.now();
    const info = (this.read('access').info as object | undefined) ?? {};
    const access = this.read('access');
    if (req.action === 'setCode') {
      if (!/^\d{6,10}$/.test(req.code)) throw new Error('The code must be 6 to 10 digits.');
      this.write('access', { ...access, code: { code: req.code }, info: { ...info, id: 'info', codeSetAt: now, updatedAt: now } });
    } else if (req.action === 'lock') {
      if (!access.code) throw new Error('Set the restaurant code first.');
      this.write('access', { ...access, locked: { at: now }, info: { ...info, id: 'info', locked: true, lockedAt: now, updatedAt: now } });
    } else if (req.action === 'unlock') {
      const { locked: _, ...rest } = access;
      this.write('access', { ...rest, info: { ...info, id: 'info', locked: false, lockedAt: null, updatedAt: now } });
    } else if (req.action === 'rename') {
      const name = req.name.replace(/\s+/g, ' ').trim().slice(0, 40) || null;
      await this.updateDoc('devices', req.uid, { name });
    } else {
      if (req.uid === this.localDeviceId()) throw new Error("You can't remove the device you are using.");
      await this.deleteDoc('devices', req.uid);
    }
  }

  /** No server here: alerts are only pretended, so the screens can be tried. */
  private alerts: AlertState = 'off';
  async alertState(): Promise<AlertState> {
    return this.alerts;
  }
  async turnOnAlerts(): Promise<AlertState> {
    return (this.alerts = 'on');
  }

  /** No server here: a fixed sample order for tomorrow, so the scan flow can be tried and tested. */
  async readOrderPhoto(photo: Blob): Promise<ScannedOrder> {
    if (!photo.size) throw new Error("That photo couldn't be opened.");
    return this.sampleScan();
  }

  /** No server here: the Toast menu is only saved on the live app. */
  async reportToastMenu(): Promise<void> {}

  /** No server here: the same fixed sample, so the paste flow can be tried and tested. */
  async readOrderText(text: string): Promise<ScannedOrder> {
    if (text.trim().length < 5) throw new Error('Please paste the customer’s message first.');
    return this.sampleScan();
  }

  private async sampleScan(): Promise<ScannedOrder> {
    await new Promise((r) => setTimeout(r, 300));
    const d = new Date(this.now());
    d.setDate(d.getDate() + 1);
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      isOrder: true,
      customerName: 'Meera Iyer',
      phone: '555 404 1212',
      date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      time: '18:30',
      type: 'pickup',
      address: '',
      people: '40',
      lines: [
        { dish: 'Veg Dum Biryani', qty: '2', unit: 'Full tray', note: '', unsure: false },
        { dish: 'Gulab Jamun', qty: '50', unit: 'Pieces', note: '', unsure: false },
        { dish: 'Mirchi bajji', qty: '30', unit: 'Pieces', note: 'extra chutney', unsure: true },
      ],
      notes: 'Less spicy',
      unsure: ['phone'],
    };
  }
}

/** Shrinks a picture to fit 1920x1080 (never enlarges) and re-encodes it. SVGs and small files pass through. */
export async function fitPicture(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Not a picture'));
      i.src = url;
    });
    const w0 = img.naturalWidth || MAX_W;
    const h0 = img.naturalHeight || MAX_H;
    const scale = Math.min(1, MAX_W / w0, MAX_H / h0);
    if (file.type === 'image/svg+xml' || (scale === 1 && file.size < 1_500_000)) {
      return { blob: file, width: w0, height: h0 };
    }
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.88));
    return { blob, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
