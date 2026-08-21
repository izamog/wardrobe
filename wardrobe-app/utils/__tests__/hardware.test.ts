import { hardwareColorsCompatible } from '../hardware';

describe('hardwareColorsCompatible', () => {
  it('matches every finish with itself', () => {
    for (const hw of ['Gold', 'Silver', 'Brass', 'Black'] as const) {
      expect(hardwareColorsCompatible(hw, hw)).toBe(true);
    }
  });

  it('pairs Gold with Brass, in either order', () => {
    expect(hardwareColorsCompatible('Gold', 'Brass')).toBe(true);
    expect(hardwareColorsCompatible('Brass', 'Gold')).toBe(true);
  });

  it('pairs Silver with Black, in either order', () => {
    expect(hardwareColorsCompatible('Silver', 'Black')).toBe(true);
    expect(hardwareColorsCompatible('Black', 'Silver')).toBe(true);
  });

  it('rejects a warm finish paired with a cool one', () => {
    expect(hardwareColorsCompatible('Gold', 'Silver')).toBe(false);
    expect(hardwareColorsCompatible('Gold', 'Black')).toBe(false);
    expect(hardwareColorsCompatible('Brass', 'Silver')).toBe(false);
    expect(hardwareColorsCompatible('Brass', 'Black')).toBe(false);
  });

  it('treats None as compatible with anything, in either position', () => {
    expect(hardwareColorsCompatible('None', 'Gold')).toBe(true);
    expect(hardwareColorsCompatible('Silver', 'None')).toBe(true);
    expect(hardwareColorsCompatible('None', 'None')).toBe(true);
  });
});
