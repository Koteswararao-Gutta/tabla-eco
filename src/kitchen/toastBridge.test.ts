import { describe, expect, it } from 'vitest';
import { parseReport } from './toastBridge';

describe('parseReport', () => {
  it('accepts a menu report or an error report', () => {
    expect(parseReport('{"menus":[{"groups":[]}]}')).toEqual({ menus: [{ groups: [] }] });
    expect(parseReport('{"error":"page answered 403"}')).toEqual({ error: 'page answered 403' });
  });
  it('ignores anything else', () => {
    expect(parseReport('not json')).toBeNull();
    expect(parseReport('{"menus":"x"}')).toBeNull();
    expect(parseReport('null')).toBeNull();
  });
});
