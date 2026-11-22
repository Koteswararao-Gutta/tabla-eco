// Kept apart from LazyScreen.tsx (no store import) so it is easy to test.

/** True for the errors browsers give when a lazily loaded file can't be fetched. */
export function isChunkLoadError(e: unknown): boolean {
  const msg = String((e as { message?: unknown } | null)?.message ?? e ?? '');
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(msg);
}
