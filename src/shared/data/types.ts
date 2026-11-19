// The data shapes every screen agrees on. Owned by the foundation:
// agents never change this file; ask for a change instead.

export type ScreenId = 'tv1' | 'tv2' | 'tv3' | 'tv4' | 'tv5' | 'kitchen';
export const MENU_SCREENS: ScreenId[] = ['tv1', 'tv2', 'tv3', 'tv4'];

export interface Screen {
  id: ScreenId;
  name: string; // "TV 1"
  kind: 'menu' | 'music' | 'kitchen';
  /** Menu TVs only: which side of a pair this TV is on. */
  side?: 'left' | 'right';
  /** Menu TVs only: when set, this TV shows exactly what the named TV shows. */
  mirrorOf?: ScreenId | null;
}

export type Transition = 'fade' | 'slide' | 'none';

/** A stored picture. The bytes live in the data layer's picture storage, not in this record. */
export interface Picture {
  id: string;
  name: string;
  width: number;
  height: number;
  createdAt: number;
}

/**
 * One step of the front menu loop. All four menu TVs change slot at the same moment.
 * Seconds and transition are shared by position, so the TVs can never drift apart.
 * Each TV can have its own picture in a slot (see pictureFor in loop.ts).
 */
export interface Slot {
  id: string;
  /** Sort key: slots play in ascending order. */
  order: number;
  seconds: number;
  transition: Transition;
  /** Picture per TV. A missing entry falls back (see pictureFor). */
  pictures: Partial<Record<ScreenId, string>>; // picture id
  /** Optional: the slot drops out of the loop after this time (ms since epoch). */
  endsAt?: number | null;
  kind?: 'menu' | 'special' | 'catering';
}

export interface MusicSettings {
  /** A YouTube playlist URL or id. */
  playlist: string;
  shuffle: boolean;
  /** When the catering clip plays. */
  clipMode: 'afterEachSong' | 'everySeconds';
  everySeconds: number;
  clipSeconds: number;
  /** Pictures the catering clip is animated from. */
  clipPictures: string[];
  clipTitle: string;
  clipLine: string;
}

export interface CateringOrder {
  id: string;
  customerName: string;
  phone: string;
  /** Local date and time of pickup or delivery, as ms since epoch. */
  dueAt: number;
  type: 'pickup' | 'delivery';
  address?: string;
  people?: number | null;
  /** One item per line. */
  items: string;
  notes?: string;
  status: 'open' | 'completed';
  completedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  /** Every saved edit, oldest first (the last 50 are kept). */
  history?: OrderEdit[];
}

/**
 * What the customer pays for a catering order, for the manager app only. Kept in its own collection
 * (orderAmounts/{order id}), not on the order, so the kitchen tablet never loads it: the kitchen reads
 * and edits `orders` only, and its edits can't change or drop the amount.
 */
export interface OrderAmount {
  /** US dollars, e.g. 200 or 1250.5. null when cleared. */
  amount: number | null;
  /** Whether the customer has paid. Missing on amounts saved before this was added: treat as not paid. */
  paid?: boolean;
  updatedAt: number;
}

/** Which device saved an edit: the kitchen tablet or the manager phone app. */
export type EditedBy = 'kitchen' | 'manager';

/** One saved edit of a catering order: who, when, and what changed in plain words. */
export interface OrderEdit {
  at: number;
  by: EditedBy;
  /** e.g. "Time: 5:00 PM → 6:00 PM", "Items: 20 samosas → 25 samosas" */
  changes: string[];
}

/** What "Scan paper order" read from a photo. Empty strings mean "not on the paper". */
export interface ScannedOrder {
  /** false when the photo doesn't look like an order at all. */
  isOrder: boolean;
  customerName: string;
  phone: string;
  /** yyyy-mm-dd or '' */
  date: string;
  /** HH:MM (24-hour) or '' */
  time: string;
  type: 'pickup' | 'delivery' | 'unknown';
  address: string;
  /** Digits or '' */
  people: string;
  items: string[];
  notes: string;
  /** Form fields that were hard to read. */
  unsure: string[];
}

/** Phone alerts on this device (1-hour catering reminders):
 *  on, off (can be turned on), blocked (the person said no; only phone settings can undo it),
 *  needs-home-screen (iPhone: only works from the Home Screen app), unsupported (this browser can't). */
export type AlertState = 'on' | 'off' | 'blocked' | 'needs-home-screen' | 'unsupported';

export interface AppSettings {
  kitchenPin: string; // 4 digits
  restaurantName: string;
}

/**
 * Staff (Shift planner). Shapes match reference/shift-planner.html's normalizeDB output:
 * config = { people, settings, special }, one week = { locked, shifts }.
 * Kept loose on purpose so the planner's own code keeps owning its validation.
 */
export type StaffConfig = Record<string, unknown>;
export type StaffWeek = Record<string, unknown>;

/** Where the shared menu loop is counted from. The manager resets it when the loop changes,
 * so the change shows at once instead of mid-picture. */
export interface LoopAnchor {
  /** Shared-clock time the loop (re)started. */
  anchor: number;
  /** The slot that plays first from the anchor (e.g. a picture just added). Optional. */
  firstSlotId?: string | null;
}

/** The Toast online menu, saved by the server from the kitchen tablet's hourly read (toastMenu/current).
 *  Read only: the server writes it. Fields may be missing on an old or partial save. */
export interface ToastMenu {
  groups?: { id: string; name: string; items: { id: string; name: string; description?: string }[] }[];
  changedAt?: number;
}

/** Single documents, by id. Use useSingleton / saveSingleton from @shared/data. */
export interface Singletons {
  music: MusicSettings;
  settings: AppSettings;
  staffConfig: StaffConfig;
  loop: LoopAnchor;
  seeded: { at: number };
}
export type SingletonId = keyof Singletons;

/** Every collection the app stores, with its document type. */
export interface Collections {
  screens: Screen;
  slots: Slot;
  pictures: Picture;
  orders: CateringOrder;
  /** Manager only: the amount per order (doc id = order id). Never read it from the kitchen. */
  orderAmounts: OrderAmount;
  /** Single documents: use useSingleton / saveSingleton rather than this collection directly. */
  singletons: Singletons[SingletonId];
  staffWeeks: StaffWeek;
  /** One doc per screen id: when it last reported in. Kept apart from `screens` so a
   *  heartbeat doesn't wake every TV's listener (Firestore free-plan read limits). */
  heartbeats: { lastSeen: number };
  /** Read only (the server writes it): use useDoc('toastMenu', 'current'). */
  toastMenu: ToastMenu;
}
export type CollectionName = keyof Collections;
