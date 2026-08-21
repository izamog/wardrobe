import type { ClothingItem } from '../types/wardrobe';

/**
 * How many closet items the outfit-photo vision call is offered as candidates.
 *
 * Every candidate is a second image in the prompt, so this is a budget on
 * latency and tokens as the wardrobe grows, not a design decision that hides
 * items from consideration. Recency is the only free ordering available: there
 * is no "last worn" timestamp to sort by (wearCount is a running total, not a
 * date), so the newest additions are what gets offered.
 */
export const MAX_OUTFIT_CANDIDATES = 30;

/**
 * Narrows the full closet to what the outfit-photo vision call is sent.
 *
 * Pure slice, kept as its own function so the choice of "newest first, capped"
 * is named and testable rather than inlined where the query result is read.
 */
export function selectOutfitCandidates(
  itemsNewestFirst: readonly ClothingItem[],
  limit: number = MAX_OUTFIT_CANDIDATES,
): ClothingItem[] {
  return itemsNewestFirst.slice(0, limit);
}

/**
 * Keeps only the ids that were actually offered to the model, in the order it
 * returned them, with duplicates dropped.
 *
 * The JSON schema already constrains the reply to an enum of candidate ids,
 * but a value is never trusted on the strength of "structured output"
 * guaranteeing it — structured output guarantees shape, not values. See
 * utils/proposals.ts and AGENTS.md's voice-ingestion note for the same rule
 * applied to the transcript pipeline.
 */
export function filterKnownIds(raw: unknown, validIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const kept: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && validIds.has(entry) && !kept.includes(entry)) {
      kept.push(entry);
    }
  }
  return kept;
}
