/** @jest-environment node */
import {
  archiveItems,
  getItem,
  getLatestLoggedOutfit,
  insertItem,
  listArchivedItems,
  listExpiredArchivedItems,
  listItems,
  listItemsByIds,
  listItemsInCategories,
  listLoggedOutfitsInRange,
  logOutfitWorn,
  recentWearDays,
  restoreItem,
  setItemFlags,
} from '../items';
import { draft, freshDb } from '../itemsTestHelpers';

describe('listItemsByIds', () => {
  it('returns nothing for an empty id list', async () => {
    const db = await freshDb();
    expect(await listItemsByIds(db, [])).toEqual([]);
  });

  it('resolves the requested items and ignores an id that no longer exists', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1');

    const found = await listItemsByIds(db, ['top1', 'bottom1', 'missing']);
    expect(found.map((i) => i.id).sort()).toEqual(['bottom1', 'top1']);
  });
});

describe('getLatestLoggedOutfit', () => {
  it('returns nothing for a date with no logs', async () => {
    const db = await freshDb();
    expect(await getLatestLoggedOutfit(db, '2026-08-20')).toEqual([]);
  });

  it('resolves the logged outfit to full items', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-20', 'log1', '2026-08-20T08:00:00Z');

    const outfit = await getLatestLoggedOutfit(db, '2026-08-20');
    expect(outfit.map((i) => i.id).sort()).toEqual(['bottom1', 'top1']);
  });

  it('returns the most recently logged outfit when several were logged the same day', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Top' }), 'top2');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-20', 'log1', '2026-08-20T08:00:00Z');
    await logOutfitWorn(db, ['top2', 'bottom1'], '2026-08-20', 'log2', '2026-08-20T18:00:00Z');

    const outfit = await getLatestLoggedOutfit(db, '2026-08-20');
    expect(outfit.map((i) => i.id).sort()).toEqual(['bottom1', 'top2']);
  });
});

describe('listLoggedOutfitsInRange', () => {
  it('returns an empty map when nothing was logged in range', async () => {
    const db = await freshDb();
    expect(await listLoggedOutfitsInRange(db, '2026-08-01', '2026-08-28')).toEqual(new Map());
  });

  it('maps each logged day to its items, and excludes days outside the range', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-10', 'log1');
    await logOutfitWorn(db, ['top1'], '2026-07-31', 'log-before'); // outside range
    await logOutfitWorn(db, ['bottom1'], '2026-08-29', 'log-after'); // outside range

    const result = await listLoggedOutfitsInRange(db, '2026-08-01', '2026-08-28');
    expect([...result.keys()]).toEqual(['2026-08-10']);
    expect(result.get('2026-08-10')?.map((i) => i.id).sort()).toEqual(['bottom1', 'top1']);
  });

  it('resolves each day to its most recently logged outfit when logged more than once', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Top' }), 'top2');

    await logOutfitWorn(db, ['top1'], '2026-08-10', 'log1', '2026-08-10T08:00:00Z');
    await logOutfitWorn(db, ['top2'], '2026-08-10', 'log2', '2026-08-10T18:00:00Z');

    const result = await listLoggedOutfitsInRange(db, '2026-08-01', '2026-08-28');
    expect(result.get('2026-08-10')?.map((i) => i.id)).toEqual(['top2']);
  });
});

describe('archiveItems / restoreItem / listArchivedItems / listExpiredArchivedItems', () => {
  it('excludes archived items from listItems and listItemsInCategories', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Top' }), 'top2');

    await archiveItems(db, ['top1']);

    expect((await listItems(db)).map((i) => i.id)).toEqual(['top2']);
    expect((await listItemsInCategories(db, ['Top'])).map((i) => i.id)).toEqual(['top2']);
  });

  it('still resolves an archived item by id, since getItem is a direct lookup', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await archiveItems(db, ['top1']);

    expect((await getItem(db, 'top1'))?.id).toBe('top1');
  });

  it('archives a batch in one call, stamping every id with the same timestamp', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await archiveItems(db, ['top1', 'bottom1'], '2026-08-01T00:00:00.000Z');

    const archived = await listArchivedItems(db);
    expect(archived.map((i) => i.id).sort()).toEqual(['bottom1', 'top1']);
    expect(archived.every((i) => i.archivedAt === '2026-08-01T00:00:00.000Z')).toBe(true);
  });

  it('does nothing for an empty id list', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');

    await archiveItems(db, []);

    expect(await listArchivedItems(db)).toEqual([]);
  });

  it('restores an archived item back into the ordinary listings', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await archiveItems(db, ['top1']);

    await restoreItem(db, 'top1');

    expect((await listItems(db)).map((i) => i.id)).toEqual(['top1']);
    expect(await listArchivedItems(db)).toEqual([]);
  });

  it('lists only items archived at or before the cutoff, oldest first', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'old');
    await insertItem(db, draft({ category: 'Top' }), 'boundary');
    await insertItem(db, draft({ category: 'Top' }), 'recent');
    await archiveItems(db, ['old'], '2026-06-01T00:00:00.000Z');
    await archiveItems(db, ['boundary'], '2026-07-01T00:00:00.000Z');
    await archiveItems(db, ['recent'], '2026-08-01T00:00:00.000Z');

    const expired = await listExpiredArchivedItems(db, '2026-07-01T00:00:00.000Z');

    expect(expired.map((i) => i.id)).toEqual(['old', 'boundary']);
  });
});

describe('setItemFlags', () => {
  it('sets isSecondHand true for a whole batch in one call', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await setItemFlags(db, ['top1', 'bottom1'], { isSecondHand: true });

    expect((await getItem(db, 'top1'))?.isSecondHand).toBe(true);
    expect((await getItem(db, 'bottom1'))?.isSecondHand).toBe(true);
  });

  it('sets isWorkAppropriate true for a whole batch in one call', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await setItemFlags(db, ['top1', 'bottom1'], { isWorkAppropriate: true });

    expect((await getItem(db, 'top1'))?.isWorkAppropriate).toBe(true);
    expect((await getItem(db, 'bottom1'))?.isWorkAppropriate).toBe(true);
  });

  it('sets both flags at once when both are given', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');

    await setItemFlags(db, ['top1'], { isSecondHand: true, isWorkAppropriate: true });

    const item = await getItem(db, 'top1');
    expect(item?.isSecondHand).toBe(true);
    expect(item?.isWorkAppropriate).toBe(true);
  });

  it('leaves items outside the id list untouched', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Top' }), 'top2');

    await setItemFlags(db, ['top1'], { isWorkAppropriate: true });

    expect((await getItem(db, 'top2'))?.isWorkAppropriate).toBe(false);
  });

  it('does nothing for an empty id list', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');

    await expect(setItemFlags(db, [], { isSecondHand: true })).resolves.toBeUndefined();

    expect((await getItem(db, 'top1'))?.isSecondHand).toBe(false);
  });
});

describe('recentWearDays', () => {
  it('maps each item to days since its most recent log within the window', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-a'], '2026-08-25', 'log-1', '2026-08-25T09:00:00.000Z');
    await logOutfitWorn(db, ['item-b'], '2026-08-29', 'log-2', '2026-08-29T09:00:00.000Z');

    const result = await recentWearDays(db, '2026-08-31');

    expect(result.get('item-a')).toBe(6);
    expect(result.get('item-b')).toBe(2);
  });

  it('keeps the smallest days-ago when an item appears in multiple logs', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-a'], '2026-08-20', 'log-1', '2026-08-20T09:00:00.000Z');
    await logOutfitWorn(db, ['item-a'], '2026-08-29', 'log-2', '2026-08-29T09:00:00.000Z');

    const result = await recentWearDays(db, '2026-08-31');

    expect(result.get('item-a')).toBe(2);
  });

  it('excludes items worn outside the window', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-old'], '2026-07-01', 'log-1', '2026-07-01T09:00:00.000Z');

    const result = await recentWearDays(db, '2026-08-31', 30);

    expect(result.has('item-old')).toBe(false);
  });

  it('returns an empty map when nothing has been logged', async () => {
    const db = await freshDb();
    const result = await recentWearDays(db, '2026-08-31');
    expect(result.size).toBe(0);
  });

  it('throws when today is malformed', async () => {
    const db = await freshDb();
    await expect(recentWearDays(db, 'not-a-date')).rejects.toThrow('Invalid recent-wear query');
    await expect(recentWearDays(db, '2026-13-01')).rejects.toThrow('Invalid recent-wear query');
  });

  it('throws when windowDays is negative or non-finite', async () => {
    const db = await freshDb();
    await expect(recentWearDays(db, '2026-08-31', -1)).rejects.toThrow('Invalid recent-wear query');
    await expect(recentWearDays(db, '2026-08-31', NaN)).rejects.toThrow('Invalid recent-wear query');
    await expect(recentWearDays(db, '2026-08-31', Infinity)).rejects.toThrow('Invalid recent-wear query');
  });

  it('throws when windowDays is fractional or exceeds the domain-appropriate maximum', async () => {
    const db = await freshDb();
    await expect(recentWearDays(db, '2026-08-31', 30.5)).rejects.toThrow('Invalid recent-wear query');
    await expect(recentWearDays(db, '2026-08-31', 367)).rejects.toThrow('Invalid recent-wear query');
    // The boundary itself is still valid.
    await expect(recentWearDays(db, '2026-08-31', 366)).resolves.toBeInstanceOf(Map);
  });

  it('skips rows with future dates', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-a'], '2026-08-25', 'log-past', '2026-08-25T09:00:00.000Z');
    // Manually insert a future-dated row
    await db.runAsync(
      'INSERT INTO Outfit_Logs (id, date, itemIds, collageImageUri, createdAt) VALUES (?, ?, ?, ?, ?)',
      ['log-future', '2026-09-01', '["item-c"]', '', '2026-08-31T09:00:00.000Z'],
    );

    const result = await recentWearDays(db, '2026-08-31');

    expect(result.has('item-c')).toBe(false);
    expect(result.get('item-a')).toBe(6);
  });
});
