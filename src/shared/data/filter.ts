// Narrower live lists, so an always-on screen doesn't download every order ever saved.
// One named filter for now; both stores use the same rule (FirebaseStore as a Firestore query,
// LocalStore by filtering in the browser).

/** 'openOrRecent': orders still open (whatever their date) plus every order due in the last RECENT_DAYS
 *  days or later. Used by the kitchen tablet, which never shows old history. */
export type CollectionFilter = 'openOrRecent';

export const RECENT_DAYS = 60;

/** Orders due at or after this time are kept by 'openOrRecent'. Taken once when the list starts listening. */
export function recentSince(now: number): number {
  return now - RECENT_DAYS * 24 * 60 * 60_000;
}

/** Whether a document belongs in the filtered list (the same rule as the Firestore query). */
export function matchesFilter(doc: object, filter: CollectionFilter, since: number): boolean {
  if (filter !== 'openOrRecent') return true;
  const d = doc as { status?: unknown; dueAt?: unknown };
  return d.status === 'open' || (typeof d.dueAt === 'number' && d.dueAt >= since);
}
