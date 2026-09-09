/** @jest-environment node */
import { itemsToCsv } from '../wardrobeExport';
import { item, resetSeq } from '../outfitGeneratorTestHelpers';

beforeEach(() => resetSeq());

describe('itemsToCsv', () => {
  it('writes the header row even with no items', () => {
    const csv = itemsToCsv([]);
    expect(csv).toBe(
      'brand,category,primaryColor,secondaryColor,material1,material1Percent,material2,material2Percent,' +
        'hardwareColor,hasBeltLoops,sleeveLength,length,thickness,denier,backless,inferredWarmth,inferredWind,' +
        'isWorkAppropriate',
    );
  });

  it('writes one row per item, in the order given', () => {
    const jeans = {
      ...item('Pants', { inferredWarmth: 5, inferredWind: 2, length: 'Long' }),
      brand: 'Levi',
      primaryColor: 'Blue' as const,
      materials: [{ material: 'Denim', percent: 100 }],
    };
    const scarf = {
      ...item('Scarf', { inferredWarmth: 6, inferredWind: 1 }),
      brand: 'Uniqlo',
      primaryColor: 'Grey' as const,
      materials: [{ material: 'Wool', percent: 70 }, { material: 'Cashmere', percent: 30 }],
    };

    const rows = itemsToCsv([jeans, scarf]).split('\r\n');

    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe(
      'Levi,Pants,Blue,,Denim,100,,,None,false,Short,Long,Regular,0,false,5,2,false',
    );
    expect(rows[2]).toBe(
      'Uniqlo,Scarf,Grey,,Wool,70,Cashmere,30,None,false,Short,,Regular,0,false,6,1,false',
    );
  });

  it('quotes a field containing a comma, and doubles an internal quote', () => {
    const top = { ...item('Top'), brand: 'Smith, & Sons "Classic"' };

    const rows = itemsToCsv([top]).split('\r\n');

    expect(rows[1].startsWith('"Smith, & Sons ""Classic"""')).toBe(true);
  });

  it('leaves an item with no materials as empty material columns, not undefined text', () => {
    const belt = { ...item('Belt'), brand: 'X' };

    const rows = itemsToCsv([belt]).split('\r\n');

    expect(rows[1]).toBe('X,Belt,,,,,,,None,false,Short,,Regular,0,false,0,0,false');
  });

  it('neutralizes a value that would be read as a spreadsheet formula, without breaking a legitimate value', () => {
    const formulaBrand = { ...item('Top'), brand: '=1+1' };
    const plusBrand = { ...item('Top'), brand: '+HYPERLINK("evil.example")' };
    const ordinaryBrand = { ...item('Top'), brand: 'Uniqlo-Basics' };

    const rows = itemsToCsv([formulaBrand, plusBrand, ordinaryBrand]).split('\r\n');

    expect(rows[1].startsWith("'=1+1,")).toBe(true);
    // Contains a double quote, so it's also RFC 4180-quoted on top of the
    // formula-neutralizing prefix.
    expect(rows[2].startsWith('"\'+HYPERLINK')).toBe(true);
    // A hyphen mid-value (not leading the field) is never touched.
    expect(rows[3].startsWith('Uniqlo-Basics,')).toBe(true);
  });
});
