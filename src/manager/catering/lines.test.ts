import { describe, expect, it } from 'vitest';
import { lineText, menuDishes, normalizeUnit, orderLines, parseLine, qtyText, searchDishes } from './lines';

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
  it('uses the saved lines while they match the text', () => {
    const lines = [{ dishId: 'b1', name: 'Chicken Dum Biryani', qty: 2, unit: 'Full tray', note: 'mild' }];
    const items = lines.map(lineText).join('\n');
    expect(items).toBe('Chicken Dum Biryani, 2 Full trays (mild)');
    expect(orderLines({ items, lines })).toBe(lines);
  });
  it('reads the text when there are no lines, or when the text was changed by an older app', () => {
    expect(orderLines({ items: 'Raita, 2 quarts' }, dishes)).toEqual([{ dishId: 'x1', name: 'Raita', qty: 2, unit: 'Quarts', note: '', text: 'Raita, 2 quarts' }]);
    const stale = { items: 'Raita, 3 quarts', lines: [{ dishId: 'x1', name: 'Raita', qty: 2, unit: 'Quarts', note: '', text: 'Raita, 2 quarts' }] };
    expect(orderLines(stale, dishes)[0].qty).toBe(3);
    expect(orderLines({ items: '' })).toEqual([]);
    expect(orderLines({ items: 'Rice', lines: [{ bad: true } as never] })[0].name).toBe('Rice');
  });
});
