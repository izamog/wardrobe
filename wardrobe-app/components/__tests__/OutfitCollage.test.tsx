import React from 'react';
import { create, act, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { Image } from 'react-native';
import { OutfitCollage } from '../OutfitCollage';
import { collageLayout } from '../../utils/outfitCollageLayout';
import type { Category, ClothingItem } from '../../types/wardrobe';

// services/images.ts touches expo-file-system directly and, per AGENTS.md, is
// "not unit-testable off-device" — OutfitCollage's whole contract with it is
// "give me a uri for this path", so that's the boundary stubbed here rather
// than the native module underneath it.
jest.mock('../../services/images', () => ({
  imageUriFor: (path: string) => (path ? `file:///mock/${path}` : null),
}));

function makeItem(id: string, category: Category, imagePath = `${id}.png`): ClothingItem {
  return {
    id,
    imagePath,
    originalImagePath: '',
    imageMarginBaked: false,
    thickness: 'Regular',
    denier: 0,
    backless: false,
    primaryColor: '',
    secondaryColor: '',
    category,
    brand: '',
    costMinorUnits: 0,
    isSecondHand: false,
    purchasedAt: '',
    materials: [],
    hardwareColor: 'None',
    hasBeltLoops: false,
    sleeveLength: 'Short',
    length: '',
    inferredWarmth: 0,
    inferredWind: 0,
    wearCount: 0,
    createdAt: 'now',
    archivedAt: '',
    isWorkAppropriate: false,
  };
}

function renderCollage(items: ClothingItem[]): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<OutfitCollage items={items} />);
  });
  return tree;
}

describe('OutfitCollage', () => {
  it('renders one Image per item that has a cutout', () => {
    const jacket = makeItem('jacket', 'Jacket');
    const pants = makeItem('pants', 'Pants');
    const shoes = makeItem('shoes', 'Shoes');
    const tree = renderCollage([jacket, pants, shoes]);
    expect(tree.root.findAllByType(Image)).toHaveLength(3);
  });

  it('wraps a non-cutout .jpg item in a flat paper-toned backing instead of rendering it bare', () => {
    const plainPhoto = makeItem('plain', 'Shoes', 'plain.jpg');
    const tree = renderCollage([plainPhoto]);
    const image = tree.root.findByType(Image);
    // The backing is the View directly around the Image; the bare cutout
    // path renders the Image as its positioned cell's only child. Borderless
    // per design.md's box-in-box rule — this is a flat backing, not a
    // decorative bordered card, so it carries `bg-paper` and nothing else
    // that would read as a second box nested on the canvas.
    const wrapper = image.parent as ReactTestInstance;
    expect(wrapper.type).toBe('View');
    const className = String(wrapper.props.className ?? '');
    expect(className).toContain('bg-paper');
    expect(className).not.toContain('border');
  });

  it('does not wrap a .png cutout in the paper-toned backing', () => {
    const cutout = makeItem('cutout', 'Shoes', 'cutout.png');
    const tree = renderCollage([cutout]);
    const image = tree.root.findByType(Image);
    const wrapper = image.parent as ReactTestInstance;
    // Immediate parent is the row cell itself (a positioned View with no
    // className), not an extra backing View.
    expect(String(wrapper.props.className ?? '')).not.toContain('bg-paper');
  });

  it('renders nothing for an item with no resolvable image uri', () => {
    const noPhoto = makeItem('none', 'Belt', '');
    const tree = renderCollage([noPhoto]);
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
  });

  it('renders an empty canvas for an empty outfit without throwing', () => {
    expect(() => renderCollage([])).not.toThrow();
  });

  it('carries a width-only item\'s SlotRect percentages through to the actual rendered style, unchanged', () => {
    // A regression guard for a real bug: outfitCollageLayout.ts's numbers can
    // be exactly right while something between there and the native style
    // prop still silently loses or alters them (see GENEROUS_FREE_AXIS's own
    // doc comment for the incident this guards against — computed geometry
    // that was never actually verified against the rendered component).
    const top = makeItem('top', 'Top');
    const [expected] = collageLayout([top]);

    const tree = renderCollage([top]);
    const image = tree.root.findByType(Image);
    const wrapper = image.parent as ReactTestInstance;

    expect(wrapper.props.style).toEqual({
      position: 'absolute',
      top: `${expected.top}%`,
      left: `${expected.left}%`,
      width: `${expected.width}%`,
      height: `${expected.height}%`,
      zIndex: expected.z,
    });
  });

  it('renders every category at once — each has its own dedicated grid cell', () => {
    const items = [
      makeItem('jacket', 'Jacket'),
      makeItem('top', 'Sweater'),
      makeItem('pants', 'Pants'),
      makeItem('bag', 'Bag'),
      makeItem('shoes', 'Shoes'),
      makeItem('belt', 'Belt'),
      makeItem('scarf', 'Scarf'),
      makeItem('tights', 'Tights'),
    ];
    const tree = renderCollage(items);
    expect(tree.root.findAllByType(Image)).toHaveLength(8);
  });
});
