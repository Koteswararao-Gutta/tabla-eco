import { describe, expect, it } from 'vitest';
import type { CateringEstimate } from '@shared/data';
import { customerWhatsappHref, emptyEstimateForm, estimateFields, estimateText, formFromEstimate, orderFormFromEstimate, validateEstimate, type EstimateForm } from './estimates';
import { STARTING_PRICES } from './prices';

const form = (patch: Partial<EstimateForm> = {}): EstimateForm => ({
  ...emptyEstimateForm(),
  customerName: 'Priya',
  lines: [
    { dishId: null, name: 'Chicken Dum Biryani', qty: '1', unit: 'Full tray', note: '' },
    { dishId: null, name: 'Onion Samosa', qty: '50', unit: 'Pieces', note: '', price: '50' },
    { dishId: null, name: 'Raita', qty: '48', unit: 'Oz', note: '', extra: 'Raita' },
  ],
  ...patch,
});

describe('estimates', () => {
  it('saves line prices from the list and typed ones, with the total', () => {
    const e = estimateFields(form({ discount: '20' }), STARTING_PRICES);
    expect(e.lines.map((l) => [l.name, l.price, !!l.priceSet])).toEqual([
      ['Chicken Dum Biryani', 170, false],
      ['Onion Samosa', 50, true],
      ['Raita', 0, false],
    ]);
    expect(e.discount).toBe(20);
    expect(e.total).toBe(200);
    expect(e.dueAt).toBeNull();
    expect(JSON.stringify(e)).not.toContain('undefined');
  });

  it('asks for a price when the list has none, and needs only a name and an item', () => {
    const f = form();
    f.lines[1] = { ...f.lines[1], price: '' };
    expect(validateEstimate(f, STARTING_PRICES).lines).toBe('Please enter a price for Onion Samosa.');
    expect(validateEstimate(form(), STARTING_PRICES)).toEqual({});
    expect(validateEstimate(form({ customerName: '' }), STARTING_PRICES).customerName).toBeTruthy();
    expect(validateEstimate(form({ time: '18:00' }), STARTING_PRICES).date).toBeTruthy();
    expect(validateEstimate(form({ discount: 'abc' }), STARTING_PRICES).discount).toBeTruthy();
  });

  it('round-trips through the form; a typed price stays typed, a list price follows the list', () => {
    const fields = estimateFields(form({ date: '2026-11-28', time: '' }), STARTING_PRICES);
    const e: CateringEstimate = { ...fields, status: 'open', orderId: null, createdAt: 1, updatedAt: 1 };
    const back = formFromEstimate(e);
    expect(back.date).toBe('2026-11-28');
    expect(back.time).toBe('');
    expect(back.lines[0].price).toBeUndefined();
    expect(back.lines[1].price).toBe('50');
    const order = orderFormFromEstimate(e);
    expect(order.lines.some((l) => 'price' in l)).toBe(false);
    expect(order.customerName).toBe('Priya');
  });

  it('writes the customer message with prices, extras included and the total', () => {
    const fields = estimateFields(form({ date: '2026-11-28', time: '18:00', people: '40', discount: '20' }), STARTING_PRICES);
    const text = estimateText({ ...fields, status: 'open', orderId: null, createdAt: 1, updatedAt: 1 }, 'Tabla Indian Restaurant');
    expect(text).toContain('*Tabla Indian Restaurant: catering estimate*');
    expect(text).toContain('Sat, Nov 28, 6:00 PM · Pickup');
    expect(text).toContain('• Chicken Dum Biryani, 1 Full tray: $170');
    expect(text).toContain('• Raita, 48 oz: included');
    expect(text).toContain('Discount: -$20');
    expect(text).toContain('*Total: $200*');
    expect(text).toContain('Prices hold for 7 days');
  });

  it("opens WhatsApp to the customer's number", () => {
    expect(customerWhatsappHref('(602) 555-1234', 'hi')).toBe('https://wa.me/16025551234?text=hi');
    expect(customerWhatsappHref('', 'hi')).toBe('https://wa.me/?text=hi');
  });
});
