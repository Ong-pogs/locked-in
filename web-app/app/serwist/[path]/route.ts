import { spawnSync } from 'node:child_process';
import { createSerwistRoute } from '@serwist/turbopack';

// Revision for precache versioning — uses git commit hash
const revision =
  spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout?.trim() ??
  crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: '/~offline', revision }],
    // Background music (3-4 MB per track) is never precached: it streams on
    // demand and the runtime audio cache keeps it after first play. Listing it
    // here makes that explicit (it used to surface as a "too large" warning).
    // The first entry is Serwist's own default, kept because this replaces it.
    globIgnores: ['**/node_modules/**/*', 'public/bgm/**'],
    swSrc: 'app/sw.ts',
    useNativeEsbuild: true,
  });
