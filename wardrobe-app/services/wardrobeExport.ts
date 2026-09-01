import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { itemsToCsv } from '../utils/wardrobeExport';
import type { ClothingItem } from '../types/wardrobe';

/**
 * Writes the wardrobe CSV to the cache directory and hands it to the native
 * share sheet, so the user can save it, AirDrop it, email it, or however
 * else they'd rather get it off the device — same reasoning as
 * services/images.ts for keeping filesystem/native calls out of utils/
 * wardrobeExport.ts's pure CSV logic: this file isn't unit-testable
 * off-device, everything in it has to be verified by running the app.
 *
 * Paths.cache, not Paths.document: this is a one-off, throwaway export, not
 * app data that needs to survive between launches the way item photos do.
 *
 * @throws if the device has no share sheet available (Sharing.isAvailableAsync()).
 */
export async function exportWardrobeCsv(items: readonly ClothingItem[]): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device.');

  const file = new File(Paths.cache, 'wardrobe-export.csv');
  if (file.exists) file.delete();
  file.create();
  file.write(itemsToCsv(items));

  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
}
