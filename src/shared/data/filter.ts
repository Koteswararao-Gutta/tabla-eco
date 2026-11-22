// Narrower live lists, so a phone or an always-on screen doesn't download every order ever saved.
// Both stores use the same rule: FirebaseStore as a Firestore query, LocalStore by filtering in the browser
// with matchesFilter. The two "open or recent" queries (status == 'open' OR a date >= since) need the composite
// indexes in firestore.indexes.json (status + dueAt on orders, status + updatedAt on estimates); without them
// Firestore refuses the query and the kitchen and catering lists get no new orders. The others use one-field indexes.

/**
 * - 'openOrRecent': documents still open (`status` 'open', whatever their date) plus every one due
 *   (`dueAt`) in the last RECENT_DAYS days or later. Orders: the kitchen tablet and the catering list.
 * - 'openOrRecentlyUpdated': the same with `updatedAt` instead of `dueAt` (estimates, whose date can be empty).
 * - 'notPaid': documents whose `paid` is exactly false (orderAmounts: unpaid orders, however old).
 * - { dueFrom, dueTo }: documents with dueFrom <= dueAt < dueTo (a day, a week, older history, an export).
 * - { ids }: just these documents (e.g. the amounts of the orders on screen). Empty: nothing.
 */
export type CollectionFilter =
  | 'openOrRecent'
  | 'openOrRecentlyUpdated'
  | 'notPaid'
  | { dueFrom: number; dueTo: number }
  | { ids: string[] };

export const RECENT_DAYS = 60;

/** Firestore allows at most 30 values in one `in` query; longer id lists are asked in parts. */
export const IDS_PER_QUERY = 30;

/** Documents due (or updated) at or after this time are kept by the 'openOrRecent' filters. Taken once when the list starts listening. */
export function recentSince(now: number): number {
  return now - RECENT_DAYS * 24 * 60 * 60_000;
}

/** Whether a document belongs in the filtered list (the same rule as the Firestore query). */
export function matchesFilter(doc: object, filter: CollectionFilter, since: number, id?: string): boolean {
  const d = doc as { status?: unknown; dueAt?: unknown; updatedAt?: unknown; paid?: unknown; id?: unknown };
  if (filter === 'openOrRecent') return d.status === 'open' || (typeof d.dueAt === 'number' && d.dueAt >= since);
  if (filter === 'openOrRecentlyUpdated') return d.status === 'open' || (typeof d.updatedAt === 'number' && d.updatedAt >= since);
  if (filter === 'notPaid') return d.paid === false;
  if ('ids' in filter) return filter.ids.includes(id ?? (typeof d.id === 'string' ? d.id : ''));
  return typeof d.dueAt === 'number' && d.dueAt >= filter.dueFrom && d.dueAt < filter.dueTo;
}

/** A filter as a short text, the same for the same filter (ids in any order), for React effect keys and logs. */
export function filterKey(filter: CollectionFilter | undefined): string {
  if (!filter) return '';
  if (typeof filter === 'string') return filter;
  if ('ids' in filter) return 'ids:' + [...new Set(filter.ids)].sort().join(',');
  return `due:${filter.dueFrom}-${filter.dueTo}`;
}

/** The ids of an { ids } filter in parts of at most IDS_PER_QUERY, once each, sorted. */
export function idChunks(ids: string[]): string[][] {
  const all = [...new Set(ids)].filter(Boolean).sort();
  const out: string[][] = [];
  for (let i = 0; i < all.length; i += IDS_PER_QUERY) out.push(all.slice(i, i + IDS_PER_QUERY));
  return out;
}
