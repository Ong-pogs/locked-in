#!/usr/bin/env node

/**
 * Read-only production canary for Locked In.
 *
 * It deliberately uses GET requests only. It never authenticates, builds a
 * transaction, submits a signature, changes data, or moves funds.
 */

const DEFAULT_WEB = 'https://www.lockedin.quest';
const DEFAULT_API = 'https://locked-in-backend-oetf.onrender.com';
const EXPECTED_PROFILE = 'kamino_usdc_mainnet';
const EXPECTED_PROGRAM = 'FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6';
const EXPECTED_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.argv.includes('--help')) {
  console.log(`Usage: node scripts/live-mainnet-canary.mjs [options]

Options:
  --web <url>       Frontend origin (default: ${DEFAULT_WEB})
  --api <url>       Backend origin (default: ${DEFAULT_API})
  --timeout <ms>    Per-request timeout (default: 15000)
  --json            Print a JSON report

Safety: this script performs GET requests only.`);
  process.exit(0);
}

const webOrigin = new URL(option('--web', DEFAULT_WEB)).origin;
const apiOrigin = new URL(option('--api', DEFAULT_API)).origin;
const timeoutMs = Number(option('--timeout', '15000'));
const jsonOutput = process.argv.includes('--json');

if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
  throw new Error('--timeout must be between 1000 and 120000 milliseconds');
}

const checks = [];

function record(ok, name, detail = '') {
  checks.push({ ok: Boolean(ok), name, detail });
}

function requireCheck(condition, name, detail = '') {
  record(condition, name, detail);
}

async function get(path, { origin = webOrigin, redirect = 'follow', headers = {} } = {}) {
  const url = new URL(path, origin);
  const response = await fetch(url, {
    method: 'GET',
    redirect,
    headers: {
      'user-agent': 'locked-in-mainnet-canary/1.0',
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response;
}

async function json(path, options) {
  const response = await get(path, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    record(false, `JSON ${path}`, `invalid JSON (${response.status})`);
  }
  requireCheck(response.ok, `GET ${path}`, `HTTP ${response.status}`);
  return { response, body };
}

async function text(path, options) {
  const response = await get(path, options);
  const body = await response.text();
  requireCheck(response.ok, `GET ${path}`, `HTTP ${response.status}`);
  return { response, body };
}

async function checkWeb() {
  const root = await get('/', { redirect: 'manual' });
  const location = root.headers.get('location') ?? '';
  const redirectPath = location ? new URL(location, webOrigin).pathname : '';
  requireCheck(
    [301, 302, 307, 308].includes(root.status) && redirectPath === '/village',
    'root redirects to /village',
    `HTTP ${root.status} ${location || '(no location)'}`,
  );

  const publicPages = ['/village', '/courses', '/arena', '/risk', '/terms', '/privacy', '/support'];
  let village = null;
  for (const path of publicPages) {
    const result = await text(path);
    requireCheck(
      result.response.headers.get('content-type')?.includes('text/html'),
      `${path} is HTML`,
      result.response.headers.get('content-type') ?? '(missing)',
    );
    if (path === '/village') village = result;
  }

  requireCheck(
    village?.body.includes('Stop collecting courses. Finish one.'),
    'Founding 100 narrative is deployed',
  );
  requireCheck(village?.body.includes('Join the Founding 100'), 'Founding 100 CTA is deployed');

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
    requireCheck(
      Boolean(village.response.headers.get('permissions-policy')),
      'security header permissions-policy',
      village.response.headers.get('permissions-policy') ?? '(missing)',
    );
  }

  const robots = await text('/robots.txt');
  requireCheck(robots.body.includes('Sitemap:'), 'robots.txt advertises sitemap');

  const sitemap = await text('/sitemap.xml');
  requireCheck(sitemap.body.includes(`${webOrigin}/village`), 'sitemap includes /village');

  const manifest = await get('/manifest.webmanifest');
  requireCheck(manifest.ok, 'GET /manifest.webmanifest', `HTTP ${manifest.status}`);
}

async function checkApi() {
  const health = await json('/health', {
    origin: apiOrigin,
    headers: { origin: webOrigin },
  });
  requireCheck(health.body?.ok === true, 'API health is ok');
  requireCheck(health.body?.databaseConfigured === true, 'production database is configured');
  requireCheck(
    health.response.headers.get('access-control-allow-origin') === webOrigin,
    'API CORS allows only the production origin for this request',
    health.response.headers.get('access-control-allow-origin') ?? '(missing)',
  );

  const content = await json('/v1/content/version', { origin: apiOrigin });
  requireCheck(
    typeof content.body?.releaseId === 'string' && Boolean(Date.parse(content.body?.publishedAt)),
    'published content release exists',
    content.body?.releaseId ?? '(missing)',
  );

  const courses = await json('/v1/courses', { origin: apiOrigin });
  requireCheck(
    Array.isArray(courses.body) && courses.body.some((course) => Number(course.totalLessons) > 0),
    'at least one published course has lessons',
    `${Array.isArray(courses.body) ? courses.body.length : 0} course records`,
  );

  const apy = await json('/v1/yield/current-apy', { origin: apiOrigin });
  requireCheck(
    apy.body?.live === true && Number.isFinite(apy.body?.apyBps),
    'yield APY is a live source',
    `${apy.body?.apyBps ?? 'null'} bps from ${apy.body?.source ?? 'unknown'}`,
  );

  const strategy = await json('/v1/yield/strategy-info', { origin: apiOrigin });
  requireCheck(
    strategy.body?.profile === EXPECTED_PROFILE,
    'mainnet Kamino profile is active',
    strategy.body?.profile ?? '(missing)',
  );
  const rpcHost = strategy.body?.kamino?.rpcHost ?? '';
  requireCheck(
    typeof rpcHost === 'string' && !rpcHost.includes('?') && !/api[-_]?key/i.test(rpcHost),
    'public strategy info strips RPC credentials',
    rpcHost || '(missing)',
  );

  const season = await json('/v1/arena/season', { origin: apiOrigin });
  requireCheck(
    season.body === null || (Number.isInteger(season.body?.id) && typeof season.body?.status === 'string'),
    'Arena season response is well formed',
    season.body?.status ?? 'no open season',
  );

  const ladder = await json('/v1/arena/ladder?limit=1', { origin: apiOrigin });
  requireCheck(Array.isArray(ladder.body), 'Arena ladder response is a list');
}

async function main() {
  const startedAt = new Date().toISOString();
  try {
    await checkWeb();
    await checkApi();
  } catch (error) {
    record(false, 'canary completed', error instanceof Error ? error.message : String(error));
  }

  const failed = checks.filter((check) => !check.ok);
  const report = {
    startedAt,
    webOrigin,
    apiOrigin,
    expectedProgram: EXPECTED_PROGRAM,
    expectedUsdcMint: EXPECTED_USDC,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Locked In read-only mainnet canary\nweb: ${webOrigin}\napi: ${apiOrigin}\n`);
    for (const check of checks) {
      const detail = check.detail ? ` - ${check.detail}` : '';
      console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${detail}`);
    }
    console.log(`\n${report.passed} passed, ${report.failed} failed`);
  }

  if (failed.length > 0) process.exitCode = 1;
}

await main();
