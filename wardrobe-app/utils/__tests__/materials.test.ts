/** @jest-environment node */
import { ALL_MATERIALS } from '../materials';

describe('ALL_MATERIALS', () => {
  it('is in alphabetical order, which is how the picker presents it', () => {
    expect([...ALL_MATERIALS]).toEqual([...ALL_MATERIALS].sort());
  });

  it('has no duplicates', () => {
    expect(new Set(ALL_MATERIALS).size).toBe(ALL_MATERIALS.length);
  });

  it('has no blank or untrimmed entries', () => {
    for (const material of ALL_MATERIALS) {
      expect(material).toBe(material.trim());
      expect(material.length).toBeGreaterThan(0);
    }
  });
});
