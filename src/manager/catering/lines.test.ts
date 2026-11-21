import { describe, expect, it } from 'vitest';
import { dishFromLine, itemTexts, lineText, menuDishes, normalizeUnit, orderLines, parseLine, qtyText, qtyValue, searchDishes, tidyQty } from './lines';

const menu = {
  groups: [
    { id: 'b', name: 'Biryani', items: [{ id: 'b1', name: 'Chicken Dum Biryani' }, { id: 'b2', name: 'Veg Dum Biryani' }, { id: 'b3', name: 'Goat Dum Biryani' }] },
    { id: 's', name: 'Non Veg Starters', items: [{ id: 's1', name: 'Chicken 65' }, { id: 's2', name: 'Apollo Fish' }] },
    { id: 'd', name: 'Desserts', items: [{ id: 'd1', name: 'Gulab Jamun' }, { id: 'd2', name: 'Chicken Dum Biryani' }] },
    { id: 'x', name: 'Sides', items: [{ id: 'x1', name: 'Raita' }, { id: '', name: '  ' }] },
  ],
};
const dishes = menuDishes(menu);

describe('menuDishes', () => {
  it('lists each dish once with its group, skipping blanks', () => {
    expect(dishes.map((d) => d.name)).toEqual(['Chicken Dum Biryani', 'Veg Dum Biryani', 'Goat Dum Biryani', 'Chicken 65', 'Apollo Fish', 'Gulab Jamun', 'Raita']);
    expect(dishes[3]).toMatchObject({ id: 's1', group: 'Non Veg Starters' });
    expect(menuDishes(null)).toEqual([]);
    expect(menuDishes({ groups: undefined })).toEqual([]);
  });
});

describe('searchDishes', () => {
  it('finds dishes from the start of each word', () => {
    expect(searchDishes('chick bir', dishes).map((d) => d.name)).toEqual(['Chicken Dum Biryani']);
    expect(searchDishes('bir', dishes).map((d) => d.name)).toEqual(['Veg Dum Biryani', 'Goat Dum Biryani', 'Chicken Dum Biryani']);
    expect(searchDishes('chicken', dishes)[0].name).toBe('Chicken 65');
    expect(searchDishes('gul', dishes).map((d) => d.name)).toEqual(['Gulab Jamun']);
    expect(searchDishes('yani', dishes)).toHaveLength(3); // inside a word, from 3 letters
    expect(searchDishes('zz', dishes)).toEqual([]);
    expect(searchDishes('  ', dishes)).toEqual([]);
  });
});

describe('units', () => {
  it.each([
    ['FT', 'Full tray', true],
    ['large trays', 'Full tray', true],
    ['half tray', 'Half tray', true],
    ['HT', 'Half tray', true],
    ['trays', 'Full tray', false],
    ['pcs', 'Pieces', true],
    ['people', 'Servings', true],
    ['lbs', 'Lbs', true],
    ['qt', 'Quarts', true],
    ['gal', 'Gallons', true],
    ['Pieces', 'Pieces', true],
    ['tubs', 'Tubs', true],
    ['', '', true],
  ])('%s → %s', (word, unit, sure) => {
    expect(normalizeUnit(word)).toEqual({ unit, sure });
  });
  it('reads a quantity the way people say it', () => {
    expect(qtyText({ qty: 2, unit: 'Full tray' })).toBe('2 Full trays');
    expect(qtyText({ qty: 1, unit: 'Half tray' })).toBe('1 Half tray');
    expect(qtyText({ qty: 40, unit: 'Pieces' })).toBe('40 pieces');
    expect(qtyText({ qty: 1, unit: 'Lbs' })).toBe('1 lb');
    expect(qtyText({ qty: 30, unit: '' })).toBe('30');
    expect(qtyText({ qty: null, unit: 'Full tray' })).toBe('Full tray');
    expect(qtyText({ qty: 3, unit: 'Tubs' })).toBe('3 Tubs');
    expect(qtyText({ qty: null, unit: '' })).toBe('');
  });
});

describe('parseLine', () => {
  it.each([
    ['Chicken dum biryani, 2 large trays', 'b1', 'Chicken Dum Biryani', 2, 'Full tray', '', true],
    ['Chicken 65 - 3 FT', 's1', 'Chicken 65', 3, 'Full tray', '', true],
    ['Chicken 65', 's1', 'Chicken 65', null, '', '', false],
    ['Gulab jamun, 40 pcs', 'd1', 'Gulab Jamun', 40, 'Pieces', '', true],
    ['2 dozen gulab jamun', 'd1', 'Gulab Jamun', 24, 'Pieces', '', true],
    ['Raita, 2 quarts', 'x1', 'Raita', 2, 'Quarts', '', true],
    ['Veg biryani (mild) - 1 half tray', null, 'Veg Biryani', 1, 'Half tray', 'mild', false],
    ['Goat dum biryani, 1 tray', 'b3', 'Goat Dum Biryani', 1, 'Full tray', '', false],
    ['Rose Milk – 15 Gallons', null, 'Rose Milk', 15, 'Gallons', '', false],
    ['Apollo fish x2', 's2', 'Apollo Fish', 2, '', '', true],
  ])('%s', (text, dishId, name, qty, unit, note, sure) => {
    const r = parseLine(text, dishes);
    expect(r.line).toMatchObject({ dishId, name, qty, unit, note, text });
    expect(r.sure).toBe(sure);
    expect(!!r.line.check).toBe(!sure);
  });
});

describe('orderLines', () => {
  it('uses the saved lines', () => {
    const lines = [{ dishId: 'b1', name: 'Chicken Dum Biryani', qty: 2, unit: 'Full tray', note: 'mild' }];
    const items = lines.map(lineText).join('\n');
    expect(items).toBe('Chicken Dum Biryani, 2 Full trays (mild)');
    expect(orderLines({ items, lines })).toBe(lines);
  });
  it('uses the saved lines even when the text reads differently: the lines are the one source', () => {
    const lines = [{ dishId: 'x1', name: 'Raita', qty: 2, unit: 'Quarts', note: '' }];
    expect(orderLines({ items: 'Raita, 3 quarts', lines }, dishes)).toBe(lines);
    // A "1 1/2" in a note or a dish typed in is never read again from the text.
    const typed = [{ dishId: null, name: 'Goat Curry', qty: 1.5, unit: 'Half tray', note: 'cut 1 1/2 inch' }];
    expect(orderLines({ items: typed.map(lineText).join('\n'), lines: typed })).toBe(typed);
  });
  it('reads the text (marked to check when guessed) when there are no lines', () => {
    expect(orderLines({ items: 'Raita, 2 quarts' }, dishes)).toEqual([{ dishId: 'x1', name: 'Raita', qty: 2, unit: 'Quarts', note: '', text: 'Raita, 2 quarts' }]);
    expect(orderLines({ items: 'Goat curry 2 trays' }, dishes)[0].check).toBe(true);
    expect(orderLines({ items: '' })).toEqual([]);
    expect(orderLines({ items: 'Rice', lines: [{ bad: true } as never] })[0].name).toBe('Rice');
    expect(orderLines({ items: 'Rice', lines: [] })[0].name).toBe('Rice');
    expect(orderLines({ items: '', lines: [] })).toEqual([]);
  });
});

describe('itemTexts', () => {
  it('makes the text from the lines when the order has them', () => {
    const lines = [
      { dishId: 'b1', name: 'Chicken Dum Biryani', qty: 1.5, unit: 'Full tray', note: '' },
      { dishId: 'x1', name: 'Raita', qty: 24, unit: 'Oz', note: '', extra: 'Raita' },
    ];
    expect(itemTexts({ items: 'something old', lines })).toEqual(['Chicken Dum Biryani, 1-1/2 Full trays', 'Raita, 24 oz (extra)']);
  });
  it('uses the saved text on an old order', () => {
    expect(itemTexts({ items: 'Samosa 40\n\n Raita ½ tray ' })).toEqual(['Samosa 40', 'Raita 1/2 tray']);
  });
});

describe('dish names from typed lines', () => {
  it.each([
    ['Chicken Biryani for 40', 'Chicken Biryani', 40],
    ['Chicken Biryani for 40 people', 'Chicken Biryani', 40],
    ['Samosa (2) 40 pcs', 'Samosa (2)', 40],
  ])('%s', (text, name, qty) => {
    const l = parseLine(text, [...dishes, { id: 'sam', name: 'Samosa (2)', group: '', description: '' }]).line;
    expect(l.name).toBe(name);
    expect(l.qty).toBe(qty);
  });
  it('keeps the joining word out of the name ("2 FT + 1 HT")', () => {
    expect(dishFromLine('Chicken Biryani 2 FT + 1 HT').name).toBe('Chicken Biryani');
  });
});

describe('mixed quantities (1½ trays)', () => {
  it('shows them with a dash so 1½ never reads as eleven halves', () => {
    expect(qtyText({ qty: 1.5, unit: 'Full tray' })).toBe('1-1/2 Full trays');
    expect(qtyText({ qty: 0.5, unit: 'Full tray' })).toBe('1/2 Full tray');
    expect(qtyText({ qty: 2.75, unit: 'Half tray' })).toBe('2-3/4 Half trays');
    expect(qtyText({ qty: 0.25, unit: '' })).toBe('1/4');
    expect(qtyText({ qty: 1.3, unit: 'Lbs' })).toBe('1.3 lbs');
  });

  it('tidies typed text: "1 1/2", "1½" and "11/2" all become "1-1/2"', () => {
    expect(tidyQty('Chicken biryani 1 1/2 trays')).toBe('Chicken biryani 1-1/2 trays');
    expect(tidyQty('Chicken biryani 11/2 trays')).toBe('Chicken biryani 1-1/2 trays');
    expect(tidyQty('Veg biryani 1½ FT')).toBe('Veg biryani 1-1/2 FT');
    expect(tidyQty('Raita ½ tray')).toBe('Raita 1/2 tray');
    expect(tidyQty('Pulao 21/2 trays, Dal 13/4')).toBe('Pulao 2-1/2 trays, Dal 1-3/4');
    expect(tidyQty('Paneer 1-1/2 tray, Naan 1/2, 12 pcs, Chicken 65 1/2 tray')).toBe('Paneer 1-1/2 tray, Naan 1/2, 12 pcs, Chicken 65 1/2 tray');
  });

  it.each(['Chicken dum biryani 1-1/2 FT', 'Chicken dum biryani 1 1/2 FT', 'Chicken dum biryani 11/2 FT', 'Chicken dum biryani, 1½ full trays'])('reads %s as 1.5 Full tray', (t) => {
    const r = parseLine(t, dishes);
    expect(r.line).toMatchObject({ dishId: 'b1', name: 'Chicken Dum Biryani', qty: 1.5, unit: 'Full tray' });
    expect(r.sure).toBe(true);
  });

  it('reads "Chicken 65 1/2 tray" as half of a tray of Chicken 65', () => {
    expect(parseLine('Chicken 65 1/2 FT', dishes).line).toMatchObject({ dishId: 's1', qty: 0.5, unit: 'Full tray' });
  });

  it('shows old typed lines and items text the clear way', () => {
    expect(lineText({ dishId: null, name: 'Biryani', qty: 5.5, unit: '', note: '', text: 'Biryani 11/2 trays' })).toBe('Biryani 1-1/2 trays');
    expect(orderLines({ items: 'Chicken dum biryani 11/2 FT' }, dishes)[0]).toMatchObject({ qty: 1.5, text: 'Chicken dum biryani 1-1/2 FT' });
  });

  it('qtyValue reads every way of writing it', () => {
    expect(['1.5', '1,5', '3/2', '1-1/2', '1 1/2', '11/2', '1½'].map(qtyValue)).toEqual([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]);
    expect(qtyValue('abc')).toBeNaN();
  });
});

describe('review fixes', () => {
  it('saved lines with "1 1/2" or "½" in a note or name read back as saved', () => {
    const lines = [
      { dishId: 'b1', name: 'Chicken Dum Biryani', qty: 2, unit: 'Full tray', note: 'cut 1 1/2 inch' },
      { dishId: null, name: 'Paneer ½ Tikka', qty: 1, unit: 'Half tray', note: '' },
      { dishId: null, name: 'Raita', qty: 0.5, unit: 'Full tray', note: '', extra: 'Raita' },
    ];
    const items = lines.map(lineText).join('\n');
    expect(items).toBe('Chicken Dum Biryani, 2 Full trays (cut 1-1/2 inch)\nPaneer 1/2 Tikka, 1 Half tray\nRaita, 1/2 Full tray (extra)');
    expect(orderLines({ items, lines }, dishes)).toBe(lines);
  });

  it('a dish with its own number in brackets reads the amount, not the number', () => {
    const d = menuDishes({ groups: [{ id: 's', name: 'Starters', items: [{ id: 's', name: 'Samosa (2)' }] }] });
    expect(parseLine('Samosa (2) 40 pcs', d).line).toMatchObject({ dishId: 's', qty: 40, unit: 'Pieces' });
    expect(parseLine('Samosa (2) 40 pcs', d).sure).toBe(true);
    expect(parseLine('Samosa (2) 40 pcs').line).toMatchObject({ qty: 40, unit: 'Pieces' });
  });

  it('reads the dish without "for N people", "+ 1 HT", a count or caps', () => {
    const read = (l: string) => { const { name, qty, unit } = parseLine(l).line; return [name, qty, unit]; };
    expect(read('Chicken Biryani for 50 people')).toEqual(['Chicken Biryani', 50, 'Servings']);
    expect(read('Chicken biryani 2 FT + 1 HT')).toEqual(['Chicken Biryani', 2, 'Full tray']);
    expect(parseLine('Chicken biryani 2 FT + 1 HT').sure).toBe(false);
    expect(read('Gulab Jamun 100')).toEqual(['Gulab Jamun', 100, '']);
    expect(read('7 Up 24 cans')).toEqual(['7 Up', 24, 'Cans']);
    expect(read('CHICKEN 65, 2 half trays')).toEqual(['Chicken 65', 2, 'Half tray']);
    expect(read('Gobi 65')).toEqual(['Gobi 65', null, '']);
    expect(read('40 samosas')).toEqual(['Samosas', 40, '']);
  });
});
