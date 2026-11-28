import { useEffect, useRef, useState } from 'react';
import { FirebaseStore } from './firebase';
import { firebaseConfig } from './firebaseConfig';
import { LocalStore } from './local';
import { hasSyncTrouble, onSaveFailure, onSyncTroubleChange, type SaveFailure } from './resync';
import { filterKey, type CollectionFilter } from './filter';
import type { DataStore, WithId } from './store';
import { ADS_CODE_VERSION, type CollectionName, type Collections, type DeviceAccess, type ScreenId, type SingletonId, type Singletons } from './types';

export * from './types';
export type { DataStore, ToastMenuReport, WithId, Unsubscribe } from './store';
export { appendItems, newId, removeItems, storedVideoId } from './store';
export { deviceValue, setDeviceValue } from './device';
export { swUrl, isFrontPage } from './sw';
export { activeManagers, appLabel, currentApp, deviceLabel, isRecent, mayManage } from './access';
export type { CollectionFilter } from './filter';
export type { SaveFailure } from './resync';
export { recentSince, RECENT_DAYS } from './filter';

/** The app-wide data store: Firebase (shared by every device) unless built with VITE_STORE=local,
 *  which keeps everything in one browser (tests and the offline Chrome preview). */
export const store: DataStore =
  import.meta.env.VITE_STORE === 'local' ? new LocalStore() : new FirebaseStore(firebaseConfig);

/** Live collection. `null` until the first value arrives (and again while a changed filter loads).
 *  `filter` narrows it (see filter.ts), e.g. 'openOrRecent' (open orders and the last 60 days) for the kitchen,
 *  { dueFrom, dueTo } for one week, or { ids } for the amounts of the orders on screen. A filter object may be
 *  made anew on every render: the list only listens again when what it asks for changes. */
export function useCollection<C extends CollectionName>(col: C, filter?: CollectionFilter): WithId<Collections[C]>[] | null {
  const key = `${col}|${filterKey(filter)}`;
  const [got, setGot] = useState<{ key: string; docs: WithId<Collections[C]>[] } | null>(null);
  const latest = useRef(filter);
  latest.current = filter;
  useEffect(() => store.watchCollection(col, (docs) => setGot({ key, docs }), latest.current), [key]);
  return got && got.key === key ? got.docs : null;
}

/** This device's access (see DeviceAccess): the code screen shows on 'needs-code'. */
export function useDeviceAccess(): DeviceAccess {
  const [access, setAccess] = useState<DeviceAccess>('checking');
  useEffect(() => store.watchAccess(setAccess), []);
  return access;
}

/** Live single document. `undefined` while loading, `null` if it doesn't exist. */
export function useDoc<C extends CollectionName>(col: C, id: string): WithId<Collections[C]> | null | undefined {
  const [doc, setDoc] = useState<WithId<Collections[C]> | null | undefined>(undefined);
  useEffect(() => store.watchDoc(col, id, setDoc), [col, id]);
  return doc;
}

/** Live single document by id: music, settings, staffConfig, loop. `undefined` while loading, `null` if missing. */
export function useSingleton<K extends SingletonId>(id: K): Singletons[K] | null | undefined {
  return useDoc('singletons', id) as Singletons[K] | null | undefined;
}

/** Replace a single document. */
export function saveSingleton<K extends SingletonId>(id: K, value: Singletons[K]): Promise<void> {
  return store.setDoc('singletons', id, value);
}

/** Merge fields into a single document. */
export function updateSingleton<K extends SingletonId>(id: K, patch: Partial<Singletons[K]>): Promise<void> {
  return store.updateDoc('singletons', id, patch as Partial<Collections['singletons']>);
}

/** Call after any change to the front menu loop so every TV shows the change at once,
 *  starting from `firstSlotId` (e.g. the slot that just got a new picture). */
export function restartLoop(firstSlotId?: string | null): Promise<void> {
  return saveSingleton('loop', { anchor: store.now(), firstSlotId: firstSlotId ?? null });
}

/** URL for a stored picture, or null while loading / if missing. */
export function usePictureUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (id) store.pictureUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

/** Re-renders every `everyMs` with the shared-clock time. */
export function useNow(everyMs = 250): number {
  const [now, setNow] = useState(() => store.now());
  useEffect(() => {
    const t = setInterval(() => setNow(store.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** Screens call this so the manager can show a green (online) or grey (offline) dot, and which code version
 *  the screen runs (the manager waits for every menu TV to run new code before writing new kinds of data).
 *  Every 2 minutes: 6 screens x 720 = ~4,300 writes a day, well inside Firestore's free 20,000. */
export function useHeartbeat(screenId: ScreenId): void {
  useEffect(() => {
    const beat = () => store.setDoc('heartbeats', screenId, { lastSeen: store.now(), version: ADS_CODE_VERSION });
    beat();
    const t = setInterval(beat, 120_000);
    return () => clearInterval(t);
  }, [screenId]);
}

/** A screen counts as online if it reported in the last 5 minutes. */
export const isOnline = (lastSeen: number | undefined, now: number): boolean =>
  !!lastSeen && now - lastSeen < 300_000;

/** Saves the server refused after they already looked done (e.g. sent later, when the internet came back).
 *  `failures` is empty until one happens; `dismiss` clears the list. Used once app-wide by the "Not saved" banner. */
export function useSaveFailures(): { failures: SaveFailure[]; dismiss: () => void } {
  const [failures, setFailures] = useState<SaveFailure[]>([]);
  useEffect(() => onSaveFailure((f) => setFailures((list) => [...list.slice(-19), f])), []);
  return { failures, dismiss: () => setFailures([]) };
}

/** How long a list may stay out of touch with the server before screens say so (a normal reconnect is quicker). */
export const SYNC_TROUBLE_MS = 30_000;

/** True once some live list has been out of touch with the server for SYNC_TROUBLE_MS: no connection to the
 *  server (even with Wi-Fi on), or a list that keeps failing. False again as soon as it is back. */
export function useSyncTrouble(afterMs = SYNC_TROUBLE_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      if (!hasSyncTrouble()) return setShown(false);
      timer = setTimeout(() => setShown(hasSyncTrouble()), afterMs);
    };
    check();
    const stop = onSyncTroubleChange(check);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [afterMs]);
  return shown;
}
