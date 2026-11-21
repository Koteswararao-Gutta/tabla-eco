import { describe, expect, it } from 'vitest';
import { emptyEstimateForm, estimateFormFromScan } from './estimates';
import type { ScannedOrder } from '@shared/data';

const scan: ScannedOrder = {
  isOrder: true, customerName: 'Ravi', phone: '', date: '', time: '', type: 'unknown', address: '', people: '30',
  lines: [{ dish: 'Chicken Dum Biryani', qty: '1', unit: 'Full tray', note: '', unsure: false }], notes: '', unsure: [],
};

describe('estimateFormFromScan', () => {
  it('fills the estimate, keeps discount and delivery fee, and leaves prices to the list', () => {
    const base = { ...emptyEstimateForm(), discount: '10', deliveryFee: '15' };
    const { form, unsure } = estimateFormFromScan(scan, base);
    expect(form).toMatchObject({ customerName: 'Ravi', people: '30', discount: '10', deliveryFee: '15', date: '' });
    expect(form.lines[0]).toMatchObject({ name: 'Chicken Dum Biryani', qty: '1', unit: 'Full tray' });
    expect(form.lines[0].price ?? '').toBe('');
    // No date is fine on an estimate; an unclear pickup/delivery is still flagged.
    expect(unsure).not.toContain('date');
    expect(unsure).toContain('type');
  });
});
