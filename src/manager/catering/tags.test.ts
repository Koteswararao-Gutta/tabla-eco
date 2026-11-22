import { describe, expect, it } from 'vitest';
import { linesText } from './lines';
import { dishFromLine, guessDiet, nameSize, sheets, tagName, tagsForOrder, tooLong } from './tags';

describe('dishFromLine', () => {
  it.each([
    ['Reshampatti Chicken - 6 FT', 'Reshampatti Chicken', ''],
    ['Rose Milk – 15 Gallons', 'Rose Milk', ''],
    ['20 samosas', 'Samosas', ''],
    ['2 x Veg Biryani', 'Veg Biryani', ''],
    ['Veg Biryani x3', 'Veg Biryani', ''],
    ['Andhra Chicken Curry (Bone-in) - 4 FT', 'Andhra Chicken Curry', 'Bone-in'],
    ['Curd Rice (4 trays)', 'Curd Rice', ''],
    ['Chicken 65', 'Chicken 65', ''],
    ['Chicken 65 - 3 FT', 'Chicken 65', ''],
    ['6 full trays chicken biryani', 'Chicken Biryani', ''],
    ['- Gongura Pachadi: 1 FT', 'Gongura Pachadi', ''],
    ['3. Semiya Kheer 4 FT', 'Semiya Kheer', ''],
    ['Fryums / Papad - 4 Tubs', 'Fryums / Papad', ''],
    ['Chicken dum biryani, 2 large trays', 'Chicken Dum Biryani', ''],
    ['Garlic naan, 30', 'Garlic Naan', ''],
    ['Raita, 2 quarts', 'Raita', ''],
    ['Gulab jamun, 40 pcs', 'Gulab Jamun', ''],
    ['paneer tikka with mint chutney (no onion)', 'Paneer Tikka with Mint Chutney', 'No Onion'],
  ])('%s', (line, name, sub) => {
    expect(dishFromLine(line)).toEqual({ name, sub });
  });
});

describe('guessDiet', () => {
  it('reads meat words in the dish name', () => {
    expect(guessDiet('Kodi Vepudu', null)).toBe('nonveg');
    expect(guessDiet('Donne Biryani Chicken', null)).toBe('nonveg');
    expect(guessDiet('Egg Curry', null)).toBe('nonveg');
    expect(guessDiet('Eggplant Fry', null)).toBe('veg');
    expect(guessDiet('Veg Hakka Noodles', null)).toBe('veg');
    expect(guessDiet('Paneer Tikka', null)).toBe('veg');
  });
  it('trusts the Toast menu group', () => {
    expect(guessDiet('Haleem Special', { name: 'Haleem Special', description: '', group: 'Non-Veg Specials' })).toBe('nonveg');
    expect(guessDiet('Gobi 65', { name: 'Gobi 65', description: '', group: 'Veg Starters' })).toBe('veg');
  });
});

describe('tagsForOrder', () => {
  it('makes one tag per dish, skips repeats and blank lines, and uses the Toast group', () => {
    const menu = { groups: [{ id: 'g', name: 'Non Veg Appetizers', items: [{ id: 'i', name: 'Apollo Special' }] }] };
    const tags = tagsForOrder({ items: 'Rose Milk - 15 Gallons\n\nApollo Special - 2 FT\nrose milk\n  \nAndhra Chicken Curry (Bone-in) - 4 FT' }, menu);
    expect(tags).toEqual([
      { name: 'Rose Milk', sub: '', diet: 'veg' },
      { name: 'Apollo Special', sub: '', diet: 'nonveg' },
      { name: 'Andhra Chicken Curry', sub: 'Bone-in', diet: 'nonveg' },
    ]);
  });
  it('takes the name and note from the saved lines, never from the text', () => {
    const lines = [
      { dishId: null, name: 'Goat Curry', qty: 1.5, unit: 'Half tray', note: 'bone-in', text: 'Goat curry 1 1/2 HT (bone-in)', check: true },
      { dishId: null, name: 'Chicken Biryani', qty: 40, unit: 'Servings', note: '' },
    ];
    expect(tagsForOrder({ items: 'Chicken Biryani for 40 and more text', lines }, null)).toEqual([
      { name: 'Goat Curry', sub: 'Bone-in', diet: 'nonveg' },
      { name: 'Chicken Biryani', sub: '', diet: 'nonveg' },
    ]);
  });
  it('copes with missing items or menu', () => {
    expect(tagsForOrder({ items: '' }, null)).toEqual([]);
    expect(tagsForOrder({ items: 'Tea' }, { groups: undefined })).toEqual([{ name: 'Tea', sub: '', diet: 'veg' }]);
  });
});

it('splits into sheets of 10 and sizes long names', () => {
  expect(sheets(Array.from({ length: 24 }, (_, i) => i)).map((s) => s.length)).toEqual([10, 10, 4]);
  expect(nameSize('Rose Milk')).toBe('');
  expect(nameSize('Andhra Chicken Curry Special')).toBe('long');
  expect(nameSize('Hyderabadi Chicken Dum Biryani Family Pack')).toBe('xlong');
});

describe('tags show just the dish', () => {
  const menu = {
    groups: [
      { id: 'a', name: 'Veg Appetizers', items: [{ id: 'samosa', name: 'Onion Samosa (6 pcs) (V)' }, { id: 'rolls', name: 'Spring Rolls (6 pc)' }, { id: 'chaat', name: 'Samosa Chaat' }] },
      { id: 'b', name: 'Non-Veg Appetizers', items: [{ id: 'c65', name: 'Chicken 65' }] },
      { id: 'c', name: 'Breads', items: [{ id: 'naan', name: 'Garlic Naan' }] },
      { id: 'd', name: 'Desserts', items: [{ id: 'gj', name: 'Gulab Jamun (4 pc)' }, { id: 'rm', name: 'Rasmalai (3 pc)' }] },
    ],
  };
  const line = (dishId: string | null, name: string, qty: number | null, unit: string, note = '') => ({ dishId, name, qty, unit, note });

  it('leaves out quantities, units, notes, portion sizes and menu markers', () => {
    const lines = [
      line('samosa', 'Onion Samosa (6 pcs) (V)', 60, 'Pieces'),
      line('chaat', 'Samosa Chaat', 2, 'Half tray', 'chutney on the side'),
      line('c65', 'Chicken 65', 1.5, 'Full tray', 'extra spicy'),
      line('naan', 'Garlic Naan', 60, 'Pieces', 'cut in 4'),
      line('gj', 'Gulab Jamun (4 pc)', 25, 'Pieces'),
      line('rolls', 'Spring Rolls (6 pc)', 30, 'Pieces'),
      line(null, 'Raita', 2, 'Quarts'),
      line('rm', 'Rasmalai (3 pc)', 60, 'Pieces'),
    ];
    // As the app saves an order: the lines, plus the same items as text.
    const tags = tagsForOrder({ lines, items: linesText(lines) }, menu);
    expect(tags.map((t) => [t.name, t.sub, t.diet])).toEqual([
      ['Onion Samosa', '', 'veg'],
      ['Samosa Chaat', '', 'veg'],
      ['Chicken 65', '', 'nonveg'],
      ['Garlic Naan', '', 'veg'],
      ['Gulab Jamun', '', 'veg'],
      ['Spring Rolls', '', 'veg'],
      ['Raita', '', 'veg'],
      ['Rasmalai', '', 'veg'],
    ]);
  });

  it('keeps a describing word in brackets, drops markers', () => {
    expect(tagName('Andhra Chicken Curry (Bone-in)')).toEqual({ name: 'Andhra Chicken Curry', sub: 'Bone-in', mark: null });
    expect(tagName('Paneer 65 (V) (Spicy)')).toEqual({ name: 'Paneer 65', sub: '', mark: 'veg' });
    expect(tagName('Chicken Biryani (Serves 2-3)')).toEqual({ name: 'Chicken Biryani', sub: '', mark: null });
    expect(tagName('Egg Puffs - 2 pcs')).toEqual({ name: 'Egg Puffs', sub: '', mark: null });
  });

  it('typed lines of old orders drop amounts like 1-1/2 FT and kitchen notes', () => {
    const tags = tagsForOrder({ items: 'Chicken 65 - 1-1/2 FT (extra spicy)\nVeg Biryani 1½ trays\nAndhra Chicken Curry (Bone-in) - 4 FT\nMirchi Bajji, 40 pcs (chutney on the side)' }, null);
    expect(tags.map((t) => [t.name, t.sub])).toEqual([
      ['Chicken 65', ''],
      ['Veg Biryani', ''],
      ['Andhra Chicken Curry', 'Bone-in'],
      ['Mirchi Bajji', ''],
    ]);
  });
});

describe('review fixes', () => {
  const menu = { groups: [{ id: 'n', name: 'Non-Veg Curries', items: [{ id: 'a', name: 'Andhra Chicken Curry' }] }] };

  it('keeps no amounts in the name', () => {
    const items = 'Chicken Biryani for 50 people\nVeg biryani 2 FT + 1 HT\nGulab Jamun 100\n7 Up 24 cans\nCHICKEN 65, 2 half trays\nMurgh ka Salan 1 FT';
    expect(tagsForOrder({ items }).map((t) => t.name)).toEqual(['Chicken Biryani', 'Veg Biryani', 'Gulab Jamun', '7 Up', 'Chicken 65', 'Murgh ka Salan']);
  });

  it('keeps the line note under a menu dish, but not a kitchen note', () => {
    const lines = [
      { dishId: 'a', name: 'Andhra Chicken Curry', qty: 2, unit: 'Full tray', note: 'bone-in' },
      { dishId: null, name: 'Veg Biryani', qty: 1, unit: 'Full tray', note: 'extra spicy' },
    ];
    expect(tagsForOrder({ items: linesText(lines), lines }, menu).map((t) => [t.name, t.sub])).toEqual([
      ['Andhra Chicken Curry', 'Bone-in'],
      ['Veg Biryani', ''],
    ]);
  });

  it('keeps notes from reading the paper order off the tag, but keeps a short word like Dry', () => {
    const lines = [
      { dishId: null, name: 'Chilli Fish', qty: 1, unit: 'Half tray', note: 'dry' },
      { dishId: null, name: 'Baby Corn Manchurian', qty: 1, unit: 'Half tray', note: 'veg crossed out, written as baby corn above it' },
      { dishId: null, name: 'Veg Chowmein', qty: 1, unit: 'Half tray', note: 'not on menu as written' },
      { dishId: null, name: 'Goat Curry (looks like goat?)', qty: 1, unit: 'Half tray', note: '' },
    ];
    expect(tagsForOrder({ items: linesText(lines), lines }).map((t) => [t.name, t.sub])).toEqual([
      ['Chilli Fish', 'Dry'],
      ['Baby Corn Manchurian', ''],
      ['Veg Chowmein', ''],
      ['Goat Curry', ''],
    ]);
  });

  it('never puts a number under the name', () => {
    expect(tagsForOrder({ items: 'Chicken Biryani (50 people)\nGoat Curry (cut 2 inch)\nChicken 65' }).map((t) => [t.name, t.sub])).toEqual([
      ['Chicken Biryani', ''],
      ['Goat Curry', ''],
      ['Chicken 65', ''],
    ]);
  });

  it('makes one tag for Samosa and Samosas', () => {
    expect(tagsForOrder({ items: 'Samosa 40 pcs\n2 dozen samosas' }).map((t) => t.name)).toEqual(['Samosa']);
  });

  it('says when a name is too long for the tag', () => {
    expect(tooLong('Ulavacharu Kodi Pulao Family Pack Boneless Special Mix')).toBe(false);
    expect(tooLong('Hyderabadi Gongura Chicken Biryani Boneless Ulavacharu Kheem')).toBe(true);
    expect(tooLong('M'.repeat(50))).toBe(true);
  });
});
