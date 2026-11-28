// One-off (asked for by the owner 2026-11-28): swaps the live catering ad for the new 30 s pair.
// TV 1 (left) plays ads/catering-left-2.mp4 with sound, TV 2 (right) ads/catering-right-2.mp4 muted (it has no
// sound); TV 3 / TV 4 mirror them. Adds two NEW picture records (a still of each video's last frame, shown
// while the video loads, if it can't play, and on TVs still on older code), then points the existing ad spot
// at them and sets its seconds to the new length. The old ad's records are kept. Deletes nothing.
// Running it again changes nothing new.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const here = new URL('.', import.meta.url).pathname;
initializeApp({ credential: cert(JSON.parse(process.env.SA)) });
const db = getFirestore();

const SECONDS = 31; // the videos are 30.3 s; never cut them
const PICS = [
  { id: 'ad-catering-left-2', file: 'poster-left-2.jpg', name: 'Catering ad 2 (left, video with sound)', video: { src: 'ads/catering-left-2.mp4', sound: true, seconds: 30.3 } },
  { id: 'ad-catering-right-2', file: 'poster-right-2.jpg', name: 'Catering ad 2 (right, video)', video: { src: 'ads/catering-right-2.mp4', sound: false, seconds: 30.3 } },
];
const SLOT_ID = 'ad-catering-1';

const slot = await db.doc('slots/' + SLOT_ID).get();
if (!slot.exists) throw new Error('The ad spot ' + SLOT_ID + ' is missing; nothing changed.');
console.log('Ad spot now:', JSON.stringify(slot.data()));
const now = Date.now();

for (const p of PICS) {
  const bytes = readFileSync(here + p.file);
  await db.doc('pictureData/' + p.id).set({ type: 'image/jpeg', data: bytes.toString('base64') });
  await db.doc('pictures/' + p.id).set({ id: p.id, name: p.name, width: 1920, height: 1080, createdAt: now, video: p.video });
  console.log('Picture saved:', p.id, bytes.length, 'bytes');
}
await db.doc('slots/' + SLOT_ID).update({ seconds: SECONDS, 'pictures.tv1': PICS[0].id, 'pictures.tv2': PICS[1].id });
console.log('Ad spot updated:', SLOT_ID, SECONDS, 's');

// Every TV starts the new loop together, from the first menu picture (as the manager app does after a change).
const slots = (await db.collection('slots').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const first = slots.filter((s) => s.id !== SLOT_ID && typeof s.order === 'number' && (s.kind ?? 'menu') !== 'catering').sort((a, b) => a.order - b.order)[0];
await db.doc('singletons/loop').set({ anchor: Date.now(), firstSlotId: first ? first.id : null });
console.log('Loop restarted from', first ? first.id : 'the top', '- done.');
