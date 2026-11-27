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
  /** Set when this picture stands for a video (an ad): menu TVs play the video in this picture's spot and
   *  show the picture itself while it loads or if it can't play. Missing or null: a plain picture. */
  video?: PictureVideo | null;
}

/** A video shipped with the site (public/ads/). The file name carries a version, so it is never changed in place. */
export interface PictureVideo {
  /** Path from the site's top folder, e.g. "ads/catering-left-1.mp4". */
  src: string;
  /** true: play with sound through the TV's speaker. false: always muted. */
  sound: boolean;
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
  /** One item per line, as text. Always saved, made from `lines` when the order has them, so the
   *  kitchen, alerts and older app versions keep working from it. */
  items: string;
  /** The same items, structured: dish, quantity, unit and note. Missing on orders saved before this was
   *  added (read them with orderLines() from the catering helpers, which falls back to the text). */
  lines?: OrderLine[];
  notes?: string;
  /** 'cancelled': the customer called it off. Hidden from the kitchen and the totals; deposits stay in Payments. */
  status: 'open' | 'completed' | 'cancelled';
  completedAt?: number | null;
  /** When it was cancelled (store time); null after it is reopened. */
  cancelledAt?: number | null;
  /** Soft delete: set when deleted in the app, which then hides the order everywhere. Orders are never
   *  removed from the database by the app. null or missing: not deleted. */
  deletedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  /** Every saved edit, oldest first (the last 50 are kept). */
  history?: OrderEdit[];
}

/** One item of a catering order. */
export interface OrderLine {
  /** The Toast menu item's id when the dish was picked from the menu; null for a dish typed in. */
  dishId: string | null;
  /** "Chicken Dum Biryani": the menu name, or what was typed. */
  name: string;
  /** How many, or null when not given. */
  qty: number | null;
  /** "Full tray", "Pieces", ... (see UNITS in the catering helpers), any other unit as typed, or ''. */
  unit: string;
  /** "extra spicy", "no onion", or ''. */
  note: string;
  /** The line exactly as it was typed, kept on orders made before items were structured (and on lines not
   *  edited since), so the text people already saw doesn't change. Left out otherwise. */
  text?: string;
  /** true when the line was read by a guess (an old order, a scan or a paste) and nobody has checked it yet. */
  check?: boolean;
  /** Set on an extra (raita with a biryani, ...) added by the auto-extras rules: the extra's name, which
   *  finds the row again when the dishes change. Missing on dish rows. */
  extra?: string;
  /** true once someone changed the extra's amount or name: it then stays as they left it. */
  extraEdited?: boolean;
}

/**
 * What the customer pays for a catering order, for the manager app only. Kept in its own collection
 * (orderAmounts/{order id}), not on the order, so the kitchen tablet never loads it: the kitchen reads
 * and edits `orders` only, and its edits can't change or drop the amount.
 */
export interface OrderAmount {
  /** US dollars, e.g. 200 or 1250.5. null when cleared. */
  amount: number | null;
  /** Whether the customer has paid in full. Missing on amounts saved before this was added: treat as not paid.
   *  false marks an order still waiting for money, so the 'notPaid' look-up finds it however old; null (also not
   *  paid in full) takes it out of that look-up: cancelled or deleted orders, and orders deposits paid off. */
  paid?: boolean | null;
  /** When it was marked paid (store time). null or missing while not paid. */
  paidAt?: number | null;
  /** How the customer paid the rest. null or missing while not paid (and on older paid orders). */
  method?: PayMethod | null;
  /** Staff name of who took the payment, from the Staff tab. null or missing while not paid. */
  takenBy?: string | null;
  /** Part payments (advances) taken before the order is paid in full, oldest first. Missing when none. */
  deposits?: Deposit[];
  /** Every money action, oldest first. Add-only: entries are never changed or removed. Missing on older docs. */
  log?: PayEvent[];
  /** The order's `items` text when the amount was set or last confirmed, to warn when the items change
   *  later. null or missing: no check (older orders). */
  itemsAt?: string | null;
  /** On a cancelled order: what happened to the money, e.g. "Refunded $200 deposit by Zelle" (<= 500 chars). */
  refundNote?: string | null;
  updatedAt: number;
}

/** One money action on a catering order, kept in orderAmounts.log (add-only). */
export interface PayEvent {
  kind: 'amount' | 'deposit' | 'depositRemoved' | 'paid' | 'unpaid' | 'cancelled' | 'refund';
  amount: number | null;
  method: PayMethod | null;
  takenBy: string | null;
  at: number;
  note?: string;
}

export type PayMethod = 'cash' | 'card' | 'zelle' | 'check';

/** A part payment (advance) on a catering order. Manager only, kept in orderAmounts. */
export interface Deposit {
  /** US dollars, more than 0. */
  amount: number;
  method: PayMethod;
  /** Staff name of who took it. */
  takenBy: string;
  /** When it was recorded (store time). */
  at: number;
}

/**
 * A catering price estimate (quote) made with a customer before they confirm. Front and manager apps only:
 * the kitchen never loads this collection. Once the customer agrees, "Make order" turns it into a real
 * catering order and the estimate is kept, marked `ordered`, with the new order's id.
 */
export interface CateringEstimate {
  customerName: string;
  /** '' when not given. */
  phone: string;
  /** When the customer wants it, if known (ms since epoch); null when not decided yet. */
  dueAt: number | null;
  type: 'pickup' | 'delivery';
  /** '' unless delivery. */
  address: string;
  people: number | null;
  lines: EstimateLine[];
  /** US dollars off the subtotal; null when none. */
  discount: number | null;
  /** US dollars; null when none. */
  deliveryFee: number | null;
  /** Sales tax in percent, as it was when the estimate was saved (0 = no tax). */
  taxPercent: number;
  /** What the customer pays, as worked out when saved. */
  total: number;
  notes: string;
  status: 'open' | 'ordered';
  /** The catering order made from it, once ordered. */
  orderId: string | null;
  /** Soft delete: set when deleted in the app, which then hides it everywhere. null or missing: not deleted. */
  deletedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

/** One item of an estimate: an order line with its price. */
export interface EstimateLine extends OrderLine {
  /** What this line costs in US dollars (all of it, not each). 0 for a free extra; null when not priced. */
  price: number | null;
  /** true when someone typed the price; otherwise it came from the price list. */
  priceSet?: boolean;
}

/**
 * The catering price list (singleton `cateringPrices`), edited in the manager app under ☰ More.
 * Missing: the app uses its built-in starting prices (see prices.ts in the catering folder).
 */
export interface CateringPrices {
  /** Full-tray price per dish, by the dish's plain name key (letters and digits, lower case). Half tray = half. */
  trays: Record<string, number>;
  /** Full-tray price for a dish with no price of its own, by kind of dish (chicken includes paneer and egg;
   *  meat is goat, lamb and fish). Pieces (samosa, kebab, tikki) are priced by hand for now. */
  defaults: { veg: number; chicken: number; meat: number };
  /** Sales tax in percent; 0 = no tax line. */
  taxPercent: number;
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
  /** Older server versions: one entry per item as text. */
  items?: string[];
  /** One entry per item. `qty` is digits or ''. `unsure` when the line was hard to read. */
  lines?: { dish: string; qty: string; unit: string; note: string; unsure: boolean }[];
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
  /** No longer used (the manager PIN was removed when the front app got its own link). Left so old data still reads. */
  managerPin?: string;
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
  groups?: { id: string; name: string; items: { id: string; name: string; description?: string; price?: number | null; soldOut?: boolean }[] }[];
  changedAt?: number;
}

/** Which app a device opened (shown in More > Devices). */
export type DeviceApp = ScreenId | 'front' | 'manager' | 'home' | 'other';

/** One approved device (devices/{sign-in id}). Saved only by the server. */
export interface DeviceRecord {
  id: string;
  app: DeviceApp;
  /** From the browser, e.g. "iPhone", "Fire TV", "Android tablet". */
  model: string;
  /** Typed in More > Devices; null shows a name made from `app`. */
  name: string | null;
  /** 'open': added by itself before the app was locked. 'code': the restaurant code was entered. */
  how: 'open' | 'code';
  approvedAt: number;
  lastSeen: number;
  /** A manager phone: only these may change the code, lock, rename or remove devices (once one is marked). */
  manager?: boolean;
}

/** access/info: shown in More > Devices. Missing means open and no code set. */
export interface AccessInfo {
  locked?: boolean;
  lockedAt?: number | null;
  codeSetAt?: number | null;
  updatedAt?: number;
}

/** This device: 'checking' until known (and while offline with no answer yet; screens show as usual),
 *  'ok' (approved, or the app isn't locked), 'needs-code' (locked and this device isn't approved). */
export type DeviceAccess = 'checking' | 'ok' | 'needs-code';

/** More > Devices actions (approved devices only). */
export type DeviceAction =
  | { action: 'setCode'; code: string }
  | { action: 'lock' }
  | { action: 'unlock' }
  | { action: 'rename'; uid: string; name: string }
  | { action: 'remove'; uid: string }
  | { action: 'setManager'; uid: string; manager: boolean };

/** Single documents, by id. Use useSingleton / saveSingleton from @shared/data. */
export interface Singletons {
  music: MusicSettings;
  settings: AppSettings;
  staffConfig: StaffConfig;
  loop: LoopAnchor;
  seeded: { at: number };
  cateringPrices: CateringPrices;
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
  /** Catering price estimates (front and manager apps). Never read it from the kitchen. */
  estimates: CateringEstimate;
  /** Single documents: use useSingleton / saveSingleton rather than this collection directly. */
  singletons: Singletons[SingletonId];
  staffWeeks: StaffWeek;
  /** One doc per screen id: when it last reported in. Kept apart from `screens` so a
   *  heartbeat doesn't wake every TV's listener (Firestore free-plan read limits). */
  heartbeats: { lastSeen: number };
  /** Read only (the server writes it): use useDoc('toastMenu', 'current'). */
  toastMenu: ToastMenu;
  /** Approved devices, by sign-in id. Read only: change them with store.manageDevices. */
  devices: DeviceRecord;
  /** Read only: only access/info is readable (locked or open, when the code was set). */
  access: AccessInfo;
}
export type CollectionName = keyof Collections;
