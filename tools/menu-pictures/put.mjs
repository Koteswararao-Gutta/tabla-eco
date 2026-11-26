// One-off: puts the real menu pictures on the menu TVs in place of the sample slides.
// TV 1 (left): 1, 2. TV 2 (right): 3, 4, 5. TV 3 / TV 4 keep mirroring.
// Writes the same records the manager app writes (pictures + pictureData + slots), so the pictures
// can be changed later in Manager > Screens. Fixed ids: running it again changes nothing new.
// Removes only the sample slides from the first-load seed (and their pictures when nothing else uses them).
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const here = new URL('.', import.meta.url).pathname;
initializeApp({ credential: cert(JSON.parse(process.env.SA)) });
const db = getFirestore();
const dry = process.env.DRY === '1';

const PICS = [
  { id: 'menu-breads-biryani', file: '1-breads-biryani.jpg', name: 'Indian breads and biryanis' },
  { id: 'menu-indoasian-kids', file: '2-indoasian-kids.jpg', name: 'Indo Asian, desserts, kids and sides' },
  { id: 'menu-nonveg-tandoori', file: '3-nonveg-tandoori.jpg', name: 'Non-veg appetizers and tandoori' },
  { id: 'menu-entrees', file: '4-entrees.jpg', name: 'Veg and non-veg entrees' },
  { id: 'menu-veg-chaat', file: '5-veg-chaat.jpg', name: 'Veg appetizers and chaat' },
];
const SLOTS = [
  { id: 'menu-1', order: 1, pictures: { tv1: 'menu-breads-biryani', tv2: 'menu-nonveg-tandoori' } },
  { id: 'menu-2', order: 2, pictures: { tv1: 'menu-indoasian-kids', tv2: 'menu-entrees' } },
  { id: 'menu-3', order: 3, pictures: { tv2: 'menu-veg-chaat' } },
];
const SAMPLE_SLOTS = ['slot-menu-1', 'slot-menu-2', 'slot-special', 'slot-catering'];
const SAMPLE_PIC_NAMES = ['Left menu 1', 'Right menu 1', 'Left menu 2', 'Right menu 2', 'Weekend special', 'We do catering'];

const slots = (await db.collection('slots').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const pictures = (await db.collection('pictures').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const music = (await db.doc('singletons/music').get()).data() ?? {};
console.log('Slots now:', JSON.stringify(slots.map((s) => ({ id: s.id, order: s.order, kind: s.kind, pictures: s.pictures }))));
console.log('Pictures now:', JSON.stringify(pictures.map((p) => ({ id: p.id, name: p.name }))));
console.log('Screens:', JSON.stringify((await db.collection('screens').get()).docs.map((d) => ({ id: d.id, mirrorOf: d.data().mirrorOf ?? null }))));
const now = Date.now();

const removeSlots = slots.filter((s) => SAMPLE_SLOTS.includes(s.id));
const keptOther = slots.filter((s) => !SAMPLE_SLOTS.includes(s.id) && !SLOTS.some((n) => n.id === s.id));
if (keptOther.length) console.log('Leaving these slots alone (not samples):', keptOther.map((s) => s.id).join(', '));

if (!dry) {
  for (const p of PICS) {
    const bytes = readFileSync(here + p.file);
    await db.doc('pictureData/' + p.id).set({ type: 'image/jpeg', data: bytes.toString('base64') });
    await db.doc('pictures/' + p.id).set({ id: p.id, name: p.name, width: 1920, height: 1080, createdAt: now });
    console.log('Picture saved:', p.id, bytes.length, 'bytes');
  }
  for (const s of SLOTS) {
    await db.doc('slots/' + s.id).set({ id: s.id, order: s.order, seconds: 15, transition: 'fade', kind: 'menu', endsAt: null, pictures: s.pictures });
    console.log('Slot saved:', s.id);
  }
  for (const s of removeSlots) {
    await db.doc('slots/' + s.id).delete();
    console.log('Sample slot removed:', s.id);
  }
}

// Sample pictures nothing uses any more (the music clip may still use the catering sample).
const used = new Set([...keptOther.flatMap((s) => Object.values(s.pictures ?? {})), ...(music.clipPictures ?? []), ...PICS.map((p) => p.id)]);
for (const p of pictures) {
  if (!SAMPLE_PIC_NAMES.includes(p.name) || used.has(p.id)) continue;
  if (!dry) {
    await db.doc('pictureData/' + p.id).delete();
    await db.doc('pictures/' + p.id).delete();
  }
  console.log('Sample picture removed:', p.id, p.name);
}

// Every TV starts the new loop together, from the first picture.
if (!dry) await db.doc('singletons/loop').set({ anchor: Date.now(), firstSlotId: 'menu-1' });
console.log(dry ? 'Dry run: nothing written.' : 'Done.');
