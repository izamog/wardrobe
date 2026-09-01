/** @jest-environment node */
import { buildSlots, tightsEligible, TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR } from '../outfitSlots';
import type { OutfitCandidates } from '../outfitCandidatePools';
import type { ClothingItem } from '../../types/wardrobe';

function anchor(overrides: Partial<ClothingItem> = {}): ClothingItem {
  return {
    id: 'a',
    imagePath: '',
    originalImagePath: '',
    imageMarginBaked: false,
    category: 'Pants',
    brand: '',
    costMinorUnits: 0,
    isSecondHand: false,
    purchasedAt: '',
    materials: [],
    primaryColor: '',
    secondaryColor: '',
    hardwareColor: 'None',
    hasBeltLoops: false,
    sleeveLength: 'Short',
    length: '',
    thickness: 'Regular',
    denier: 0,
    backless: false,
    inferredWarmth: 0,
    inferredWind: 0,
    wearCount: 0,
    createdAt: '',
    archivedAt: '',
    isWorkAppropriate: false,
    ...overrides,
  };
}

describe('tightsEligible', () => {
  it('is false at warmthFloor 0, regardless of anchor category', () => {
    expect(tightsEligible(anchor({ category: 'Skirt' }), 0)).toBe(false);
    expect(tightsEligible(anchor({ category: 'Dress' }), 0)).toBe(false);
  });

  it('is true under a Skirt or Dress anchor whenever warmthFloor is above 0', () => {
    expect(tightsEligible(anchor({ category: 'Skirt' }), 1)).toBe(true);
    expect(tightsEligible(anchor({ category: 'Dress' }), 1)).toBe(true);
  });

  it('is true under Pants/Leggings only above TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR', () => {
    expect(tightsEligible(anchor({ category: 'Pants' }), TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR)).toBe(false);
    expect(tightsEligible(anchor({ category: 'Pants' }), TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR + 1)).toBe(true);
    expect(tightsEligible(anchor({ category: 'Leggings' }), TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR + 1)).toBe(true);
  });
});

function emptyCandidates(overrides: Partial<OutfitCandidates> = {}): OutfitCandidates {
  return {
    bottoms: [],
    tops: [],
    shoes: [],
    outerwear: [],
    scarves: [],
    belts: [],
    bags: [],
    tights: [],
    ...overrides,
  };
}

describe('buildSlots includeWarmthAccessories', () => {
  it('includes Scarf and Tights slots by default, exactly like today, when a scarf/tights are eligible', () => {
    const scarf = anchor({ id: 'scarf-1', category: 'Scarf' });
    const tights = anchor({ id: 'tights-1', category: 'Tights' });
    const skirtAnchor = anchor({ id: 'skirt-1', category: 'Skirt' });
    const candidates = emptyCandidates({ scarves: [scarf], tights: [tights] });

    const slots = buildSlots(candidates, skirtAnchor, 10, true, false);

    const allCandidateIds = slots.flatMap((s) => s.candidates.map((c) => c.id));
    expect(allCandidateIds).toContain('scarf-1');
    expect(allCandidateIds).toContain('tights-1');
  });

  it('omits Scarf and Tights slots entirely when includeWarmthAccessories is false, even when both are eligible', () => {
    const scarf = anchor({ id: 'scarf-1', category: 'Scarf' });
    const tights = anchor({ id: 'tights-1', category: 'Tights' });
    const skirtAnchor = anchor({ id: 'skirt-1', category: 'Skirt' });
    const candidates = emptyCandidates({ scarves: [scarf], tights: [tights] });

    const slots = buildSlots(candidates, skirtAnchor, 10, true, false, new Map(), {
      includeWarmthAccessories: false,
    });

    const allCandidateIds = slots.flatMap((s) => s.candidates.map((c) => c.id));
    expect(allCandidateIds).not.toContain('scarf-1');
    expect(allCandidateIds).not.toContain('tights-1');
  });
});

describe('buildSlots topCandidatesOverride', () => {
  it('uses the override list for the Top slot instead of computing its own pool', () => {
    const overrideTop = anchor({ id: 'override-top', category: 'Shirt' });
    const realTop = anchor({ id: 'real-top', category: 'Shirt' });
    const pantsAnchor = anchor({ id: 'pants-1', category: 'Pants' });
    const candidates = emptyCandidates({ tops: [realTop] });

    const slots = buildSlots(candidates, pantsAnchor, 5, false, false, new Map(), {
      topCandidatesOverride: [overrideTop],
    });

    const topSlot = slots[0]; // Top is always the first slot buildSlots returns
    expect(topSlot.candidates.map((c) => c.id)).toEqual(['override-top']);
  });

  it('falls back to the normal Top pool when no override is given', () => {
    const realTop = anchor({ id: 'real-top', category: 'Shirt' });
    const pantsAnchor = anchor({ id: 'pants-1', category: 'Pants' });
    const candidates = emptyCandidates({ tops: [realTop] });

    const slots = buildSlots(candidates, pantsAnchor, 5, false, false);

    expect(slots[0].candidates.map((c) => c.id)).toEqual(['real-top']);
  });
});
