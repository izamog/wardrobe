/** @jest-environment node */
import {
  canonicalPair,
  clearCompatibility,
  deleteItem,
  getCompatibility,
  getDismatchedPairKeys,
  getItem,
  getVerdictsFor,
  insertItem,
  listItemsWornOn,
  listRatedPairKeys,
  logOutfitWorn,
  removeOutfitLogs,
  replaceOutfitLog,
  setCompatibility,
  type ItemsDatabase,
} from '../items';
import { draft, freshDb } from '../itemsTestHelpers';

describe('deleteItem', () => {
  it('takes the item and its verdicts with it', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'bbb', 'now');
    await setVerdict(db, 'aaa', 'bbb');

    await deleteItem(db, 'aaa');

    expect(await getItem(db, 'aaa')).toBeNull();
    expect(await getVerdictsFor(db, 'bbb')).toEqual(new Map());
  });
});

// setCompatibility generates an id by default, which is a native call, so the
// tests always pass one.
let verdictSeq = 0;
const setVerdict = (
  db: ItemsDatabase,
  x: string,
  y: string,
  status: 'MATCH' | 'DISMATCH' = 'MATCH',
) => setCompatibility(db, x, y, status, `verdict-${verdictSeq++}`, '2026-01-01T00:00:00.000Z');

describe('compatibility', () => {
  it('stores a pair under one key whichever order it is given in', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'zzz', 'now');

    await setVerdict(db, 'zzz', 'aaa', 'MATCH');

    expect(await getCompatibility(db, 'aaa', 'zzz')).toBe('MATCH');
    expect(await getCompatibility(db, 'zzz', 'aaa')).toBe('MATCH');
  });

  it('replaces a verdict rather than failing the UNIQUE constraint', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'zzz', 'now');

    await setVerdict(db, 'aaa', 'zzz', 'MATCH');
    await setVerdict(db, 'zzz', 'aaa', 'DISMATCH');

    expect(await getCompatibility(db, 'aaa', 'zzz')).toBe('DISMATCH');
  });

  it('reports an unrated pair as null', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'zzz', 'now');

    expect(await getCompatibility(db, 'aaa', 'zzz')).toBeNull();
  });

  it('returns a pair to unrated when cleared', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'zzz', 'now');
    await setVerdict(db, 'aaa', 'zzz');

    await clearCompatibility(db, 'zzz', 'aaa');

    expect(await getCompatibility(db, 'aaa', 'zzz')).toBeNull();
  });

  it('keys verdicts by the other item, from either side of the pair', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'mmm', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Bag' }), 'zzz', 'now');

    // 'mmm' sorts after 'aaa' and before 'zzz', so it lands in a different
    // column in each row.
    await setVerdict(db, 'mmm', 'aaa', 'MATCH');
    await setVerdict(db, 'mmm', 'zzz', 'DISMATCH');

    expect(await getVerdictsFor(db, 'mmm')).toEqual(
      new Map([
        ['aaa', 'MATCH'],
        ['zzz', 'DISMATCH'],
      ]),
    );
  });
});

describe('canonicalPair', () => {
  it('orders a pair the same way regardless of argument order', () => {
    expect(canonicalPair('b', 'a')).toEqual(['a', 'b']);
    expect(canonicalPair('a', 'b')).toEqual(['a', 'b']);
  });
});

describe('getDismatchedPairKeys', () => {
  it('is empty for a fresh wardrobe with no ratings at all', async () => {
    const db = await freshDb();
    expect(await getDismatchedPairKeys(db)).toEqual(new Set());
  });

  it('includes only DISMATCH pairs, not MATCH ones', async () => {
    const db = await freshDb();
    const a = await insertItem(db, draft({ category: 'Top' }), 'aaa');
    const b = await insertItem(db, draft({ category: 'Pants' }), 'bbb');
    const c = await insertItem(db, draft({ category: 'Shoes' }), 'ccc');

    await setVerdict(db, a.id, b.id, 'MATCH');
    await setVerdict(db, a.id, c.id, 'DISMATCH');

    expect(await getDismatchedPairKeys(db)).toEqual(new Set(['aaa|ccc']));
    // A rated (but not dismatched) pair still counts as "rated" elsewhere —
    // the two sets answer different questions.
    expect(await listRatedPairKeys(db)).toEqual(new Set(['aaa|bbb', 'aaa|ccc']));
  });
});

describe('listItemsWornOn / logOutfitWorn', () => {
  it('reports nothing worn on a date with no logs', async () => {
    const db = await freshDb();
    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set());
  });

  it('records which items were worn on a date, and credits their wearCount', async () => {
    const db = await freshDb();
    const top = await insertItem(db, draft({ category: 'Top' }), 'top1');
    const bottom = await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await logOutfitWorn(db, [top.id, bottom.id], '2026-08-20', 'log1', '2026-08-20T08:00:00Z');

    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set(['top1', 'bottom1']));
    expect(await listItemsWornOn(db, '2026-08-21')).toEqual(new Set());

    expect((await getItem(db, 'top1'))?.wearCount).toBe(1);
    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(1);
  });

  it('unions items across multiple outfits logged the same day', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1');

    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-20', 'log1');
    await logOutfitWorn(db, ['bottom1', 'shoes1'], '2026-08-20', 'log2');

    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(
      new Set(['top1', 'bottom1', 'shoes1']),
    );
    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(2);
  });

  it('rolls back the whole write if any part of it fails', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');

    // 'missing' has no row, so its wearCount UPDATE affects zero rows but does
    // not itself throw — the log insert is what should still land. This test
    // instead forces a failure by reusing an id, which the PRIMARY KEY rejects.
    await logOutfitWorn(db, ['top1'], '2026-08-20', 'dup-log');
    await expect(logOutfitWorn(db, ['top1'], '2026-08-21', 'dup-log')).rejects.toThrow();

    // The failed second call must not have logged 2026-08-21 or double-counted
    // the wear it started to record.
    expect(await listItemsWornOn(db, '2026-08-21')).toEqual(new Set());
    expect((await getItem(db, 'top1'))?.wearCount).toBe(1);
  });
});

describe('removeOutfitLogs', () => {
  it('scrubs the logged outfit and decrements wearCount for each item', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-20', 'log1');

    await removeOutfitLogs(db, '2026-08-20');

    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set());
    expect((await getItem(db, 'top1'))?.wearCount).toBe(0);
    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(0);
  });

  it('decrements once per occurrence when an item appears in multiple logs that day', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await logOutfitWorn(db, ['bottom1'], '2026-08-20', 'log1');
    await logOutfitWorn(db, ['bottom1'], '2026-08-20', 'log2');
    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(2);

    await removeOutfitLogs(db, '2026-08-20');

    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(0);
  });

  it('never drops wearCount below zero', async () => {
    const db = await freshDb();
    const top = await insertItem(db, draft({ category: 'Top' }), 'top1');
    expect(top.wearCount).toBe(0);

    // Nothing logged for this date -- a no-op, not a negative wearCount.
    await removeOutfitLogs(db, '2026-08-20');

    expect((await getItem(db, 'top1'))?.wearCount).toBe(0);
  });

  it('leaves other dates and their wearCount untouched', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await logOutfitWorn(db, ['top1'], '2026-08-19', 'log-before');
    await logOutfitWorn(db, ['top1'], '2026-08-20', 'log-target');

    await removeOutfitLogs(db, '2026-08-20');

    expect(await listItemsWornOn(db, '2026-08-19')).toEqual(new Set(['top1']));
    expect((await getItem(db, 'top1'))?.wearCount).toBe(1);
  });

  it('rejects a malformed date rather than silently matching nothing', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await logOutfitWorn(db, ['top1'], '2026-08-20', 'log1');

    await expect(removeOutfitLogs(db, 'not-a-date')).rejects.toThrow();
    await expect(removeOutfitLogs(db, '2026-13-40')).rejects.toThrow();

    // The malformed calls must not have touched the real log.
    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set(['top1']));
    expect((await getItem(db, 'top1'))?.wearCount).toBe(1);
  });
});

describe('replaceOutfitLog', () => {
  it('replaces a previously-logged outfit rather than stacking a second one', async () => {
    // Reported bug: LogOutfitScreen's "Edit outfit" called logOutfitWorn
    // again on save, which -- correctly, per logOutfitWorn's own "unions
    // multiple outfits logged the same day" contract -- added a *second* log
    // row on top of the first instead of replacing it, double-crediting
    // wearCount for every re-picked item. replaceOutfitLog is what the
    // "edit a single day's outfit" UI should call instead.
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await insertItem(db, draft({ category: 'Sweater' }), 'top2');
    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-20', 'log1');

    await replaceOutfitLog(db, ['top2', 'bottom1'], '2026-08-20', 'log2');

    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set(['top2', 'bottom1']));
    // top1 was dropped by the edit -- its earlier credit is scrubbed, not left dangling.
    expect((await getItem(db, 'top1'))?.wearCount).toBe(0);
    // bottom1 was re-picked -- exactly one credit, not two.
    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(1);
    expect((await getItem(db, 'top2'))?.wearCount).toBe(1);
  });

  it('behaves like a plain log when nothing was previously logged that day', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');

    await replaceOutfitLog(db, ['top1'], '2026-08-20', 'log1');

    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set(['top1']));
    expect((await getItem(db, 'top1'))?.wearCount).toBe(1);
  });

  it('rolls back the whole replace if the insert half fails', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    // 'dup-log' is logged on a *different* date, so replaceOutfitLog's own
    // clear (scoped to 2026-08-20) never touches it -- it survives to make
    // the insert's id collide once replaceOutfitLog tries to reuse it below.
    await logOutfitWorn(db, ['top1'], '2026-08-19', 'dup-log');
    await logOutfitWorn(db, ['top1'], '2026-08-20', 'log-original');

    await expect(replaceOutfitLog(db, ['top1'], '2026-08-20', 'dup-log')).rejects.toThrow();

    // The clear must not have landed without its paired insert -- the
    // original 2026-08-20 log and its wearCount credit must still stand.
    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set(['top1']));
    expect((await getItem(db, 'top1'))?.wearCount).toBe(2);
  });

  it('rejects a malformed date rather than silently matching nothing', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await logOutfitWorn(db, ['top1'], '2026-08-20', 'log1');

    await expect(replaceOutfitLog(db, ['top1'], 'not-a-date')).rejects.toThrow();

    // Nothing should have been cleared or inserted for the real date.
    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set(['top1']));
    expect((await getItem(db, 'top1'))?.wearCount).toBe(1);
  });
});

