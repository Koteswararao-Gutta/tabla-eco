// Sample (test) catering orders for trying the app. Runs only from .github/workflows/sample-orders.yml
// on its own branch (needs the service account). Never merge.
// mode.json "mode":
//   insert - adds the 10 orders in orders.mjs (and their orderAmounts). Never overwrites: an existing id is skipped.
//   delete - deletes every order with sample: true whose id starts "sample-" and name starts "TEST", and its orderAmounts.
//   list   - read only: prints the sample orders now in the database.
import { readFileSync } from 'node:fs';
import { SAMPLES } from './orders.mjs';

const UNIT = { 'Full tray': ['Full tray', 'Full trays'], 'Half tray': ['Half tray', 'Half trays'], Pieces: ['piece', 'pieces'], Lbs: ['lb', 'lbs'], Quarts: ['quart', 'quarts'], Gallons: ['gallon', 'gallons'] };
const qtyText = (l) => { const u = UNIT[l.unit]; return `${l.qty} ${u ? (l.qty === 1 ? u[0] : u[1]) : l.unit}`; };
const lineText = (l) => `${l.name}, ${qtyText(l)}${l.note ? ` (${l.note})` : ''}`;
// Phoenix is UTC-7 all year.
const phoenix = (date, time) => Date.parse(`${date}T${time}:00-07:00`);
const isSample = (id, o) => id.startsWith('sample-') && o.sample === true && String(o.customerName).startsWith('TEST');

export function build(now, staff) {
  return SAMPLES.map((s) => {
    const id = `sample-${s.date}-${s.slug}-${s.time.replace(':', '')}`;
    const dueAt = phoenix(s.date, s.time);
    const order = {
      id, sample: true, customerName: s.name, phone: s.phone, dueAt, type: s.type, people: s.people ?? null,
      ...(s.address ? { address: s.address } : {}),
      items: s.lines.map(lineText).join('\n'), lines: s.lines,
      notes: ['TEST ORDER for trying the app. Delete later.', s.notes].filter(Boolean).join(' '),
      status: s.completed ? 'completed' : 'open', completedAt: s.completed ? dueAt : null,
      createdAt: now, updatedAt: now, history: [],
    };
    const m = s.money;
    const amount = m && {
      id, amount: m.amount, paid: !!m.paid, paidAt: m.paid ? now : null, method: m.paid || null, takenBy: m.paid ? staff[0] : null,
      deposits: (m.deposits ?? []).map(([a, method], i) => ({ amount: a, method, takenBy: staff[(i + 1) % staff.length], at: now })),
      updatedAt: now,
    };
    return { id, order, amount };
  });
}

async function main() {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const mode = JSON.parse(readFileSync(new URL('mode.json', import.meta.url), 'utf8')).mode;
  initializeApp({ credential: cert(JSON.parse(process.env.SA)), projectId: 'tabla-eco-2e94b' });
  const db = getFirestore();
  if (mode === 'insert') {
    const cfg = (await db.doc('singletons/staffConfig').get()).data();
    const staff = (cfg?.people ?? []).filter((p) => p?.active !== false && typeof p?.name === 'string' && p.name.trim()).map((p) => p.name.trim());
    if (!staff.length) staff.push('Manager');
    console.log(`staff names used for "taken by": ${staff.slice(0, 2).join(', ')}`);
    for (const { id, order, amount } of build(Date.now(), staff)) {
      const ref = db.doc(`orders/${id}`), aRef = db.doc(`orderAmounts/${id}`);
      const res = await db.runTransaction(async (tx) => {
        const [o, a] = await Promise.all([tx.get(ref), tx.get(aRef)]);
        if (o.exists || a.exists) return 'exists, skipped';
        tx.create(ref, order);
        if (amount) tx.create(aRef, amount);
        return 'added';
      });
      console.log(`${res} ${id} | ${order.customerName} | ${new Date(order.dueAt).toISOString()} | ${order.status} | ${amount ? `$${amount.amount} paid=${amount.paid} deposits=${amount.deposits.length}` : 'no amount'}`);
    }
  } else if (mode === 'delete' || mode === 'list') {
    const snap = await db.collection('orders').where('sample', '==', true).get();
    let n = 0;
    for (const d of snap.docs) {
      if (!isSample(d.id, d.data())) { console.log(`not a sample, left alone: ${d.id}`); continue; }
      n++;
      if (mode === 'delete') { await db.doc(`orders/${d.id}`).delete(); await db.doc(`orderAmounts/${d.id}`).delete(); }
      console.log(`${mode === 'delete' ? 'deleted' : 'found'} ${d.id} | ${d.get('customerName')}`);
    }
    console.log(`${mode === 'delete' ? 'deleted' : 'found'} ${n} sample orders`);
  } else throw new Error(`unknown mode ${mode}`);
}

if (process.env.SA) await main();
