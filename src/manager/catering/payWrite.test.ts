import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  getDoc: vi.fn(),
  updateDoc: vi.fn(async (..._args: unknown[]) => {}),
  now: () => 1000,
}));
vi.mock('@shared/data', () => ({ store: fake }));

import { isOfflineError, savePay } from './payWrite';

const offline = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
const deposit = (amount: number) => () => ({
  patch: { deposits: [{ amount, method: 'cash' as const, takenBy: 'Ravi', at: 1000 }] },
  events: [{ kind: 'deposit' as const, amount, method: 'cash' as const, takenBy: 'Ravi' }],
});

describe('savePay', () => {
  beforeEach(() => {
    fake.getDoc.mockReset();
    fake.updateDoc.mockClear();
  });

  it('offline, a payment never seen on this phone counts as none, and the save is kept (not "Could not save")', async () => {
    fake.getDoc.mockRejectedValue(offline);
    await savePay('o1', deposit(50));
    expect(fake.updateDoc).toHaveBeenCalledWith('orderAmounts', 'o1', {
      paid: false,
      deposits: [{ amount: 50, method: 'cash', takenBy: 'Ravi', at: 1000 }],
      log: [{ kind: 'deposit', amount: 50, method: 'cash', takenBy: 'Ravi', at: 1000 }],
      updatedAt: 1000,
    });
  });

  it('online, a failed read still fails the save', async () => {
    fake.getDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(savePay('o1', deposit(50))).rejects.toThrow('denied');
    expect(fake.updateDoc).not.toHaveBeenCalled();
  });

  it('keeps the saved log and adds to it', async () => {
    const old = { kind: 'amount', amount: 300, method: null, takenBy: null, at: 5 };
    fake.getDoc.mockResolvedValue({ id: 'o1', amount: 300, paid: false, log: [old] });
    await savePay('o1', deposit(20));
    expect(fake.updateDoc.mock.calls[0][2]).toMatchObject({ log: [old, { kind: 'deposit', amount: 20 }] });
    expect(fake.updateDoc.mock.calls[0][2]).not.toHaveProperty('paid');
  });
});

describe('isOfflineError', () => {
  it('is offline when the device says so, or the store found no connection', () => {
    expect(isOfflineError(new Error('x'), false)).toBe(true);
    expect(isOfflineError(offline, true)).toBe(true);
    expect(isOfflineError(new Error('x'), true)).toBe(false);
    expect(isOfflineError(null, true)).toBe(false);
  });
});
