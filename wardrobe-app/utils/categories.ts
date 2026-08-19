import { Category } from '../types/wardrobe';

export const ALL_CATEGORIES: Category[] = [
  'Top',
  'Bottom',
  'Outerwear',
  'Shoes',
  'Belt',
  'Bag',
  'Scarf',
];

/**
 * Returns valid, complementary categories for a given source category.
 * Prevents comparing items of the exact same category (e.g. Trousers vs Trousers).
 */
export function getComplementaryCategories(sourceCategory: Category): Category[] {
  switch (sourceCategory) {
    case 'Bottom':
      return ['Top', 'Outerwear', 'Shoes', 'Belt', 'Bag', 'Scarf'];
    case 'Top':
      return ['Bottom', 'Outerwear', 'Shoes', 'Belt', 'Bag', 'Scarf'];
    case 'Outerwear':
      return ['Top', 'Bottom', 'Shoes', 'Belt', 'Bag', 'Scarf'];
    case 'Shoes':
      return ['Top', 'Bottom', 'Outerwear', 'Belt', 'Bag', 'Scarf'];
    case 'Belt':
      return ['Top', 'Bottom', 'Outerwear', 'Shoes', 'Bag', 'Scarf'];
    case 'Bag':
    case 'Scarf':
      return ['Top', 'Bottom', 'Outerwear', 'Shoes', 'Belt'];
    default:
      return ALL_CATEGORIES.filter((cat) => cat !== sourceCategory);
  }
}
