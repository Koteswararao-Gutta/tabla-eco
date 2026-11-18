// Sample data so every link shows something real from the first load.
// Runs once per browser (when no settings exist yet). resetDemoData() wipes and reseeds.

import { store } from '../data';
import type { AppSettings, CateringOrder, MusicSettings, Screen, Slot } from '../data/types';

const W = 1920;
const H = 1080;

function placeholder(title: string, lines: string[], bg: string, fg = '#f6efe3', accent = '#f0a35e'): Blob {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = lines
    .map((l, i) => {
      const [name, price] = l.split('|');
      const y = 330 + i * 92;
      return `<text x="160" y="${y}" font-size="52" fill="${fg}">${esc(name)}</text>` +
        (price ? `<text x="${W - 160}" y="${y}" font-size="52" fill="${accent}" text-anchor="end">${esc(price)}</text>` : '');
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${bg}"/>
<text x="160" y="190" font-family="Georgia, serif" font-size="96" font-weight="700" fill="${accent}">${esc(title)}</text>
<g font-family="Inter, Arial, sans-serif">${body}</g>
<text x="${W - 160}" y="${H - 70}" font-family="Inter, Arial, sans-serif" font-size="28" fill="${fg}" opacity="0.5" text-anchor="end">Sample picture · replace in the manager app</text>
</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

const SCREENS: Screen[] = [
  { id: 'tv1', name: 'TV 1', kind: 'menu', side: 'left', mirrorOf: null },
  { id: 'tv2', name: 'TV 2', kind: 'menu', side: 'right', mirrorOf: null },
  { id: 'tv3', name: 'TV 3', kind: 'menu', side: 'left', mirrorOf: 'tv1' },
  { id: 'tv4', name: 'TV 4', kind: 'menu', side: 'right', mirrorOf: 'tv2' },
  { id: 'tv5', name: 'TV 5', kind: 'music' },
  { id: 'kitchen', name: 'Kitchen', kind: 'kitchen' },
];

export async function seedIfEmpty(): Promise<void> {
  // The marker is written first, so a seed that fails partway never runs twice and duplicates data.
  if (await store.getDoc('singletons', 'seeded')) return;
  await store.setDoc('singletons', 'seeded', { at: store.now() });
  await seed();
}

export async function resetDemoData(): Promise<void> {
  for (const k of Object.keys(localStorage)) if (k.startsWith('tabla:')) localStorage.removeItem(k);
  await store.setDoc('singletons', 'seeded', { at: store.now() });
  await seed();
}

async function seed(): Promise<void> {
  for (const s of SCREENS) await store.setDoc('screens', s.id, s);

  const pic = async (name: string, blob: Blob) => (await store.uploadPicture(blob, name)).id;
  const l1 = await pic('Left menu 1', placeholder('Starters', ['Samosa (2)|$6.99', 'Onion pakora|$7.99', 'Gobi Manchurian|$11.99', 'Chilli paneer|$12.99', 'Chicken 65|$12.99', 'Apollo fish|$13.99'], '#1d1a17'));
  const r1 = await pic('Right menu 1', placeholder('Biryani', ['Veg dum biryani|$14.99', 'Chicken dum biryani|$16.99', 'Goat dum biryani|$18.99', 'Egg biryani|$14.99', 'Shrimp biryani|$18.99', 'Served with raita|'], '#1d1a17'));
  const l2 = await pic('Left menu 2', placeholder('Curries', ['Paneer butter masala|$14.99', 'Dal tadka|$12.99', 'Chicken tikka masala|$15.99', 'Butter chicken|$15.99', 'Goat curry|$17.99', 'With rice or naan|'], '#20160f'));
  const r2 = await pic('Right menu 2', placeholder('Tandoor & breads', ['Tandoori chicken|$15.99', 'Chicken tikka|$14.99', 'Butter naan|$2.99', 'Garlic naan|$3.49', 'Chapati (2)|$3.99', 'Mango lassi|$4.49'], '#20160f'));
  const sp = await pic('Weekend special', placeholder('Weekend special', ['Hyderabadi goat biryani|$19.99', 'Saturday and Sunday only|', 'Ask about family packs|'], '#5a1e0b', '#fff3e6', '#ffd29a'));
  const cat = await pic('We do catering', placeholder('We do catering', ['Parties, offices and weddings|', 'Biryani trays, curries, desserts|', 'Pickup or delivery|', 'Ask at the counter|'], '#2b2a1e', '#f4efe0', '#e8c46a'));

  const slots: Slot[] = [
    { id: 'slot-menu-1', order: 1, seconds: 10, transition: 'fade', kind: 'menu', pictures: { tv1: l1, tv2: r1 } },
    { id: 'slot-menu-2', order: 2, seconds: 10, transition: 'fade', kind: 'menu', pictures: { tv1: l2, tv2: r2 } },
    { id: 'slot-special', order: 3, seconds: 8, transition: 'slide', kind: 'special', pictures: { tv1: sp } },
    { id: 'slot-catering', order: 4, seconds: 8, transition: 'fade', kind: 'catering', pictures: { tv1: cat } },
  ];
  for (const s of slots) await store.setDoc('slots', s.id, s);
  await store.setDoc('singletons', 'loop', { anchor: 0, firstSlotId: null });

  const music: MusicSettings = {
    playlist: '', shuffle: true, clipMode: 'afterEachSong', everySeconds: 60, clipSeconds: 8,
    clipPictures: [cat], clipTitle: 'We do catering', clipLine: 'Parties, offices and weddings. Ask at the counter.',
  };
  await store.setDoc('singletons', 'music', music);

  const settings: AppSettings = { kitchenPin: '1234', restaurantName: 'Tabla' };
  await store.setDoc('singletons', 'settings', settings);

  const at = (days: number, h: number, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const now = store.now();
  const orders: Omit<CateringOrder, 'id'>[] = [
    { customerName: 'Priya Sharma', phone: '555 123 4567', dueAt: at(0, 17, 30), type: 'pickup', people: 40, items: 'Chicken dum biryani, 2 large trays\nVeg dum biryani, 1 large tray\nRaita, 2 quarts\nGulab jamun, 40 pcs', notes: 'Less spicy, add serving spoons', status: 'open', createdAt: now, updatedAt: now },
    { customerName: 'Desert Tech office', phone: '555 987 2210', dueAt: at(1, 12, 0), type: 'delivery', address: '1200 W Main St, Suite 300', people: 25, items: 'Paneer butter masala, 1 tray\nButter chicken, 1 tray\nJeera rice, 2 trays\nGarlic naan, 30', notes: 'Call when outside', status: 'open', createdAt: now, updatedAt: now },
    { customerName: 'Rahul Verma', phone: '555 444 0101', dueAt: at(-1, 19, 0), type: 'pickup', people: 15, items: 'Goat dum biryani, 1 large tray\nChicken 65, 1 tray', status: 'completed', completedAt: at(-1, 18, 50), createdAt: now, updatedAt: now },
  ];
  for (const o of orders) await store.addDoc('orders', o);
}
