import { describe, expect, it } from 'vitest';
import { zoneDiffersFromArizona, zoneOffsetMinutes } from './timezone';

const JAN = Date.UTC(2026, 0, 15, 18, 0);
const JUL = Date.UTC(2026, 6, 15, 18, 0);

describe('time zone check', () => {
  it('knows the offsets', () => {
    expect(zoneOffsetMinutes('America/Phoenix', JAN)).toBe(-420);
    expect(zoneOffsetMinutes('America/Phoenix', JUL)).toBe(-420);
    expect(zoneOffsetMinutes('UTC', JUL)).toBe(0);
    expect(zoneOffsetMinutes('Asia/Kolkata', JAN)).toBe(330);
    expect(zoneOffsetMinutes('America/Los_Angeles', JUL)).toBe(-420);
    expect(zoneOffsetMinutes('America/Los_Angeles', JAN)).toBe(-480);
    expect(zoneOffsetMinutes('Not/AZone', JAN)).toBeNull();
  });

  it('Arizona is fine all year', () => {
    expect(zoneDiffersFromArizona('America/Phoenix', JAN, 0)).toBe(false);
    expect(zoneDiffersFromArizona('America/Phoenix', JUL, 0)).toBe(false);
  });

  it('warns only while the clock time differs', () => {
    // Denver matches Arizona in winter, is an hour ahead in summer; Los Angeles the other way round.
    expect(zoneDiffersFromArizona('America/Denver', JAN, 0)).toBe(false);
    expect(zoneDiffersFromArizona('America/Denver', JUL, 0)).toBe(true);
    expect(zoneDiffersFromArizona('America/Los_Angeles', JAN, 0)).toBe(true);
    expect(zoneDiffersFromArizona('America/Los_Angeles', JUL, 0)).toBe(false);
    expect(zoneDiffersFromArizona('UTC', JAN, 0)).toBe(true);
    expect(zoneDiffersFromArizona('Asia/Kolkata', JUL, 0)).toBe(true);
  });

  it('falls back to the device offset when the zone is unknown', () => {
    expect(zoneDiffersFromArizona(undefined, JAN, -420)).toBe(false);
    expect(zoneDiffersFromArizona('Not/AZone', JAN, -420)).toBe(false);
    expect(zoneDiffersFromArizona(undefined, JAN, 0)).toBe(true);
  });
});
