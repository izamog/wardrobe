import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { ATTRIBUTE_FIELDS, type AttributeField, type AttributeValues } from '../components/AttributeList';
import { refineCapturedImage, type PickedImage } from '../services/images';
import type { ItemProposal } from '../utils/proposals';

/**
 * Where the add flow has got to.
 *
 * Two steps: the photo, then everything else on one screen. Voice used to be a
 * page of its own, which meant describing a garment you could no longer see.
 */
export type Stage = { step: 'capture' } | { step: 'compose'; imageUri: string };

/**
 * A refinement running in the background, if one is.
 *
 * Held as a promise rather than a boolean so saving can wait on the same work
 * the screen is already doing, instead of racing it and storing the rougher
 * crop.
 */
type Refinement = Promise<void> | null;

/**
 * Delay between one heard attribute landing in the list and the next.
 *
 * The values arrive together; they are applied in sequence so the list fills
 * in visibly rather than changing in one jump. Slow enough to follow, fast
 * enough that six of them are done inside a second.
 */
const APPLY_INTERVAL_MS = 180;

/** Which proposal field feeds which row. */
const FIELD_SOURCES: Record<AttributeField, (p: ItemProposal) => Partial<AttributeValues> | null> = {
  category: (p) => (p.category === undefined ? null : { category: p.category }),
  brand: (p) => (p.brand === undefined ? null : { brand: p.brand }),
  cost: (p) => (p.costMinorUnits === undefined ? null : { costMinorUnits: p.costMinorUnits }),
  colors: (p) =>
    p.primaryColor === undefined
      ? null
      : { primaryColor: p.primaryColor, secondaryColor: p.secondaryColor ?? '' },
  isSecondHand: (p) => (p.isSecondHand === undefined ? null : { isSecondHand: p.isSecondHand }),
  materials: (p) => (p.materials === undefined ? null : { materials: p.materials }),
};

/**
 * Applies a heard voice proposal to the form, one attribute at a time.
 *
 * Pulled out of AddItemScreen because the timer bookkeeping is the single
 * largest thing that screen was doing, not because it is reused anywhere.
 */
export function useProposalApplier({
  setValues,
  setPending,
  setSilent,
  categoryTouched,
}: {
  setValues: Dispatch<SetStateAction<AttributeValues>>;
  setPending: Dispatch<SetStateAction<ReadonlySet<AttributeField>>>;
  setSilent: Dispatch<
    SetStateAction<
      Pick<ItemProposal, 'inferredWarmth' | 'inferredWind' | 'hardwareColor' | 'hasBeltLoops'>
    >
  >;
  categoryTouched: MutableRefObject<boolean>;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  return useCallback(
    (next: ItemProposal) => {
      setSilent({
        inferredWarmth: next.inferredWarmth,
        inferredWind: next.inferredWind,
        hardwareColor: next.hardwareColor,
        hasBeltLoops: next.hasBeltLoops,
      });

      // field is AttributeField, a closed union checked against FIELD_SOURCES's
      // keys — not external input, so this isn't a dynamic-dispatch risk.
      // nosemgrep
      const heard = ATTRIBUTE_FIELDS.filter((field) => FIELD_SOURCES[field](next) !== null);
      if (heard.length === 0) return;

      if (timer.current) clearInterval(timer.current);
      // A fresh recording supersedes the previous one, so old confirmations no
      // longer refer to anything.
      setPending(new Set());

      let index = 0;
      timer.current = setInterval(() => {
        const field = heard[index];
        if (field === 'category') categoryTouched.current = true;
        // field comes from `heard`, itself filtered from ATTRIBUTE_FIELDS above
        // — same closed AttributeField union, not external input.
        // nosemgrep
        setValues((current) => ({ ...current, ...FIELD_SOURCES[field](next) }));
        setPending((current) => new Set(current).add(field));

        index += 1;
        if (index >= heard.length && timer.current) clearInterval(timer.current);
      }, APPLY_INTERVAL_MS);
    },
    [setValues, setPending, setSilent, categoryTouched],
  );
}

/**
 * Runs the background crop/detection for a captured photo.
 *
 * Returns the in-flight promise as well as the starter, so save() can await
 * whichever refinement is running without owning the ref itself.
 */
export function useImageRefiner({
  alive,
  categoryTouched,
  setStage,
  setValues,
  setRefining,
}: {
  alive: MutableRefObject<boolean>;
  categoryTouched: MutableRefObject<boolean>;
  setStage: Dispatch<SetStateAction<Stage>>;
  setValues: Dispatch<SetStateAction<AttributeValues>>;
  setRefining: Dispatch<SetStateAction<boolean>>;
}) {
  const refinement = useRef<Refinement>(null);

  const startRefinement = useCallback(
    (source: PickedImage) => {
      setRefining(true);
      refinement.current = (async () => {
        const refined = await refineCapturedImage(source);
        if (!alive.current) return;

        if (refined.uri) setStage({ step: 'compose', imageUri: refined.uri });
        if (refined.detectedCategory && !categoryTouched.current) {
          setValues((current) => ({ ...current, category: refined.detectedCategory! }));
        }
        setRefining(false);
      })();
    },
    [alive, categoryTouched, setStage, setValues, setRefining],
  );

  return { refinement, startRefinement };
}
