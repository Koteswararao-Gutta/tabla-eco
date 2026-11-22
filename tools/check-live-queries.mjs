// After a deploy: runs the app's list queries against the live Firestore (read only, 1 document each) and
// fails if Firestore refuses one for a missing index. The local tests can't catch that: the emulator and
// LocalStore never ask for indexes. Keep these in step with the filters in src/shared/data/filter.ts.
// Needs GOOGLE_APPLICATION_CREDENTIALS and firebase-admin from functions/node_modules.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Filter, FieldPath } = require('firebase-admin/firestore');

initializeApp({ projectId: process.env.PROJECT || 'tabla-eco-2e94b' });
const db = getFirestore();
const now = Date.now();
const since = now - 60 * 24 * 3600_000;
const openOr = (field) => Filter.or(Filter.where('status', '==', 'open'), Filter.where(field, '>=', since));

const QUERIES = {
  "orders 'openOrRecent'": () => db.collection('orders').where(openOr('dueAt')),
  "estimates 'openOrRecentlyUpdated'": () => db.collection('estimates').where(openOr('updatedAt')),
  "orderAmounts 'notPaid'": () => db.collection('orderAmounts').where('paid', '==', false),
  'orders { dueFrom, dueTo }': () => db.collection('orders').where('dueAt', '>=', since).where('dueAt', '<', now),
  'orders { ids }': () => db.collection('orders').where(FieldPath.documentId(), 'in', ['none']),
};

let failed = 0;
for (const [name, q] of Object.entries(QUERIES)) {
  // A new index can take a few minutes to build after the deploy: wait for it (up to 15 minutes).
  for (let i = 0; ; i++) {
    try {
      await q().limit(1).get();
      console.log(`ok: ${name}`);
      break;
    } catch (e) {
      const building = e.code === 9 && /currently building/i.test(String(e.details ?? e.message));
      if (building && i < 30) { console.log(`${name}: index still building, waiting 30 s`); await new Promise((r) => setTimeout(r, 30_000)); continue; }
      failed++;
      console.log(`::error::${name}: Firestore refused the query. ${e.code === 9 ? 'Add the index to firestore.indexes.json. ' : ''}${e.details ?? e.message}`);
      break;
    }
  }
}
process.exit(failed ? 1 : 0);
