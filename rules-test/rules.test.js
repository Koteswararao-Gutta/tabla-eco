// Checks firestore.rules on the Firestore emulator. Run with `npm test --prefix rules-test` (needs Java 21);
// CI runs it before the rules can go live (.github/workflows/test.yml and functions.yml).
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, setLogLevel, updateDoc } from 'firebase/firestore';

setLogLevel('silent'); // refused writes are expected here; keep the output readable

let env;
let db; // a signed-in device (anonymous sign-in, like every Tabla screen)
let nobody; // not signed in

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-tabla-rules',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  db = env.authenticatedContext('device-1').firestore();
  nobody = env.unauthenticatedContext().firestore();
});

/** Writes a document as the server would (rules skipped). */
const seed = (path, data) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));

const order = { id: 'o1', customerName: 'Priya', dueAt: 1_800_000_000_000, status: 'open', items: '2 trays biryani', type: 'pickup' };
const amount = { id: 'o1', amount: 300, paid: false, deposits: [], updatedAt: 1 };
const estimate = { id: 'e1', customerName: 'Priya', status: 'open', lines: [], total: 0, updatedAt: 1 };
const pay = (kind, at, extra = {}) => ({ kind, amount: 100, method: 'cash', takenBy: 'Ravi', at, ...extra });

// ---------- orders ----------

test('orders: create and update an order', async () => {
  await assertSucceeds(setDoc(doc(db, 'orders/o1'), order));
  await assertSucceeds(updateDoc(doc(db, 'orders/o1'), { items: '3 trays biryani' }));
  await assertSucceeds(getDoc(doc(db, 'orders/o1')));
});

test('orders: a new order needs its main fields, and nobody signed out can save', async () => {
  const { items, ...noItems } = order;
  await assertFails(setDoc(doc(db, 'orders/o1'), noItems));
  await assertFails(setDoc(doc(nobody, 'orders/o1'), order));
  await assertFails(getDoc(doc(nobody, 'orders/o1')));
});

test('orders: cancelled status with cancelledAt, undo cancel, soft delete', async () => {
  await seed('orders/o1', order);
  await assertSucceeds(updateDoc(doc(db, 'orders/o1'), { status: 'cancelled', cancelledAt: 5 }));
  await assertSucceeds(updateDoc(doc(db, 'orders/o1'), { status: 'open', cancelledAt: null }));
  await assertSucceeds(updateDoc(doc(db, 'orders/o1'), { deletedAt: 9 }));
  await assertSucceeds(updateDoc(doc(db, 'orders/o1'), { deletedAt: null }));
  await assertFails(updateDoc(doc(db, 'orders/o1'), { status: 'gone' }));
  await assertFails(updateDoc(doc(db, 'orders/o1'), { cancelledAt: 'yesterday' }));
  await assertFails(updateDoc(doc(db, 'orders/o1'), { deletedAt: true }));
});

test('client delete is refused on orders, orderAmounts and estimates', async () => {
  await seed('orders/o1', order);
  await seed('orderAmounts/o1', amount);
  await seed('estimates/e1', estimate);
  await assertFails(deleteDoc(doc(db, 'orders/o1')));
  await assertFails(deleteDoc(doc(db, 'orderAmounts/o1')));
  await assertFails(deleteDoc(doc(db, 'estimates/e1')));
});

// ---------- orderAmounts ----------

test('orderAmounts: log, itemsAt and refundNote can be saved', async () => {
  await assertSucceeds(
    setDoc(doc(db, 'orderAmounts/o1'), { ...amount, log: [pay('amount', 1)], itemsAt: '2 trays biryani', refundNote: null }),
  );
  await assertSucceeds(updateDoc(doc(db, 'orderAmounts/o1'), { refundNote: 'Refunded $200 deposit by Zelle', updatedAt: 2 }));
  await assertFails(updateDoc(doc(db, 'orderAmounts/o1'), { refundNote: 'x'.repeat(501), updatedAt: 3 }));
  await assertFails(updateDoc(doc(db, 'orderAmounts/o1'), { itemsAt: 7, updatedAt: 3 }));
});

test('orderAmounts: an unknown field is refused', async () => {
  await assertFails(setDoc(doc(db, 'orderAmounts/o1'), { ...amount, tip: 20 }));
});

test('orderAmounts: the log is add-only', async () => {
  const a = pay('amount', 1);
  const b = pay('deposit', 2);
  await seed('orderAmounts/o1', { ...amount, log: [a, b] });
  const ref = doc(db, 'orderAmounts/o1');
  // appending is fine
  await assertSucceeds(updateDoc(ref, { log: [a, b, pay('paid', 3)], updatedAt: 3 }));
  // shortening, rewriting an old entry, reordering or dropping the log is not
  await assertFails(updateDoc(ref, { log: [a, b], updatedAt: 4 }));
  await assertFails(updateDoc(ref, { log: [a, { ...b, amount: 999 }, pay('paid', 3)], updatedAt: 4 }));
  await assertFails(updateDoc(ref, { log: [b, a, pay('paid', 3)], updatedAt: 4 }));
  await assertFails(updateDoc(ref, { log: [], updatedAt: 4 }));
  await assertFails(setDoc(ref, { ...amount, updatedAt: 4 })); // a full save without the log
  // other fields can still change while the log stays
  await assertSucceeds(updateDoc(ref, { paid: true, updatedAt: 5 }));
});

test('orderAmounts: a log over 500 entries is refused', async () => {
  const log = Array.from({ length: 501 }, (_, i) => pay('amount', i));
  await assertFails(setDoc(doc(db, 'orderAmounts/o1'), { ...amount, log }));
});

test('orderAmounts: paid can be null (out of the unpaid look-up), never another kind of value', async () => {
  await seed('orderAmounts/o1', amount);
  await assertSucceeds(updateDoc(doc(db, 'orderAmounts/o1'), { paid: null, updatedAt: 2 }));
  await assertFails(updateDoc(doc(db, 'orderAmounts/o1'), { paid: 'no', updatedAt: 3 }));
});

test('orderAmounts: an old amount without a log can start one', async () => {
  await seed('orderAmounts/o1', amount);
  await assertSucceeds(updateDoc(doc(db, 'orderAmounts/o1'), { log: [pay('paid', 3)], updatedAt: 3 }));
});

// ---------- estimates ----------

test('estimates: soft delete with deletedAt', async () => {
  await assertSucceeds(setDoc(doc(db, 'estimates/e1'), estimate));
  await assertSucceeds(updateDoc(doc(db, 'estimates/e1'), { deletedAt: 9, updatedAt: 2 }));
  await assertFails(updateDoc(doc(db, 'estimates/e1'), { deletedAt: 'now', updatedAt: 3 }));
  await assertFails(updateDoc(doc(db, 'estimates/e1'), { status: 'cancelled', updatedAt: 3 }));
});

// ---------- server-only collections ----------

test('pushTokens: a device can save its own token, but nobody can read the list', async () => {
  await assertSucceeds(setDoc(doc(db, 'pushTokens/p1'), { token: 'abc', device: 'Manager phone', updatedAt: 1 }));
  await assertFails(getDoc(doc(db, 'pushTokens/p1')));
  await assertFails(setDoc(doc(db, 'pushTokens/p2'), { token: 'abc', device: 'x', updatedAt: 1, extra: 1 }));
});

test('toastMenu: screens can read it, only the server writes it', async () => {
  await seed('toastMenu/current', { hash: 'h' });
  await assertSucceeds(getDoc(doc(db, 'toastMenu/current')));
  await assertFails(setDoc(doc(db, 'toastMenu/current'), { hash: 'x' }));
  await assertFails(deleteDoc(doc(db, 'toastMenu/current')));
});

test('unknown collections are closed', async () => {
  await assertFails(setDoc(doc(db, 'secrets/x'), { a: 1 }));
  await assertFails(getDoc(doc(db, 'usage/2026-11-21')));
});
