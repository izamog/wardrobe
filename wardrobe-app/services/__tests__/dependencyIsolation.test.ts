/**
 * @jest-environment node
 *
 * Proves the accepted image-size vulnerability (see .trivyignore at the repo
 * root) stays confined to Metro's build-time bundler and never becomes
 * reachable from application source, which is the whole basis the risk
 * acceptance rests on: image-size never touches a photo the app itself
 * decodes (background removal, crop, flip all go through
 * expo-image-manipulator — see services/images.ts), only files Metro's own
 * bundling process touches on the developer's machine.
 *
 * If this ever fails, someone has added a direct or re-exported dependency
 * on image-size to application code — the .trivyignore's reasoning no
 * longer holds at that point, and needs re-evaluating, not silencing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every top-level directory that is application source, not build tooling or generated output. */
const SOURCE_DIRS = ['components', 'hooks', 'navigation', 'screens', 'services', 'utils'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

describe('image-size dependency isolation', () => {
  it('is never imported or required by application source', () => {
    // services/__tests__/dependencyIsolation.test.ts -> wardrobe-app/
    const appRoot = join(__dirname, '..', '..');
    const files = SOURCE_DIRS.flatMap((dir) => {
      const full = join(appRoot, dir);
      return statSync(full).isDirectory() ? collectSourceFiles(full) : [];
    });
    expect(files.length).toBeGreaterThan(0); // a directory-typo here would otherwise pass vacuously

    const offenders = files.filter((file) => /['"]image-size(\/|['"])/.test(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });
});
