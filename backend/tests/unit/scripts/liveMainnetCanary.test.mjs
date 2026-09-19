import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEB,
  hasRequiredPermissionsPolicy,
  hasStrongHsts,
  isCredentialFreeRpcOrigin,
  isDirectResponse,
  parseArgs,
  runCanary,
} from '../../../../scripts/live-mainnet-canary.mjs';

const WEB = 'https://web.example';
const API = 'https://api.example';
const NOW = Date.parse('2026-09-19T12:00:00.000Z');

function response(url, { status = 200, headers = {}, body = '', redirected = false } = {}) {
  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    redirected,
    headers: new Headers(headers),
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function createSuccessfulFetch({
  rpcHost = 'https://rpc.example.com',
  frontendProgram = 'FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6',
  frontendRevision = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  includeNarrative = true,
  seasonStatus = 200,
} = {}) {
  let active = 0;
  let maxActive = 0;
  const methods = [];

  const fetchImpl = async (input, options) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    methods.push(options.method);
    await Promise.resolve();
    active -= 1;

    const url = new URL(input);
    const route = `${url.pathname}${url.search}`;
    if (url.origin === WEB) {
      if (route === '/') {
        return response(url.href, { status: 307, headers: { location: '/village' } });
      }
      if (route === '/robots.txt') {
        return response(url.href, { headers: { 'content-type': 'text/plain' }, body: `Sitemap: ${WEB}/sitemap.xml` });
      }
      if (route === '/sitemap.xml') {
        return response(url.href, { headers: { 'content-type': 'application/xml' }, body: `<loc>${DEFAULT_WEB}/village</loc>` });
      }
      if (route === '/manifest.webmanifest') {
        return response(url.href, { headers: { 'content-type': 'application/manifest+json' } });
      }
      if (route === '/opengraph-image') {
        return response(url.href, { headers: { 'content-type': 'image/png' } });
      }
      if (route === '/api/runtime-config') {
        return response(url.href, {
          headers: { 'content-type': 'application/json' },
          body: {
            cluster: 'mainnet-beta',
            vaultV2ProgramId: frontendProgram,
            usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            globalTvlCapUsdc: 1000,
            buildRevision: frontendRevision,
          },
        });
      }

      const legal = ['/risk', '/terms', '/privacy'].includes(route)
        ? 'DRAFT - PENDING LEGAL REVIEW'
        : '';
      const village = route === '/village' && includeNarrative
        ? 'Stop collecting courses. Finish one. Join the Founding 100 <meta property="og:image" content="image.png">'
        : '';
      // Client-rendered routes return a shell in raw HTML; only assert copy
      // that the production server actually renders before hydration.
      const stableCopy = route === '/support'
        ? 'Get help without giving up your keys.'
        : '';
      return response(url.href, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'permissions-policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          'strict-transport-security': 'max-age=63072000',
        },
        body: `${legal}${village}${stableCopy}`,
      });
    }

    const apiHeaders = { 'content-type': 'application/json' };
    if (route === '/health') {
      const allowedOrigin = options.headers.origin === WEB ? WEB : null;
      return response(url.href, {
        headers: {
          ...apiHeaders,
          ...(allowedOrigin ? { 'access-control-allow-origin': allowedOrigin } : {}),
        },
        body: { ok: true, databaseConfigured: true },
      });
    }
    if (route === '/v1/content/version') {
      return response(url.href, {
        headers: apiHeaders,
        body: { releaseId: 'release-1', publishedAt: '2026-09-19T00:00:00.000Z' },
      });
    }
    if (route === '/v1/courses') {
      return response(url.href, { headers: apiHeaders, body: [{ totalLessons: 3 }] });
    }
    if (route === '/v1/yield/current-apy') {
      return response(url.href, {
        headers: apiHeaders,
        body: { live: true, apyBps: 481, source: 'kamino-live' },
      });
    }
    if (route === '/v1/yield/strategy-info') {
      return response(url.href, {
        headers: apiHeaders,
        body: {
          custody: {
            programId: 'FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6',
            usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          },
          profile: 'kamino_usdc_mainnet',
          kamino: {
            rpcHost,
            lastApyBps: 481,
            lastFetchedAt: new Date(NOW - 10_000).toISOString(),
          },
        },
      });
    }
    if (route === '/v1/arena/season') {
      return response(url.href, {
        status: seasonStatus,
        headers: apiHeaders,
        body: seasonStatus === 204 ? '' : null,
      });
    }
    if (route === '/v1/arena/ladder?limit=1') {
      return response(url.href, { headers: apiHeaders, body: [] });
    }
    throw new Error(`Unexpected request: ${url.href}`);
  };

  return {
    fetchImpl,
    getMaxActive: () => maxActive,
    methods,
  };
}

describe('mainnet canary guards', () => {
  it('parses options without accepting missing or unknown values', () => {
    expect(parseArgs([
      '--web',
      WEB,
      '--expected-revision',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--json',
    ])).toMatchObject({
      webOrigin: WEB,
      expectedRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      jsonOutput: true,
    });
    expect(() => parseArgs(['--web', '--json'])).toThrow('--web requires a value');
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown option');
  });

  it('rejects followed and cross-origin responses', () => {
    expect(isDirectResponse(
      { url: `${WEB}/support`, redirected: false },
      `${WEB}/support`,
    )).toBe(true);
    expect(isDirectResponse(
      { url: 'https://other.example/support', redirected: true },
      `${WEB}/support`,
    )).toBe(false);
  });

  it('accepts only a bare HTTP RPC origin', () => {
    expect(isCredentialFreeRpcOrigin('https://rpc.example.com')).toBe(true);
    expect(isCredentialFreeRpcOrigin('https://rpc.example.com/provider-token')).toBe(false);
    expect(isCredentialFreeRpcOrigin('https://user:pass@rpc.example.com')).toBe(false);
    expect(isCredentialFreeRpcOrigin('file:///rpc-token')).toBe(false);
  });

  it('requires durable HSTS while allowing extra permissions directives', () => {
    expect(hasStrongHsts('max-age=0')).toBe(false);
    expect(hasStrongHsts('max-age=31536000; includeSubDomains')).toBe(true);
    expect(hasRequiredPermissionsPolicy(
      'microphone=(), camera=(), geolocation=(), browsing-topics=(), payment=()',
    )).toBe(true);
    expect(hasRequiredPermissionsPolicy('camera=(), microphone=()')).toBe(false);
  });

  it('runs independent probes concurrently and uses GET only', async () => {
    const mock = createSuccessfulFetch();
    const report = await runCanary({
      webOrigin: WEB,
      apiOrigin: API,
      fetchImpl: mock.fetchImpl,
      now: () => NOW,
    });

    expect(report.failed).toBe(0);
    expect(mock.getMaxActive()).toBeGreaterThan(1);
    expect(new Set(mock.methods)).toEqual(new Set(['GET']));
  });

  it('accepts an empty 204 Arena season response as no open season', async () => {
    const mock = createSuccessfulFetch({ seasonStatus: 204 });
    const report = await runCanary({
      webOrigin: WEB,
      apiOrigin: API,
      fetchImpl: mock.fetchImpl,
      now: () => NOW,
    });

    expect(report.failed).toBe(0);
  });

  it('fails a path-bearing RPC label without echoing the path token', async () => {
    const mock = createSuccessfulFetch({
      rpcHost: 'https://rpc.example.com/provider-token',
    });
    const report = await runCanary({
      webOrigin: WEB,
      apiOrigin: API,
      fetchImpl: mock.fetchImpl,
      now: () => NOW,
    });

    expect(report.checks).toContainEqual(expect.objectContaining({
      ok: false,
      name: 'public strategy info exposes only the RPC origin',
      detail: '(configured)',
    }));
    expect(JSON.stringify(report)).not.toContain('provider-token');
  });

  it.each([
    {
      name: 'missing acquisition narrative',
      options: { includeNarrative: false },
      check: 'Founding 100 narrative is deployed',
    },
    {
      name: 'wrong frontend custody program',
      options: { frontendProgram: 'wrong-program' },
      check: 'frontend uses the expected v2 custody program',
    },
    {
      name: 'wrong deployed revision',
      options: { frontendRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      expectedRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      check: 'frontend serves the expected commit',
    },
  ])('fails closed for $name', async ({ options, expectedRevision, check }) => {
    const mock = createSuccessfulFetch(options);
    const report = await runCanary({
      webOrigin: WEB,
      apiOrigin: API,
      expectedRevision,
      fetchImpl: mock.fetchImpl,
      now: () => NOW,
    });

    expect(report.checks).toContainEqual(expect.objectContaining({ ok: false, name: check }));
    expect(report.failed).toBeGreaterThan(0);
  });
});
