// Public observability endpoints for the yield strategy. No auth required.
// Lets the frontend show a "Live Kamino USDC APY" widget and lets ops verify
// (via /v1/yield/strategy-info) which profile is actually active in prod.
//
// Both endpoints are rate-limited per IP because they back the dashboard.
// The Kamino read itself is cached inside yieldStrategy.mjs (default 60s)
// so this endpoint can be hammered without flooding the upstream RPC.
import {
  getYieldStrategyInfo,
  readKaminoSupplyApyBpsSafe,
} from '../../lib/yieldStrategy.mjs';
import { appConfig } from '../../config.mjs';

export async function yieldRoutes(app) {
  app.get('/v1/yield/current-apy', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (_request, reply) => {
      const info = getYieldStrategyInfo();
      const apyBps = await readKaminoSupplyApyBpsSafe();
      const source =
        info.kind === 'kamino_klend_reserve_v1'
          ? `kamino_klend_${info.kamino?.reserveSymbol?.toLowerCase() ?? 'usdc'}`
          : 'fixed_apy';
      const effectiveApyBps =
        apyBps != null ? apyBps : info.fixedApyBps ?? null;

      return reply.send({
        apyBps: effectiveApyBps,
        apyPct:
          effectiveApyBps != null
            ? Number((effectiveApyBps / 100).toFixed(2))
            : null,
        source,
        fetchedAt: info.kamino?.lastFetchedAt ?? null,
        live: apyBps != null && info.kind === 'kamino_klend_reserve_v1',
      });
    },
  });

  // Operator-facing introspection. Useful to verify the active profile in
  // prod without reading Render env vars. Safe to expose publicly — the
  // RPC host is sanitized to strip API keys.
  app.get('/v1/yield/strategy-info', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (_request, reply) => {
      return reply.send(getYieldStrategyInfo());
    },
  });
}
