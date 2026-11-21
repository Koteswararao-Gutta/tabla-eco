import { describe, expect, it } from 'vitest';
import { container, extrasFor, missingExtras, ruleFor, withExtras } from './extras';
import { lineText } from './lines';
import { linesFromForm, type LineDraft } from './orders';

const row = (name: string, qty: string, unit: string, more: Partial<LineDraft> = {}): LineDraft => ({ dishId: 'x', name, qty, unit, note: '', ...more });
const amounts = (lines: { name: string; qty: number | null; unit: string }[]) =>
  Object.fromEntries(extrasFor(lines).map((e) => [e.key, `${e.qty} ${e.unit}`]));

describe('which dishes get extras', () => {
  it('matches by words in the dish name', () => {
    expect(ruleFor('Chicken Dum Biryani')?.extras).toEqual(['Raita', 'Salan']);
    expect(ruleFor('Veg Samosa')?.extras).toEqual(['Mint Chutney', 'Tamarind Chutney']);
    expect(ruleFor('Samosa Chaat')).toBeNull();
    expect(ruleFor('Gobi 65')?.extras).toEqual(['Mint Chutney']);
    expect(ruleFor('Chicken Seekh Kebab')?.extras).toEqual(['Mint Chutney']);
    expect(ruleFor('Beetroot Tikki')?.extras).toEqual(['Chilli Dip']);
    expect(ruleFor('Veg Croquettes')?.extras).toEqual(['Chilli Dip']);
    expect(ruleFor('Chicken 65 Biryani')?.extras).toEqual(['Raita', 'Salan']);
    expect(ruleFor('Butter Chicken')).toBeNull();
    expect(ruleFor('Chicken 650')).toBeNull();
  });
});

describe('how much', () => {
  it('rounds up to the containers', () => {
    expect(container(4)).toEqual({ qty: 8, unit: 'Oz' });
    expect(container(20)).toEqual({ qty: 24, unit: 'Oz' });
    expect(container(38)).toEqual({ qty: 38, unit: 'Oz' });
    expect(container(40)).toEqual({ qty: 0.25, unit: 'Full tray' });
    expect(container(250)).toEqual({ qty: 1.5, unit: 'Full tray' });
  });

  it('biryani: 24 oz for a half tray, 1/4 tray for a full tray', () => {
    expect(amounts([{ name: 'Chicken Dum Biryani', qty: 1, unit: 'Half tray' }])).toEqual({ Raita: '24 Oz', Salan: '24 Oz' });
    expect(amounts([{ name: 'Chicken Dum Biryani', qty: 1, unit: 'Full tray' }])).toEqual({ Raita: '0.25 Full tray', Salan: '0.25 Full tray' });
    // Two biryanis add up into one raita and one salan.
    expect(amounts([
      { name: 'Chicken Dum Biryani', qty: 2, unit: 'Full tray' },
      { name: 'Veg Biryani', qty: 1, unit: 'Half tray' },
    ])).toEqual({ Raita: '0.75 Full tray', Salan: '0.75 Full tray' });
  });

  it('samosa: 2 oz of each for every 2', () => {
    expect(amounts([{ name: 'Veg Samosa', qty: 10, unit: 'Pieces' }])).toEqual({ 'Mint Chutney': '16 Oz', 'Tamarind Chutney': '16 Oz' });
    expect(amounts([{ name: 'Veg Samosa', qty: 30, unit: 'Pieces' }])).toEqual({ 'Mint Chutney': '38 Oz', 'Tamarind Chutney': '38 Oz' });
  });

  it('tikki and croquettes: 2 oz for every 4', () => {
    expect(amounts([{ name: 'Beetroot Tikki', qty: 20, unit: 'Pieces' }])).toEqual({ 'Chilli Dip': '16 Oz' });
    expect(amounts([{ name: 'Beetroot Tikki', qty: 8, unit: 'Pieces' }, { name: 'Veg Croquettes', qty: 24, unit: 'Pieces' }])).toEqual({ 'Chilli Dip': '16 Oz' });
  });

  it('dry items: 16 oz for 1/4 tray, 24 oz for 1/2 tray, 38 oz for a full tray', () => {
    expect(amounts([{ name: 'Chicken 65', qty: 0.25, unit: 'Full tray' }])).toEqual({ 'Mint Chutney': '16 Oz' });
    expect(amounts([{ name: 'Gobi 65', qty: 1, unit: 'Half tray' }])).toEqual({ 'Mint Chutney': '24 Oz' });
    expect(amounts([{ name: 'Gobi 65', qty: 1, unit: 'Full tray' }])).toEqual({ 'Mint Chutney': '38 Oz' });
    // Samosa mint and dry-item mint are the same chutney: one row.
    expect(amounts([{ name: 'Gobi 65', qty: 1, unit: 'Half tray' }, { name: 'Veg Samosa', qty: 10, unit: 'Pieces' }])).toEqual({ 'Mint Chutney': '38 Oz', 'Tamarind Chutney': '16 Oz' });
  });

  it('adds the extra without an amount when the dish has none', () => {
    expect(extrasFor([{ name: 'Veg Biryani', qty: 40, unit: 'Servings' }])).toEqual([
      { key: 'Raita', qty: null, unit: '' },
      { key: 'Salan', qty: null, unit: '' },
    ]);
  });
});

describe('extra rows on the form', () => {
  it('adds extras after the dishes and follows the dish amount', () => {
    let rows = withExtras([row('Chicken Dum Biryani', '1', 'Half tray'), row('Butter Chicken', '1', 'Full tray')], new Set());
    expect(rows.map((r) => [r.name, r.qty, r.unit, r.extra ?? ''])).toEqual([
      ['Chicken Dum Biryani', '1', 'Half tray', ''],
      ['Butter Chicken', '1', 'Full tray', ''],
      ['Raita', '24', 'Oz', 'Raita'],
      ['Salan', '24', 'Oz', 'Salan'],
    ]);
    rows = withExtras([{ ...rows[0], qty: '2', unit: 'Full tray' }, ...rows.slice(1)], new Set());
    expect(rows[2]).toMatchObject({ name: 'Raita', qty: '0.5', unit: 'Full tray' });
    // Biryani gone: its extras go.
    expect(withExtras(rows.slice(1), new Set()).map((r) => r.name)).toEqual(['Butter Chicken']);
  });

  it('keeps an extra changed by hand, and leaves out one taken off', () => {
    const rows = withExtras([row('Veg Biryani', '1', 'Half tray')], new Set());
    const edited = [rows[0], { ...rows[1], qty: '38', extraEdited: true }]; // Salan taken off
    const bigger = withExtras([{ ...edited[0], qty: '3' }, ...edited.slice(1)], new Set(['Salan']));
    expect(bigger.map((r) => [r.name, r.qty])).toEqual([
      ['Veg Biryani', '3'],
      ['Raita', '38'],
    ]);
  });

  it('is the same when run twice', () => {
    const once = withExtras([row('Veg Samosa', '40', 'Pieces'), row('Chicken 65', '1', 'Full tray')], new Set());
    expect(withExtras(once, new Set())).toEqual(once);
  });

  it('counts extras missing from an opened order as taken off', () => {
    expect(missingExtras([row('Veg Biryani', '1', 'Half tray'), row('Raita', '24', 'Oz', { extra: 'Raita' })])).toEqual(['Salan']);
  });

  it('saves extras marked, and reads as "(extra)" in the order text', () => {
    const [, raita] = linesFromForm(withExtras([row('Veg Biryani', '1', 'Full tray')], new Set()));
    expect(raita).toMatchObject({ name: 'Raita', qty: 0.25, unit: 'Full tray', extra: 'Raita' });
    expect(lineText(raita)).toBe('Raita, 1/4 Full tray (extra)');
    expect(lineText({ ...raita, qty: 24, unit: 'Oz', note: 'thick' })).toBe('Raita, 24 oz (extra, thick)');
  });
});

describe('review fixes', () => {
  it('leaves the amount empty when one of its dishes has none (a part sum would be too little)', () => {
    const lines = [
      { name: 'Chicken Dum Biryani', qty: 1, unit: 'Half tray' },
      { name: 'Veg Dum Biryani', qty: 40, unit: 'Servings' },
    ];
    expect(amounts(lines)).toEqual({ Raita: 'null ', Salan: 'null ' });
    expect(amounts([...lines].reverse())).toEqual({ Raita: 'null ', Salan: 'null ' });
  });

  it('adds no extra that is already ordered as a dish', () => {
    const rows = withExtras([row('Chicken Dum Biryani', '2', 'Full tray'), row('Raita', '2', 'Quarts')], new Set());
    expect(rows.map((r) => [r.name, r.extra ?? ''])).toEqual([['Chicken Dum Biryani', ''], ['Raita', ''], ['Salan', 'Salan']]);
    const sam = withExtras([row('Veg Samosa', '40', 'Pieces'), row('mint chutney', '1', 'Quarts')], new Set());
    expect(sam.map((r) => r.name)).toEqual(['Veg Samosa', 'mint chutney', 'Tamarind Chutney']);
    expect(missingExtras(rows)).toEqual(['Raita']);
  });

  it('knows the briyani spelling', () => {
    expect(ruleFor('Veg Briyani')?.extras).toEqual(['Raita', 'Salan']);
    expect(ruleFor('Chicken Biryan')?.extras).toEqual(['Raita', 'Salan']);
  });
});
