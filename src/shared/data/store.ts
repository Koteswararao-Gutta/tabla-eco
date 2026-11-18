// The one way every screen reads, saves and listens for data.
// Two implementations share this interface:
//  - LocalStore (local.ts): everything in this browser. Separate Chrome windows/tabs on the
//    same computer stay in sync, which is what Stage 1 previews use.
//  - FirebaseStore (later): the same calls, shared across real devices.
// Screens must never talk to localStorage, IndexedDB or Firebase directly.

import type { CollectionName, Collections, Picture } from './types';

export type Unsubscribe = () => void;
export type WithId<T> = T & { id: string };

export interface DataStore {
  readonly mode: 'local' | 'firebase';

  /** Current time in ms, corrected to the shared clock (server time). Use this, never Date.now(), for anything synced. */
  now(): number;

  /** Live view of one document. Calls back immediately with the current value (or null), then on every change. */
  watchDoc<C extends CollectionName>(col: C, id: string, cb: (doc: WithId<Collections[C]> | null) => void): Unsubscribe;

  /** Live view of a whole collection. Calls back immediately, then on every change. Order is not guaranteed. */
  watchCollection<C extends CollectionName>(col: C, cb: (docs: WithId<Collections[C]>[]) => void): Unsubscribe;

  getDoc<C extends CollectionName>(col: C, id: string): Promise<WithId<Collections[C]> | null>;
  setDoc<C extends CollectionName>(col: C, id: string, data: Collections[C]): Promise<void>;
  /** Shallow merge of top-level fields. */
  updateDoc<C extends CollectionName>(col: C, id: string, patch: Partial<Collections[C]>): Promise<void>;
  deleteDoc(col: CollectionName, id: string): Promise<void>;
  /** Creates a document with a new id and returns the id. */
  addDoc<C extends CollectionName>(col: C, data: Omit<Collections[C], 'id'>): Promise<string>;

  /** Stores a picture (resized to fit 1920x1080 for menu use) and returns its record. */
  uploadPicture(file: Blob, name: string): Promise<WithId<Picture>>;
  /** A URL an <img> can show. Cached; safe to call often. */
  pictureUrl(id: string): Promise<string | null>;
  deletePicture(id: string): Promise<void>;
}

export const newId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
