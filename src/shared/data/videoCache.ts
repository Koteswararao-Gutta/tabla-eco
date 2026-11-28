// The app's own offline copy of ad videos uploaded from the phone (FirebaseStore). The database keeps its own
// copy too, but that one can be pushed out when it fills up; this one keeps a TV's ads playing after a restart
// without internet. Only the few most recently saved videos are kept here. Never throws: without it, the video
// is read from the database again.

const DB = 'tabla-videos';
const STORE = 'videos';
/** How many videos a device keeps (a TV plays one side of one or two ads). */
const KEEP = 4;

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    opening.catch(() => (opening = null));
  }
  return opening;
}

interface Entry {
  blob: Blob;
  at: number;
}

export async function cachedVideo(id: string): Promise<Blob | null> {
  try {
    const d = await db();
    const e = await new Promise<Entry | undefined>((resolve, reject) => {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      r.onsuccess = () => resolve(r.result as Entry | undefined);
      r.onerror = () => reject(r.error);
    });
    return e?.blob && e.blob.size ? e.blob : null;
  } catch {
    return null;
  }
}

export async function keepVideo(id: string, blob: Blob): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      st.put({ blob, at: Date.now() } satisfies Entry, id);
      // Keep only the newest few.
      const all = st.openCursor();
      const seen: { key: IDBValidKey; at: number }[] = [];
      all.onsuccess = () => {
        const c = all.result;
        if (c) {
          seen.push({ key: c.key, at: (c.value as Entry).at ?? 0 });
          c.continue();
        } else {
          seen.sort((a, b) => b.at - a.at);
          for (const old of seen.slice(KEEP)) if (old.key !== id) st.delete(old.key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* no offline copy: read from the database next time */
  }
}
