// One-off: import past catering orders from the WhatsApp export into Firestore.
// Runs only from .github/workflows/whatsapp-import.yml on its own branch (needs the service account).
// Modes (tools/whatsapp-import/mode.json):
//   inspect  - read only: prints the Toast menu and every order now in the database.
//   import   - adds orders.json. Never overwrites: an id that already exists is skipped.
//   delete   - deletes exactly the order ids listed in mode.json "deleteIds" (and their orderAmounts).
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const here = new URL('.', import.meta.url);
const mode = JSON.parse(readFileSync(new URL('mode.json', here), 'utf8'));
initializeApp({ credential: cert(JSON.parse(process.env.SA)), projectId: 'tabla-eco-2e94b' });
const db = getFirestore();
const out = (name, data) => writeFileSync(`out/${name}`, JSON.stringify(data, null, 1));

async function inspect() {
  const menu = (await db.doc('toastMenu/current').get()).data() ?? null;
  out('menu.json', menu);
  const orders = (await db.collection('orders').get()).docs.map((d) => {
    const o = d.data();
    return { id: d.id, customerName: o.customerName, phone: o.phone, status: o.status, dueAt: o.dueAt, due: new Date(o.dueAt).toISOString(), createdAt: o.createdAt, items: o.items };
  });
  const amounts = (await db.collection('orderAmounts').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  out('orders.json', orders);
  out('amounts.json', amounts);
  console.log(`menu groups: ${menu?.groups?.length ?? 0}, items: ${menu?.groups?.reduce((n, g) => n + g.items.length, 0) ?? 0}`);
  console.log(`orders: ${orders.length}, orderAmounts: ${amounts.length}`);
  for (const g of menu?.groups ?? []) for (const i of g.items) console.log(`MENU ${g.name} | ${i.id} | ${i.name} | ${i.price ?? ''}`);
  for (const a of amounts) console.log(`AMOUNT ${JSON.stringify(a)}`);
  for (const o of orders.sort((a, b) => a.dueAt - b.dueAt)) console.log(`${o.id} | ${o.due} | ${o.status} | ${o.customerName} | ${o.phone} | ${String(o.items).split('\n')[0]}`);
}

async function importOrders() {
  const list = JSON.parse(readFileSync(new URL('orders.json', here), 'utf8'));
  let added = 0, skipped = 0;
  for (const { id, order, amount } of list) {
    const ref = db.collection('orders').doc(id);
    const res = await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return false;
      tx.create(ref, { ...order, id });
      if (amount) tx.create(db.collection('orderAmounts').doc(id), { ...amount, id });
      return true;
    });
    res ? added++ : skipped++;
    console.log(`${res ? 'added  ' : 'exists '} ${id} | ${order.customerName}`);
  }
  console.log(`added ${added}, skipped (already there) ${skipped}`);
}

async function del() {
  const ids = mode.deleteIds ?? [];
  for (const id of ids) {
    const snap = await db.doc(`orders/${id}`).get();
    if (!snap.exists) { console.log(`missing ${id}`); continue; }
    if (mode.expectNames && mode.expectNames[id] !== snap.get('customerName')) { console.log(`name mismatch, not deleted: ${id}`); continue; }
    await db.doc(`orders/${id}`).delete();
    await db.doc(`orderAmounts/${id}`).delete();
    console.log(`deleted ${id} | ${snap.get('customerName')}`);
  }
}

if (mode.mode === 'inspect') await inspect();
else if (mode.mode === 'import') await importOrders();
else if (mode.mode === 'delete') await del();
else throw new Error(`unknown mode ${mode.mode}`);
