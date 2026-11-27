// One-off: TV 1 has 2 menus and TV 2 has 3, so in spot 3 TV 1 showed only the Tabla name.
// Gives TV 1 its first menu (Breads + Biryanis) in that spot, only if the spot still has no TV 1 picture.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: cert(JSON.parse(process.env.SA)) });
const db = getFirestore();
const slots = (await db.collection('slots').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
console.log('Slots now:', JSON.stringify(slots.map((s) => ({ id: s.id, order: s.order, seconds: s.seconds, pictures: s.pictures }))));
const spot = slots.find((s) => s.id === 'menu-3');
if (!spot) console.log('menu-3 is gone; nothing to do.');
else if (spot.pictures?.tv1) console.log('menu-3 already has a TV 1 picture:', spot.pictures.tv1);
else {
  await db.doc('slots/menu-3').update({ 'pictures.tv1': 'menu-breads-biryani' });
  console.log('menu-3: TV 1 now shows menu-breads-biryani.');
}
