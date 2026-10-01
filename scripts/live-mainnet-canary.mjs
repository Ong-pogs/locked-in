#!/usr/bin/env node

/**
 * Read-only production canary for Locked In.
 *
 * It deliberately uses GET requests only. It never authenticates, builds a
 * transaction, submits a signature, changes data, or moves funds.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const productionConfig = JSON.parse(
  readFileSync(new URL('../config/mainnet-production.json', import.meta.url), 'utf8'),
);

export const DEFAULT_WEB = productionConfig.webOrigin;
export const DEFAULT_API = productionConfig.apiOrigin;
const EXPECTED_PROFILE = productionConfig.yieldProfile;
const EXPECTED_PROGRAM = productionConfig.programs.vaultV2;
const EXPECTED_USDC = productionConfig.solana.usdcMint;
const EXPECTED_GLOBAL_TVL_CAP_USDC = productionConfig.beta.globalTvlCapUsdc;
const MAX_APY_AGE_MS = 5 * 60 * 1000;
const MAX_APY_DIFFERENCE_BPS = 25;
const MIN_HSTS_MAX_AGE_SECONDS = 31_536_000;
const HOSTILE_ORIGIN = 'https://cors-probe.invalid';
const REQUIRED_PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'browsing-topics=()',
];
const PROHIBITED_PUBLIC_CLAIMS = [
  'guaranteed',
  'risk free',
  'risk-free',
  'every cent back',
  'learn-to-earn',
  'learn to earn',
];

export function parseArgs(args) {
  const parsed = {
    webOrigin: DEFAULT_WEB,
    apiOrigin: DEFAULT_API,
    timeoutMs: 45_000,
    expectedRevision: process.env.LOCKED_IN_EXPECTED_REVISION?.trim() || null,
    jsonOutput: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      parsed.jsonOutput = true;
      continue;
    }
    if (arg === '--help') {
      parsed.help = true;
      continue;
    }
    if (
      arg === '--web' ||
      arg === '--api' ||
      arg === '--timeout' ||
      arg === '--expected-revision'
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      if (arg === '--web') parsed.webOrigin = value;
      if (arg === '--api') parsed.apiOrigin = value;
      if (arg === '--timeout') parsed.timeoutMs = Number(value);
      if (arg === '--expected-revision') parsed.expectedRevision = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function responseTarget(response) {
  try {
    const url = new URL(response.url);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return '(invalid response URL)';
  }
}

export function isDirectResponse(response, requestedUrl) {
  try {
    const expected = new URL(requestedUrl);
    const actual = new URL(response.url);
    return (
      response.redirected === false &&
      actual.origin === expected.origin &&
      actual.pathname === expected.pathname &&
      actual.search === expected.search
    );
  } catch {
    return false;
  }
}

export function isCredentialFreeRpcOrigin(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === '/' &&
    value === url.origin
  );
}

export function hasStrongHsts(value) {
  if (typeof value !== 'string') return false;
  const directive = value
    .split(';')
    .map((part) => part.trim())
    .find((part) => /^max-age=/i.test(part));
  if (!directive) return false;
  const seconds = Number(directive.slice(directive.indexOf('=') + 1));
  return Number.isInteger(seconds) && seconds >= MIN_HSTS_MAX_AGE_SECONDS;
}

export function hasRequiredPermissionsPolicy(value) {
  if (typeof value !== 'string') return false;
  const directives = new Set(
    value.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean),
  );
  return REQUIRED_PERMISSIONS_POLICY.every((directive) => directives.has(directive));
}

function requestErrorDetail(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return 'request timed out';
  }
  return 'request failed';
}

export async function runCanary({
  webOrigin = DEFAULT_WEB,
  apiOrigin = DEFAULT_API,
  timeoutMs = 45_000,
  expectedRevision = null,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const normalizedWebOrigin = new URL(webOrigin).origin;
  const normalizedApiOrigin = new URL(apiOrigin).origin;

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new Error('--timeout must be between 1000 and 120000 milliseconds');
  }
  if (expectedRevision != null && !/^[0-9a-f]{40}$/i.test(expectedRevision)) {
    throw new Error('--expected-revision must be a full 40-character commit SHA');
  }
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required');

  const checks = [];

  function record(ok, name, detail = '') {
    checks.push({ ok: Boolean(ok), name, detail });
  }

  function requireCheck(condition, name, detail = '') {
    record(condition, name, detail);
  }

  async function probe(name, fn) {
    try {
      return await fn();
    } catch (error) {
      record(false, name, requestErrorDetail(error));
      return null;
    }
  }

  async function get(path, { origin = normalizedWebOrigin, redirect = 'follow', headers = {} } = {}) {
    const url = new URL(path, origin);
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect,
      headers: {
        'user-agent': 'locked-in-mainnet-canary/1.0',
        ...headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { response, requestedUrl: url };
  }

  async function readJson(path, options) {
    const result = await get(path, options);
    const text = await result.response.text();
    let body = null;
    if (result.response.status !== 204 || text.trim() !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        record(false, `JSON ${path}`, `invalid JSON (${result.response.status})`);
      }
    }
    requireCheck(result.response.ok, `GET ${path}`, `HTTP ${result.response.status}`);
    requireCheck(
      isDirectResponse(result.response, result.requestedUrl),
      `${path} does not redirect`,
      responseTarget(result.response),
    );
    return { ...result, body };
  }

  async function readText(path, options) {
    const result = await get(path, options);
    const body = await result.response.text();
    requireCheck(result.response.ok, `GET ${path}`, `HTTP ${result.response.status}`);
    requireCheck(
      isDirectResponse(result.response, result.requestedUrl),
      `${path} does not redirect`,
      responseTarget(result.response),
    );
    return { ...result, body };
  }

  async function checkWeb() {
    const publicPages = ['/village', '/courses', '/arena', '/risk', '/terms', '/privacy', '/support'];
    const [root, pageResults, robots, sitemap, manifest, openGraph, runtimeConfig] = await Promise.all([
      probe('GET /', () => get('/', { redirect: 'manual' })),
      Promise.all(
        publicPages.map((path) => probe(`GET ${path}`, () => readText(path))),
      ),
      probe('GET /robots.txt', () => readText('/robots.txt')),
      probe('GET /sitemap.xml', () => readText('/sitemap.xml')),
      probe('GET /manifest.webmanifest', () => get('/manifest.webmanifest')),
      probe('GET /opengraph-image', () => get('/opengraph-image')),
      probe('GET /api/runtime-config', () => readJson('/api/runtime-config')),
    ]);

    if (root) {
      const location = root.response.headers.get('location') ?? '';
      const redirectTarget = location && URL.canParse(location, normalizedWebOrigin)
        ? new URL(location, normalizedWebOrigin)
        : null;
      requireCheck(
        [301, 302, 307, 308].includes(root.response.status) &&
          redirectTarget?.origin === normalizedWebOrigin &&
          redirectTarget?.pathname === '/village',
        'root redirects to /village',
        `HTTP ${root.response.status} ${redirectTarget ? `${redirectTarget.origin}${redirectTarget.pathname}` : '(no location)'}`,
      );
    }

    const pages = new Map(publicPages.map((path, index) => [path, pageResults[index]]));
    for (const path of publicPages) {
      const result = pages.get(path);
      if (!result) continue;
      requireCheck(
        result.response.headers.get('content-type')?.includes('text/html'),
        `${path} is HTML`,
        result.response.headers.get('content-type') ?? '(missing)',
      );
    }

    const village = pages.get('/village');
    requireCheck(
      village?.body.includes('Stop collecting courses. Finish one.'),
      'Founding 100 narrative is deployed',
    );
    // No server-HTML check for the "Join the Founding 100" CTA: AppShell holds
    // rendering until persisted stores rehydrate in the browser, so the hero is
    // never in the HTTP response and that check always failed on production
    // (verified 2026-10-02: CTA renders after hydration on desktop and mobile).
    // The CTA is covered by the web E2E suites, like Courses and Arena below.
    requireCheck(
      village?.body.includes('property="og:image"'),
      'village publishes Open Graph image metadata',
    );

    // Courses and Arena render their route-specific copy after hydration. The
    // status, direct-response, and HTML checks above are the reliable HTTP
    // canary for those pages; hydrated content is covered by browser QA.
    const stablePageCopy = {
      '/support': 'Get help without giving up your keys.',
    };
    for (const [path, marker] of Object.entries(stablePageCopy)) {
      requireCheck(
        pages.get(path)?.body.includes(marker),
        `${path} contains its expected content`,
        marker,
      );
    }

    const publicCopy = publicPages
      .map((path) => pages.get(path)?.body ?? '')
      .join('\n')
      .toLowerCase();
    for (const claim of PROHIBITED_PUBLIC_CLAIMS) {
      requireCheck(
        !publicCopy.includes(claim),
        `public pages omit prohibited claim: ${claim}`,
      );
    }

    for (const path of ['/risk', '/terms', '/privacy']) {
      const body = pages.get(path)?.body ?? '';
      requireCheck(
        body.includes('DRAFT') && body.includes('PENDING LEGAL REVIEW'),
        `${path} remains visibly marked as a legal draft`,
      );
    }

    if (village) {
      const requiredHeaders = {
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'strict-origin-when-cross-origin',
      };
      for (const [header, expected] of Object.entries(requiredHeaders)) {
        const actual = village.response.headers.get(header);
        requireCheck(actual === expected, `security header ${header}`, actual ?? '(missing)');
      }
      const permissionsPolicy = village.response.headers.get('permissions-policy') ?? '';
      requireCheck(
        hasRequiredPermissionsPolicy(permissionsPolicy),
        'security header permissions-policy',
        permissionsPolicy || '(missing)',
      );
      const hsts = village.response.headers.get('strict-transport-security') ?? '';
      requireCheck(
        hasStrongHsts(hsts),
        'security header strict-transport-security',
        hsts || '(missing)',
      );
    }

    if (robots) {
      requireCheck(robots.body.includes('Sitemap:'), 'robots.txt advertises sitemap');
    }
    if (sitemap) {
      requireCheck(
        sitemap.body.includes(`${DEFAULT_WEB}/village`),
        'sitemap uses the canonical /village URL',
      );
    }

    if (manifest) {
      const contentType = manifest.response.headers.get('content-type') ?? '';
      requireCheck(manifest.response.ok, 'GET /manifest.webmanifest', `HTTP ${manifest.response.status}`);
      requireCheck(
        isDirectResponse(manifest.response, manifest.requestedUrl),
        '/manifest.webmanifest does not redirect',
        responseTarget(manifest.response),
      );
      requireCheck(
        contentType.includes('application/manifest+json') || contentType.includes('application/json'),
        '/manifest.webmanifest has a manifest content type',
        contentType || '(missing)',
      );
    }

    if (openGraph) {
      const contentType = openGraph.response.headers.get('content-type') ?? '';
      requireCheck(openGraph.response.ok, 'GET /opengraph-image', `HTTP ${openGraph.response.status}`);
      requireCheck(
        isDirectResponse(openGraph.response, openGraph.requestedUrl),
        '/opengraph-image does not redirect',
        responseTarget(openGraph.response),
      );
      requireCheck(contentType.includes('image/'), '/opengraph-image is an image', contentType || '(missing)');
    }

    if (runtimeConfig) {
      requireCheck(
        runtimeConfig.body?.cluster === productionConfig.solana.cluster,
        'frontend uses the mainnet cluster',
        runtimeConfig.body?.cluster ?? '(missing)',
      );
      requireCheck(
        runtimeConfig.body?.vaultV2ProgramId === EXPECTED_PROGRAM,
        'frontend uses the expected v2 custody program',
        runtimeConfig.body?.vaultV2ProgramId ?? '(missing)',
      );
      requireCheck(
        runtimeConfig.body?.usdcMint === EXPECTED_USDC,
        'frontend uses canonical mainnet USDC',
        runtimeConfig.body?.usdcMint ?? '(missing)',
      );
      requireCheck(
        runtimeConfig.body?.globalTvlCapUsdc === EXPECTED_GLOBAL_TVL_CAP_USDC,
        'frontend displays the expected beta TVL cap',
        `${runtimeConfig.body?.globalTvlCapUsdc ?? '(missing)'} USDC`,
      );
      const buildRevision = runtimeConfig.body?.buildRevision;
      requireCheck(
        typeof buildRevision === 'string' && /^[0-9a-f]{40}$/i.test(buildRevision),
        'frontend build revision is exposed',
        buildRevision ?? '(missing)',
      );
      if (expectedRevision) {
        requireCheck(
          buildRevision === expectedRevision,
          'frontend serves the expected commit',
          buildRevision ?? '(missing)',
        );
      }
    }
  }

  async function checkApi() {
    // Warm a sleeping Render service before the independent batch. The same
    // response is also the allowed-origin health probe, so this adds no write
    // and no duplicate production request.
    const health = await probe('GET /health', () => readJson('/health', {
      origin: normalizedApiOrigin,
      headers: { origin: normalizedWebOrigin },
    }));

    const [content, courses, apy, season, ladder, hostileHealth] = await Promise.all([
      probe('GET /v1/content/version', () => readJson('/v1/content/version', { origin: normalizedApiOrigin })),
      probe('GET /v1/courses', () => readJson('/v1/courses', { origin: normalizedApiOrigin })),
      probe('GET /v1/yield/current-apy', () => readJson('/v1/yield/current-apy', { origin: normalizedApiOrigin })),
      probe('GET /v1/arena/season', () => readJson('/v1/arena/season', { origin: normalizedApiOrigin })),
      probe('GET /v1/arena/ladder?limit=1', () => readJson('/v1/arena/ladder?limit=1', { origin: normalizedApiOrigin })),
      probe('GET /health with hostile Origin', () => readJson('/health', {
        origin: normalizedApiOrigin,
        headers: { origin: HOSTILE_ORIGIN },
      })),
    ]);

    if (health) {
      requireCheck(health.body?.ok === true, 'API health is ok');
      requireCheck(health.body?.databaseConfigured === true, 'production database configuration is present');
      requireCheck(
        health.response.headers.get('access-control-allow-origin') === normalizedWebOrigin,
        'API CORS allows the production web origin',
        health.response.headers.get('access-control-allow-origin') ?? '(missing)',
      );
    }

    if (hostileHealth) {
      const allowedOrigin = hostileHealth.response.headers.get('access-control-allow-origin');
      requireCheck(
        allowedOrigin !== HOSTILE_ORIGIN && allowedOrigin !== '*',
        'API CORS rejects an untrusted origin',
        allowedOrigin ?? '(not allowed)',
      );
    }

    if (content) {
      requireCheck(
        typeof content.body?.releaseId === 'string' && Boolean(Date.parse(content.body?.publishedAt)),
        'published content release exists',
        content.body?.releaseId ?? '(missing)',
      );
    }

    if (courses) {
      requireCheck(
        Array.isArray(courses.body) && courses.body.some((course) => Number(course?.totalLessons) > 0),
        'at least one published course has lessons',
        `${Array.isArray(courses.body) ? courses.body.length : 0} course records`,
      );
    }

    if (apy) {
      requireCheck(
        apy.body?.live === true && Number.isFinite(apy.body?.apyBps),
        'yield APY is a live source',
        `${apy.body?.apyBps ?? 'null'} bps from ${apy.body?.source ?? 'unknown'}`,
      );
    }

    if (season) {
      requireCheck(
        season.body === null || (Number.isInteger(season.body?.id) && typeof season.body?.status === 'string'),
        'Arena season response is well formed',
        season.body?.status ?? 'no open season',
      );
    }
    if (ladder) {
      requireCheck(Array.isArray(ladder.body), 'Arena ladder response is a list');
    }

    // Fetch strategy state after current-apy so a healthy live read has just
    // refreshed the cache timestamp that this observability endpoint exposes.
    const strategy = await probe(
      'GET /v1/yield/strategy-info',
      () => readJson('/v1/yield/strategy-info', { origin: normalizedApiOrigin }),
    );
    if (!strategy) return;

    requireCheck(
      strategy.body?.profile === EXPECTED_PROFILE,
      'mainnet Kamino profile is active',
      strategy.body?.profile ?? '(missing)',
    );
    requireCheck(
      strategy.body?.custody?.programId === EXPECTED_PROGRAM,
      'backend uses the expected v2 custody program',
      strategy.body?.custody?.programId ?? '(missing)',
    );
    requireCheck(
      strategy.body?.custody?.usdcMint === EXPECTED_USDC,
      'backend uses canonical mainnet USDC',
      strategy.body?.custody?.usdcMint ?? '(missing)',
    );
    const rpcHost = strategy.body?.kamino?.rpcHost ?? '';
    requireCheck(
      isCredentialFreeRpcOrigin(rpcHost),
      'public strategy info exposes only the RPC origin',
      rpcHost ? '(configured)' : '(missing)',
    );

    const fetchedAt = Date.parse(strategy.body?.kamino?.lastFetchedAt ?? '');
    const apyAgeMs = now() - fetchedAt;
    requireCheck(
      Number.isFinite(fetchedAt) && apyAgeMs >= -60_000 && apyAgeMs <= MAX_APY_AGE_MS,
      'Kamino APY read completed recently',
      Number.isFinite(fetchedAt) ? `${Math.round(apyAgeMs / 1000)}s old` : '(missing)',
    );
    if (apy && Number.isFinite(apy.body?.apyBps)) {
      requireCheck(
        Number.isFinite(strategy.body?.kamino?.lastApyBps) &&
          Math.abs(strategy.body.kamino.lastApyBps - apy.body.apyBps) <= MAX_APY_DIFFERENCE_BPS,
        'strategy APY is consistent with the live public quote',
        `${strategy.body?.kamino?.lastApyBps ?? 'null'} vs ${apy.body.apyBps} bps`,
      );
    }
  }

  const startedAt = new Date(now()).toISOString();
  await Promise.all([checkWeb(), checkApi()]);

  const failed = checks.filter((check) => !check.ok);
  return {
    startedAt,
    webOrigin: normalizedWebOrigin,
    apiOrigin: normalizedApiOrigin,
    expectedMainnet: {
      program: EXPECTED_PROGRAM,
      usdcMint: EXPECTED_USDC,
      yieldProfile: EXPECTED_PROFILE,
      globalTvlCapUsdc: EXPECTED_GLOBAL_TVL_CAP_USDC,
      revision: expectedRevision,
    },
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
}

export function printReport(report, { jsonOutput = false } = {}) {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Locked In read-only mainnet canary\nweb: ${report.webOrigin}\napi: ${report.apiOrigin}\n`);
  for (const check of report.checks) {
    const detail = check.detail ? ` - ${check.detail}` : '';
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${detail}`);
  }
  console.log(`\n${report.passed} passed, ${report.failed} failed`);
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(`Usage: node scripts/live-mainnet-canary.mjs [options]

Options:
  --web <url>       Frontend origin (default: ${DEFAULT_WEB})
  --api <url>       Backend origin (default: ${DEFAULT_API})
  --timeout <ms>    Per-request timeout (default: 45000)
  --expected-revision <sha>  Require the deployed frontend commit
  --json            Print a JSON report

Safety: this script performs GET requests only.`);
    return;
  }

  const report = await runCanary({
    webOrigin: options.webOrigin,
    apiOrigin: options.apiOrigin,
    timeoutMs: options.timeoutMs,
    expectedRevision: options.expectedRevision,
  });
  printReport(report, { jsonOutput: options.jsonOutput });
  if (report.failed > 0) process.exitCode = 1;
}

const invokedDirectly = process.argv[1]
  ? realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
  : false;
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error(`Canary configuration error: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 2;
  }
}
