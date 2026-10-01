import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findProhibitedPublicClaims } from '../../scripts/check-public-copy.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_ROOTS = ['app', 'components', 'hooks', 'lib', 'services', 'stores'];

describe('public copy policy', () => {
  it.each([
    ['guaranteed', '<p>Your return is guaranteed.</p>'],
    ['risk free', '<p>This is risk-free.</p>'],
    ['every cent back', '<p>Get every cent back.</p>'],
    ['learn-to-earn', '<p>Learn to earn.</p>'],
  ])('detects %s in rendered literals', (claim, source) => {
    expect(findProhibitedPublicClaims(`export const Page = () => (${source});`)).toEqual([
      expect.objectContaining({ claim }),
    ]);
  });

  it('ignores developer comments because they are not rendered copy', () => {
    expect(findProhibitedPublicClaims('// This would be guaranteed if the guard were removed.'))
      .toEqual([]);
  });

  it('runs the policy scan when invoked through a symlink', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'locked-in-public-copy-'));
    try {
      mkdirSync(join(fixtureRoot, 'scripts'));
      for (const sourceRoot of SOURCE_ROOTS) mkdirSync(join(fixtureRoot, sourceRoot));

      const fixtureScript = join(fixtureRoot, 'scripts', 'check-public-copy.mjs');
      copyFileSync(join(WEB_ROOT, 'scripts', 'check-public-copy.mjs'), fixtureScript);
      // Keep the fixture isolated while resolving the script's existing dependency.
      symlinkSync(join(WEB_ROOT, 'node_modules'), join(fixtureRoot, 'node_modules'), 'dir');
      writeFileSync(
        join(fixtureRoot, 'app', 'page.tsx'),
        'export const Page = () => <p>Your return is guaranteed.</p>;\n',
      );

      const linkedScript = join(fixtureRoot, 'linked-check-public-copy.mjs');
      symlinkSync(fixtureScript, linkedScript);
      const result = spawnSync(process.execPath, [linkedScript], {
        cwd: fixtureRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'app/page.tsx:1 contains prohibited public copy: guaranteed',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
