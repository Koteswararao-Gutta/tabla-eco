// One-off (approved by the owner 2026-11-27): adds the catering ad videos to the menu loop as one 15-second spot.
// TV 1 (left) plays ads/catering-left-1.mp4 with sound, TV 2 (right) ads/catering-right-1.mp4 muted;
// TV 3 / TV 4 mirror them. Each video gets a picture record (a still of its last frame) that TVs show while
// the video loads, if it can't play, and on TVs still running the code from before videos.
// Writes the same records the manager app writes, so the spot can be moved, timed or removed in
// Manager > Screens. Fixed ids: running it again changes nothing new. Deletes nothing.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const here = new URL('.', import.meta.url).pathname;
initializeApp({ credential: cert(JSON.parse(process.env.SA)) });
const db = getFirestore();

const PICS = [
  { id: 'ad-catering-left-1', file: 'poster-left.jpg', name: 'Catering ad (left, video with sound)', video: { src: 'ads/catering-left-1.mp4', sound: true } },
  { id: 'ad-catering-right-1', file: 'poster-right.jpg', name: 'Catering ad (right, video)', video: { src: 'ads/catering-right-1.mp4', sound: false } },
];
const SLOT_ID = 'ad-catering-1';

const slots = (await db.collection('slots').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
console.log('Slots now:', JSON.stringify(slots.map((s) => ({ id: s.id, order: s.order, seconds: s.seconds, kind: s.kind, pictures: s.pictures }))));
const now = Date.now();

for (const p of PICS) {
  const bytes = readFileSync(here + p.file);
  await db.doc('pictureData/' + p.id).set({ type: 'image/jpeg', data: bytes.toString('base64') });
  await db.doc('pictures/' + p.id).set({ id: p.id, name: p.name, width: 1920, height: 1080, createdAt: now, video: p.video });
  console.log('Picture saved:', p.id, bytes.length, 'bytes');
}
const existing = slots.find((s) => s.id === SLOT_ID);
const order = existing ? existing.order : Math.max(0, ...slots.map((s) => (typeof s.order === 'number' ? s.order : 0))) + 1;
await db.doc('slots/' + SLOT_ID).set({ id: SLOT_ID, order, seconds: 15, transition: 'fade', kind: 'catering', endsAt: null, pictures: { tv1: PICS[0].id, tv2: PICS[1].id } });
console.log('Slot saved:', SLOT_ID, 'order', order);

// Every TV starts the new loop together, from the first menu picture (as the manager app does after a change).
const first = slots.filter((s) => s.id !== SLOT_ID && typeof s.order === 'number').sort((a, b) => a.order - b.order)[0];
await db.doc('singletons/loop').set({ anchor: Date.now(), firstSlotId: first ? first.id : SLOT_ID });
console.log('Loop restarted from', first ? first.id : SLOT_ID, '- done.');
