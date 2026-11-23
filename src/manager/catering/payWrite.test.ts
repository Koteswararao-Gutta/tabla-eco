import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  getDoc: vi.fn(),
  updateDoc: vi.fn(async (..._args: unknown[]) => {}),
  now: () => 1000,
}));
vi.mock('@shared/data', () => ({ store: fake, appendItems: <T,>(a: T[]) => Object.defineProperty([...a], 'appended', { value: true }) }));

import { isOfflineError, savePay } from './payWrite';

const offline = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
const deposit = (amount: number) => () => ({
  addDeposits: [{ amount, method: 'cash' as const, takenBy: 'Ravi', at: 1000 }],
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
    const saved = fake.updateDoc.mock.calls[0][2] as Record<string, unknown>;
    expect(saved).toEqual({
      deposits: [{ amount: 50, method: 'cash', takenBy: 'Ravi', at: 1000 }],
      log: [{ kind: 'deposit', amount: 50, method: 'cash', takenBy: 'Ravi', at: 1000 }],
      updatedAt: 1000,
    });
    // Not paid: false: another phone may already have marked it paid while this one was offline.
    expect(saved).not.toHaveProperty('paid');
  });

  it('a payment known to be missing starts as paid: false', async () => {
    fake.getDoc.mockResolvedValue(null);
    await savePay('o1', deposit(50));
    expect(fake.updateDoc.mock.calls[0][2]).toMatchObject({ paid: false });
  });

  it('adds the deposit and the log entry to the end of the saved lists, never rewriting them', async () => {
    const old = { kind: 'amount', amount: 300, method: null, takenBy: null, at: 5 };
    fake.getDoc.mockResolvedValue({ id: 'o1', amount: 300, paid: false, log: [old], deposits: [] });
    await savePay('o1', deposit(20));
    const saved = fake.updateDoc.mock.calls[0][2] as { log: unknown[] & { appended?: boolean }; deposits: unknown[] & { appended?: boolean } };
    expect(saved.log).toEqual([{ kind: 'deposit', amount: 20, method: 'cash', takenBy: 'Ravi', at: 1000 }]);
    expect(saved.log.appended).toBe(true);
    expect(saved.deposits.appended).toBe(true);
  });

  it('online, a failed read still fails the save', async () => {
    fake.getDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(savePay('o1', deposit(50))).rejects.toThrow('denied');
    expect(fake.updateDoc).not.toHaveBeenCalled();
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
