// The one way every screen reads, saves and listens for data.
// Two implementations share this interface:
//  - LocalStore (local.ts): everything in this browser. Separate Chrome windows/tabs on the
//    same computer stay in sync, which is what Stage 1 previews use.
//  - FirebaseStore (firebase.ts): the same calls, shared across real devices.
// Screens must never talk to localStorage, IndexedDB or Firebase directly.

import type { CollectionFilter } from './filter';
import type { AlertState, CollectionName, Collections, DeviceAccess, DeviceAction, Picture, ScannedOrder } from './types';

export type Unsubscribe = () => void;
export type WithId<T> = T & { id: string };

export interface DataStore {
  readonly mode: 'local' | 'firebase';

  /** Current time in ms, corrected to the shared clock (server time). Use this, never Date.now(), for anything synced.
   *  LocalStore: Date.now(). FirebaseStore must measure its offset from server time at start
   *  (write a server timestamp and read it back, or the HTTP Date header) and refresh it hourly. */
  now(): number;

  /** Live view of one document. Calls back immediately with the current value (or null), then on every change. */
  watchDoc<C extends CollectionName>(col: C, id: string, cb: (doc: WithId<Collections[C]> | null) => void): Unsubscribe;

  /** Live view of a whole collection. Calls back immediately, then on every change. Order is not guaranteed.
   *  With `filter`, only the matching documents (see filter.ts), e.g. open and recent orders. */
  watchCollection<C extends CollectionName>(col: C, cb: (docs: WithId<Collections[C]>[]) => void, filter?: CollectionFilter): Unsubscribe;

  getDoc<C extends CollectionName>(col: C, id: string): Promise<WithId<Collections[C]> | null>;
  setDoc<C extends CollectionName>(col: C, id: string, data: Collections[C]): Promise<void>;
  /** Shallow merge of top-level fields, creating the document if it is missing
   *  (FirebaseStore implements this as setDoc(..., { merge: true })).
   *  Never pass undefined values: to clear a field, set it to null. Stores strip undefined. */
  updateDoc<C extends CollectionName>(col: C, id: string, patch: Partial<Collections[C]>): Promise<void>;
  deleteDoc(col: CollectionName, id: string): Promise<void>;
  /** Creates a document with a new id and returns the id. */
  addDoc<C extends CollectionName>(col: C, data: Omit<Collections[C], 'id'>): Promise<string>;
  /** True when the collection holds at least one document. FirebaseStore asks the server (never its
   *  local copy) and throws when it can't reach it, so "empty" is only ever a confirmed answer. */
  hasAnyDoc(col: CollectionName): Promise<boolean>;
  /** Creates the document only if it doesn't exist yet, in one step (FirebaseStore: a transaction, so two
   *  devices can't both create it; it throws when offline). True when this call created it. Never overwrites. */
  createIfMissing<C extends CollectionName>(col: C, id: string, data: Collections[C]): Promise<boolean>;
  /** Merges `patch` into the document only if `test` holds for it as saved right now (null when missing), in one
   *  step (FirebaseStore: a transaction, which reads the server, never a stale local copy; it throws when offline).
   *  True when it saved. For small automatic fixes that must never undo another device's newer change. */
  updateIf<C extends CollectionName>(col: C, id: string, test: (cur: WithId<Collections[C]> | null) => boolean, patch: Partial<Collections[C]>): Promise<boolean>;

  /** Stores a picture (resized to fit 1920x1080 for menu use) and returns its record. */
  uploadPicture(file: Blob, name: string): Promise<WithId<Picture>>;
  /** A URL an <img> can show, served from a local cache (a blob: URL) so it keeps working offline.
   *  FirebaseStore must cache picture bytes in IndexedDB too. Cached; safe to call often. */
  pictureUrl(id: string): Promise<string | null>;
  deletePicture(id: string): Promise<void>;

  /** Reads a photo of a paper catering order with AI (server side) and returns the form's fields.
   *  Saves nothing. Throws with a plain message when it can't (offline, unreadable, server down).
   *  LocalStore returns a fixed sample so previews and tests work without the server. */
  readOrderPhoto(photo: Blob): Promise<ScannedOrder>;
  /** Same as readOrderPhoto, for a customer's text message or email pasted into the New order sheet. */
  readOrderText(text: string): Promise<ScannedOrder>;

  /** Kitchen tablet app: sends the menu it read from Tabla's Toast ordering page (or why it couldn't) to the
   *  server, which saves it to toastMenu/current. Throws when it can't reach the server. LocalStore does nothing. */
  reportToastMenu(report: ToastMenuReport): Promise<void>;

  /** Approved devices. Calls back at once, then whenever this device's access changes. */
  watchAccess(cb: (access: DeviceAccess) => void): Unsubscribe;
  /** The code screen: approves this device when the restaurant code is right. Throws with a plain message. */
  enterDeviceCode(code: string): Promise<void>;
  /** More > Devices: set the code, lock or open the app, rename or remove a device. Throws with a plain message. */
  manageDevices(req: DeviceAction): Promise<void>;
  /** This device's id in the `devices` list (its sign-in id), or null before it is known. */
  thisDeviceId(): string | null;

  /** Whether this device gets the 1-hour catering alerts. When on, also refreshes the device's alert address. */
  alertState(): Promise<AlertState>;
  /** Asks the person for permission (must be called from a tap) and registers this device for alerts. */
  turnOnAlerts(): Promise<AlertState>;
}

/** What the kitchen tablet app read from Toast: the page's menu data as is, or why it couldn't. */
export type ToastMenuReport = { menus: unknown[] } | { error: string };

/** Removes undefined top-level values (Firestore rejects them). */
export function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export const newId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
