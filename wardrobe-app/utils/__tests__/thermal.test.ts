/** @jest-environment node */
import { warmthCeiling, warmthFloor, windFloor } from '../thermal';

describe('warmthFloor', () => {
  it('is 0 at the neutral temperature and above', () => {
    expect(warmthFloor(20)).toBe(0);
    expect(warmthFloor(25)).toBe(0);
  });

  it('rises as felt temperature drops', () => {
    const mild = warmthFloor(15);
    const cold = warmthFloor(0);
    const freezing = warmthFloor(-15);
    expect(mild).toBeGreaterThan(0);
    expect(cold).toBeGreaterThan(mild);
    expect(freezing).toBeGreaterThan(cold);
  });

  it('clamps at its maximum for extreme cold, and never goes negative for extreme heat', () => {
    expect(warmthFloor(-100)).toBe(warmthFloor(-40));
    expect(warmthFloor(40)).toBe(0);
  });
});

describe('warmthCeiling', () => {
  it('is always above its own floor at the same temperature', () => {
    for (const feltTempC of [30, 20, 10, 0, -10, -30]) {
      expect(warmthCeiling(feltTempC)).toBeGreaterThan(warmthFloor(feltTempC));
    }
  });

  it('stays tight on a hot day, so a warm single garment can be rejected on its own', () => {
    // A garment scoring the same as (or more than) the hot-day ceiling alone
    // should be able to fail the ceiling check without anything else added.
    expect(warmthCeiling(25)).toBeLessThan(10);
  });

  it('stays generously above the floor on a cold day, so bundling up is never penalised', () => {
    // The gap is a named constant (WARMTH_CEILING_SLACK); this pins down
    // that a cold ceiling is not clamped back down toward its floor.
    const coldFloor = warmthFloor(-15);
    const coldCeiling = warmthCeiling(-15);
    expect(coldCeiling).toBeGreaterThan(coldFloor + 3);
  });
});

describe('windFloor', () => {
  it('is 0 for still air, at any temperature', () => {
    expect(windFloor(0, 20)).toBe(0);
    expect(windFloor(0, -10)).toBe(0);
  });

  it('is 0 at a mild or warm felt temperature, however hard it is blowing', () => {
    // Regression: 22°C actual / 20°C felt / 19kph wind used to demand a wind
    // floor of 10 — requiring near-maximum wind-blocking construction on a
    // day a gentle breeze was genuinely no comfort problem at all. feltTempC
    // is already wind-chill-adjusted (see services/weather.ts), so wind gets
    // no separate say once it's this mild.
    expect(windFloor(19, 20)).toBe(0);
    expect(windFloor(60, 20)).toBe(0);
    expect(windFloor(30, 15)).toBe(0);
  });

  it('rises with wind speed once it is cold enough for wind to matter', () => {
    expect(windFloor(20, 0)).toBeGreaterThan(windFloor(5, 0));
  });

  it('rises with coldness at a fixed wind speed', () => {
    expect(windFloor(20, -10)).toBeGreaterThan(windFloor(20, 10));
  });

  it('clamps at its maximum for very strong, very cold wind', () => {
    expect(windFloor(200, -30)).toBe(windFloor(60, -30));
  });

  it('never goes negative for a felt temperature above neutral', () => {
    expect(windFloor(50, 35)).toBe(0);
  });
});
