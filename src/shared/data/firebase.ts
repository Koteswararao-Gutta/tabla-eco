// FirebaseStore: the same DataStore calls, shared across every real device through Firestore.
// - Devices sign in anonymously (no login screen); the Firestore rules only let signed-in devices in.
// - Firestore keeps a local copy in IndexedDB, so screens keep showing what they last saw when the
//   internet drops, and saves made offline are sent when it comes back.
// - Pictures are stored as base64 inside Firestore (collection `pictureData`), because Firebase
//   Storage needs a paid plan. Pictures are shrunk to stay well under Firestore's 1 MB document limit.
// - now() is corrected to the server clock, so every TV agrees on the loop position.

import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  deleteDoc as fsDelete,
  doc,
  collection,
  documentId,
  getDoc as fsGet,
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
  limit,
  or,
  query,
  where,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc as fsSet,
  waitForPendingWrites,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';
import { filterKey, idChunks, recentSince, type CollectionFilter } from './filter';
import { fitPicture } from './local';
import type { DataStore, ToastMenuReport, Unsubscribe, WithId } from './store';
import { clean, newId } from './store';
import { keepListening, queued, scheduleClockSync, singleFlight } from './resync';
import { vapidKey } from './firebaseConfig';
import { swUrl } from './sw';
import type { AlertState, CollectionName, Collections, Picture, ScannedOrder } from './types';

/** Largest picture we store, in bytes before base64 (base64 adds a third; the limit per document is 1 MB). */
const MAX_PICTURE_BYTES = 650_000;

export class FirebaseStore implements DataStore {
  readonly mode = 'firebase' as const;
  private app: FirebaseApp;
  private db: Firestore;
  private ready: Promise<void>;
  private offset = 0;
  private urlCache = new Map<string, Promise<string | null>>();

  constructor(config: FirebaseOptions) {
    const app = (this.app = initializeApp(config));
    this.db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    });
    const auth = getAuth(app);
    let signingIn = false;
    const signIn = () => {
      if (signingIn) return;
      signingIn = true;
      const tryIn = () =>
        signInAnonymously(auth).then(
          () => void (signingIn = false),
          () => setTimeout(tryIn, 10_000),
        );
      tryIn();
    };
    // Resolves once this device is signed in. A device that signed in before keeps its sign-in
    // offline, so a TV that restarts without internet still opens its cached data.
    this.ready = new Promise((resolve) => {
      const stop = onAuthStateChanged(auth, (user) => {
        if (user) {
          stop();
          resolve();
        }
      });
      auth.authStateReady().then(() => {
        if (!auth.currentUser) signIn();
      });
    });
    // A device can lose its sign-in later (its anonymous account removed, or its sign-in refused on a refresh).
    // Then every list would fail until a reload; sign in again instead, so a kitchen tablet or TV recovers by itself.
    this.ready.then(() =>
      onAuthStateChanged(auth, (user) => {
        if (!user) signIn();
      }),
    );
    // Every 30 s until the first sync works, then hourly; again when the internet returns or the
    // device's own clock is changed.
    this.ready.then(() => scheduleClockSync(() => this.syncClock(), { events: typeof window === 'undefined' ? null : window }));
  }

  // ---------- shared clock ----------
  now(): number {
    return Date.now() + this.offset;
  }

  /** True when the offset was updated. Offline (or no answer within 10 s) keeps the last offset. */
  private async syncClock(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    // Without internet the write below waits (queued in Firestore's offline copy) until the internet is
    // back. While one is still waiting, no new one is queued, so at most one clock write piles up.
    const attempt = this.clockAttempt();
    if (!attempt) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((r) => (timer = setTimeout(() => r(false), 10_000)));
    try {
      return await Promise.race([attempt, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Writes a server timestamp and reads it back; the server time sits halfway through the round trip. */
  private clockAttempt = singleFlight(async () => {
    try {
      // A clock write left waiting before a reload is still queued: wait for it rather than adding another.
      if (clockWriteWaiting()) await waitForPendingWrites(this.db);
      const ref = doc(this.db, 'clocks', deviceId());
      const t0 = Date.now();
      clockWriteWaiting(true);
      await fsSet(ref, { t: serverTimestamp() });
      clockWriteWaiting(false);
      const snap = await getDocFromServer(ref);
      const t1 = Date.now();
      const server = (snap.get('t') as Timestamp | undefined)?.toMillis();
      if (!server || t1 - t0 >= 5000) return false;
      this.offset = server - (t0 + t1) / 2;
      return true;
    } catch {
      return false;
    }
  });

  // ---------- documents ----------
  private ref(col: string, id: string) {
    return doc(this.db, col, id);
  }

  /** Starts a Firestore listener once signed in. Returns an unsubscribe that works before or after that. */
  private later(start: () => Unsubscribe): Unsubscribe {
    let stop: Unsubscribe | null = null;
    let dead = false;
    this.ready.then(() => {
      if (!dead) stop = start();
    });
    return () => {
      dead = true;
      stop?.();
    };
  }

  watchDoc<C extends CollectionName>(col: C, id: string, cb: (doc: WithId<Collections[C]> | null) => void): Unsubscribe {
    return this.later(() =>
      keepListening(
        (ok, fail) =>
          onSnapshot(
            this.ref(col, id),
            (s) => {
              ok();
              cb(s.exists() ? ({ ...s.data(), id } as WithId<Collections[C]>) : null);
            },
            fail,
          ),
        `watchDoc ${col}/${id}`,
      ),
    );
  }

  watchCollection<C extends CollectionName>(col: C, cb: (docs: WithId<Collections[C]>[]) => void, filter?: CollectionFilter): Unsubscribe {
    const label = `watchCollection ${col}${filter ? ` (${filterKey(filter).slice(0, 60)})` : ''}`;
    // { ids }: one query per 30 ids (Firestore's limit for `in`); the list is sent once every part has answered.
    if (filter && typeof filter === 'object' && 'ids' in filter) {
      const chunks = idChunks(filter.ids);
      if (chunks.length === 0) {
        cb([]);
        return () => {};
      }
      const parts: (WithId<Collections[C]>[] | null)[] = chunks.map(() => null);
      const send = () => {
        if (parts.every(Boolean)) cb(parts.flatMap((p) => p!));
      };
      const stops = chunks.map((ids, i) =>
        this.later(() =>
          keepListening(
            (ok, fail) =>
              onSnapshot(
                query(collection(this.db, col), where(documentId(), 'in', ids)),
                { includeMetadataChanges: true },
                (q) => {
                  ok(q.metadata.fromCache);
                  if (parts[i] && !q.docChanges().length) return; // only "connected or not" changed
                  parts[i] = q.docs.map((d) => ({ ...d.data(), id: d.id }) as WithId<Collections[C]>);
                  send();
                },
                fail,
              ),
            `${label} part ${i + 1}`,
          ),
        ),
      );
      return () => stops.forEach((stop) => stop());
    }
    return this.later(() => {
      // The same rules as matchesFilter (filter.ts). The or() queries need the composite indexes in firestore.indexes.json.
      const all = collection(this.db, col);
      const since = recentSince(this.now());
      const source =
        filter === 'openOrRecent'
          ? query(all, or(where('status', '==', 'open'), where('dueAt', '>=', since)))
          : filter === 'openOrRecentlyUpdated'
            ? query(all, or(where('status', '==', 'open'), where('updatedAt', '>=', since)))
            : filter === 'notPaid'
              ? query(all, where('paid', '==', false))
              : filter
                ? query(all, where('dueAt', '>=', filter.dueFrom), where('dueAt', '<', filter.dueTo))
                : all;
      // Metadata changes too, so the list can say when it is only showing this device's copy (see hasSyncTrouble);
      // a snapshot where only that changed is not passed on.
      return keepListening((ok, fail) => {
        let sent = false;
        return onSnapshot(
          source,
          { includeMetadataChanges: true },
          (q) => {
            ok(q.metadata.fromCache);
            if (sent && !q.docChanges().length) return;
            sent = true;
            cb(q.docs.map((d) => ({ ...d.data(), id: d.id }) as WithId<Collections[C]>));
          },
          fail,
        );
      }, label);
    });
  }


  async getDoc<C extends CollectionName>(col: C, id: string): Promise<WithId<Collections[C]> | null> {
    await this.ready;
    const s = await fsGet(this.ref(col, id));
    return s.exists() ? ({ ...s.data(), id } as WithId<Collections[C]>) : null;
  }

  async hasAnyDoc(col: CollectionName): Promise<boolean> {
    await this.ready;
    return !(await getDocsFromServer(query(collection(this.db, col), limit(1)))).empty;
  }

  async createIfMissing<C extends CollectionName>(col: C, id: string, data: Collections[C]): Promise<boolean> {
    await this.ready;
    const ref = this.ref(col, id);
    return runTransaction(this.db, async (tx) => {
      if ((await tx.get(ref)).exists()) return false;
      tx.set(ref, { ...clean(data as object), id });
      return true;
    });
  }

  async updateIf<C extends CollectionName>(col: C, id: string, test: (cur: WithId<Collections[C]> | null) => boolean, patch: Partial<Collections[C]>): Promise<boolean> {
    await this.ready;
    const ref = this.ref(col, id);
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists() ? ({ ...snap.data(), id } as WithId<Collections[C]>) : null;
      if (!test(cur)) return false;
      tx.set(ref, { ...clean(patch as object), id }, { merge: true });
      return true;
    });
  }

  async setDoc<C extends CollectionName>(col: C, id: string, data: Collections[C]): Promise<void> {
    await this.ready;
    await queued(fsSet(this.ref(col, id), { ...clean(data as object), id }), `setDoc ${col}/${id}`);
  }

  async updateDoc<C extends CollectionName>(col: C, id: string, patch: Partial<Collections[C]>): Promise<void> {
    await this.ready;
    await queued(fsSet(this.ref(col, id), { ...clean(patch as object), id }, { merge: true }), `updateDoc ${col}/${id}`);
  }

  async deleteDoc(col: CollectionName, id: string): Promise<void> {
    await this.ready;
    await queued(fsDelete(this.ref(col, id)), `deleteDoc ${col}/${id}`);
  }

  async addDoc<C extends CollectionName>(col: C, data: Omit<Collections[C], 'id'>): Promise<string> {
    const id = newId();
    await this.setDoc(col, id, data as Collections[C]);
    return id;
  }

  // ---------- pictures ----------
  async uploadPicture(file: Blob, name: string): Promise<WithId<Picture>> {
    const fitted = await fitPicture(file);
    const blob = fitted.blob.size > MAX_PICTURE_BYTES ? await shrink(fitted.blob) : fitted.blob;
    const id = newId();
    await this.ready;
    // A picture is only added once it reached the server: TVs would otherwise get a picture they can't load.
    // Without internet that wait would never end, so the Add button gives up with a plain message instead.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('No internet. Please add the picture when online.');
    const sent = fsSet(doc(this.db, 'pictureData', id), { type: blob.type || 'image/jpeg', data: await toBase64(blob) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<never>((_, fail) => (timer = setTimeout(() => fail(new Error('The picture could not be sent. Please check the internet.')), 60_000)));
    try {
      await Promise.race([sent, slow]);
    } finally {
      clearTimeout(timer);
    }
    const pic: Picture = { id, name, width: fitted.width, height: fitted.height, createdAt: this.now() };
    await this.setDoc('pictures', id, pic);
    return { ...pic, id };
  }

  pictureUrl(id: string): Promise<string | null> {
    let hit = this.urlCache.get(id);
    if (!hit) {
      hit = (async () => {
        await this.ready;
        // Served from Firestore's offline copy when there is no internet.
        const s = await fsGet(doc(this.db, 'pictureData', id));
        const data = s.get('data') as string | undefined;
        if (!data) return null;
        return URL.createObjectURL(fromBase64(data, (s.get('type') as string) || 'image/jpeg'));
      })().catch(() => null);
      this.urlCache.set(id, hit);
      // A missing or failed picture is asked for again next time, so it shows once it arrives.
      hit.then((u) => u ?? this.urlCache.delete(id));
    }
    return hit;
  }

  async deletePicture(id: string): Promise<void> {
    await this.ready;
    await fsDelete(doc(this.db, 'pictureData', id));
    const url = await this.urlCache.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urlCache.delete(id);
    await this.deleteDoc('pictures', id);
  }

  // ---------- phone alerts ----------
  async alertState(): Promise<AlertState> {
    if (!vapidKey) return 'unsupported';
    if (!pushSupported()) return isIphoneBrowser() ? 'needs-home-screen' : 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    if (Notification.permission !== 'granted' || !flag()) return 'off';
    this.registerPush().catch((e) => console.warn('alerts refresh', e)); // the address can change; keep it current
    return 'on';
  }

  async turnOnAlerts(): Promise<AlertState> {
    if (!vapidKey || !pushSupported()) return this.alertState();
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
    await this.registerPush();
    flag(true);
    return 'on';
  }

  private async registerPush(): Promise<void> {
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) throw new Error('Push is not supported here');
    const reg = await navigator.serviceWorker.register(swUrl());
    const token = await getToken(getMessaging(this.app), { vapidKey, serviceWorkerRegistration: reg });
    await this.ready;
    await fsSet(doc(this.db, 'pushTokens', deviceId()), { token, device: navigator.userAgent.slice(0, 200), updatedAt: this.now() });
  }

  // ---------- reading paper orders ----------
  async readOrderPhoto(photo: Blob): Promise<ScannedOrder> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('No internet. Please try again when online.');
    let jpeg: Blob;
    try {
      jpeg = await scanSize(photo);
    } catch {
      throw new Error("That photo couldn't be opened. Please try another one.");
    }
    return this.readOrder({ image: await toBase64(jpeg), mediaType: 'image/jpeg' }, 'photo');
  }

  async readOrderText(text: string): Promise<ScannedOrder> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('No internet. Please try again when online.');
    if (text.trim().length < 5) throw new Error('Please paste the customer’s message first.');
    if (text.length > 8000) throw new Error('That message is too long. Please paste only the order part.');
    return this.readOrder({ text }, 'message');
  }

  async reportToastMenu(report: ToastMenuReport): Promise<void> {
    await this.ready;
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    await httpsCallable(getFunctions(this.app), 'reportToastMenu', { timeout: 30_000 })(report);
  }

  private async readOrder(input: object, what: 'photo' | 'message'): Promise<ScannedOrder> {
    await this.ready;
    const d = new Date(this.now());
    const p = (n: number) => String(n).padStart(2, '0');
    try {
      // Loaded only when a photo or message is read, so the app itself opens faster.
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const call = httpsCallable<object, ScannedOrder>(getFunctions(this.app), 'readOrder', { timeout: 70_000 });
      const res = await call({
        ...input,
        today: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
        weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
      });
      return res.data;
    } catch (e) {
      console.warn('readOrder', e);
      // The server says plainly when this photo or message can't be read, or the day's limit is used up
      // (trying again won't help).
      const err = e as { code?: string; message?: string };
      if ((err?.code === 'functions/invalid-argument' || err?.code === 'functions/resource-exhausted') && err.message) throw new Error(err.message);
      throw new Error(`Couldn't read the ${what} right now. Please try again, or type the order in.`);
    }
  }
}

/** Phone alerts: the browser's push address for this device, saved in `pushTokens/<device id>`.
 *  The server sends the 1-hour catering reminders to every saved address. */
function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}
function isIphoneBrowser(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const homeScreen = (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  return ios && !homeScreen;
}
const ALERTS_FLAG = 'tabla-alerts';
function flag(on?: boolean): boolean {
  try {
    if (on !== undefined) localStorage.setItem(ALERTS_FLAG, on ? '1' : '0');
    return localStorage.getItem(ALERTS_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Long side 1600 px, JPEG: sharp enough to read handwriting, small enough to send quickly. */
async function scanSize(photo: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(photo);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise<Blob>((r, j) => canvas.toBlob((b) => (b ? r(b) : j(new Error('encode'))), 'image/jpeg', 0.85));
}

/** Remembers across reloads that a clock write is still queued (sent once the internet is back). */
function clockWriteWaiting(set?: boolean): boolean {
  try {
    if (set !== undefined) set ? localStorage.setItem('tabla-clock-write', '1') : localStorage.removeItem('tabla-clock-write');
    return localStorage.getItem('tabla-clock-write') === '1';
  } catch {
    return false;
  }
}

/** A stable id for this device, used only for its clock document. */
function deviceId(): string {
  try {
    let id = localStorage.getItem('tabla-device');
    if (!id) localStorage.setItem('tabla-device', (id = newId()));
    return id;
  } catch {
    return 'unknown';
  }
}

/** Re-encodes a picture as JPEG, lowering quality until it fits. */
async function shrink(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  let out = blob;
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    out = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', q));
    if (out.size <= MAX_PICTURE_BYTES) break;
  }
  return out;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(data: string, type: string): Blob {
  const s = atob(data);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type });
}
