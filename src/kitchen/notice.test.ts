import { describe, expect, it } from 'vitest';
import { noticeText } from './notice';

const ok = { online: true, ordersLoaded: true, waitedLong: false };

describe('kitchen red notice', () => {
  it('shows nothing when all is well', () => {
    expect(noticeText(ok)).toBeNull();
  });
  it('says when the internet is gone, with or without saved orders', () => {
    expect(noticeText({ ...ok, online: false })).toMatch(/Offline: showing the last saved orders/);
    expect(noticeText({ ...ok, online: false, ordersLoaded: false })).toMatch(/Offline: orders will show/);
  });
  it('waits a while before saying orders cannot be reached', () => {
    expect(noticeText({ ...ok, ordersLoaded: false })).toBeNull();
    expect(noticeText({ ...ok, ordersLoaded: false, waitedLong: true })).toMatch(/Can’t reach the orders/);
  });
});
