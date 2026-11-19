import { describe, expect, it } from 'vitest';
import { dishFromLine, guessDiet, nameSize, sheets, tagsForOrder } from './tags';

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
