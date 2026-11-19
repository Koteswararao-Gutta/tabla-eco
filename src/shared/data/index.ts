import { useEffect, useState } from 'react';
import { FirebaseStore } from './firebase';
import { firebaseConfig } from './firebaseConfig';
import { LocalStore } from './local';
import type { DataStore, WithId } from './store';
import type { CollectionName, Collections, ScreenId, SingletonId, Singletons } from './types';

export * from './types';
export type { DataStore, WithId, Unsubscribe } from './store';
export { newId } from './store';
export { deviceValue, setDeviceValue } from './device';

/** The app-wide data store: Firebase (shared by every device) unless built with VITE_STORE=local,
 *  which keeps everything in one browser (tests and the offline Chrome preview). */
export const store: DataStore =
  import.meta.env.VITE_STORE === 'local' ? new LocalStore() : new FirebaseStore(firebaseConfig);

/** Live collection. `null` until the first value arrives. */
export function useCollection<C extends CollectionName>(col: C): WithId<Collections[C]>[] | null {
  const [docs, setDocs] = useState<WithId<Collections[C]>[] | null>(null);
  useEffect(() => store.watchCollection(col, setDocs), [col]);
  return docs;
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

/** Screens call this so the manager can show a green (online) or grey (offline) dot.
 *  Every 2 minutes: 6 screens x 720 = ~4,300 writes a day, well inside Firestore's free 20,000. */
export function useHeartbeat(screenId: ScreenId): void {
  useEffect(() => {
    const beat = () => store.setDoc('heartbeats', screenId, { lastSeen: store.now() });
    beat();
    const t = setInterval(beat, 120_000);
    return () => clearInterval(t);
  }, [screenId]);
}

/** A screen counts as online if it reported in the last 5 minutes. */
export const isOnline = (lastSeen: number | undefined, now: number): boolean =>
  !!lastSeen && now - lastSeen < 300_000;
