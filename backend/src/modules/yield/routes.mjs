// Public observability endpoints for the yield strategy. No auth required
// for current-apy / strategy-info — they back the dashboard widget.
// recent-harvests is operator-only (scheduler-secret gated) since it lists
// per-wallet harvest receipts and would leak holdings if public.
//
// The Kamino RPC read is cached inside yieldStrategy.mjs (default 60s) so
// the public endpoints can be hammered without flooding upstream Helius.
import {
  getYieldStrategyInfo,
  readKaminoSupplyApyBpsSafe,
} from '../../lib/yieldStrategy.mjs';
import { appConfig } from '../../config.mjs';
import { unauthorized } from '../../lib/errors.mjs';
import { listRecentHarvestReceipts } from '../progress/repository.mjs';

function requireSchedulerAuth(request) {
  const schedulerKey = request.headers['x-scheduler-key'];
  if (
    typeof schedulerKey !== 'string' ||
    schedulerKey.length === 0 ||
    schedulerKey !== appConfig.schedulerSecret
  ) {
    throw unauthorized('Invalid scheduler key', 'INVALID_SCHEDULER_KEY');
  }
}

function truncateWallet(address) {
  if (typeof address !== 'string' || address.length < 9) return address ?? null;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function toUsdcUi(baseUnitsText) {
  if (typeof baseUnitsText !== 'string' || baseUnitsText.length === 0) return '0';
  try {
    return (Number(BigInt(baseUnitsText)) / 1_000_000).toFixed(6);
  } catch {
    return '0';
  }
}

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

  // Operator-only: list the most recent harvest receipts so we can confirm
  // the runtime scheduler is actually firing in prod. Wallet addresses are
  // truncated (first4...last4) to keep this safe even if the secret leaks.
  // Auth: pass header `x-scheduler-key: <SCHEDULER_SECRET>`.
  // Query: `?limit=N` (default 20, max 100).
  app.get('/v1/yield/recent-harvests', {
    handler: async (request, reply) => {
      requireSchedulerAuth(request);
      const requestedLimit = Number(request.query?.limit ?? 20);
      const rows = await listRecentHarvestReceipts(requestedLimit);

      const harvests = rows.map((row) => ({
        harvestId: row.harvestId,
        walletAddress: truncateWallet(row.walletAddress),
        courseId: row.courseId,
        harvestedAt: row.harvestedAt,
        grossYieldAmount: row.grossYieldAmount,
        grossYieldUsdcUi: toUsdcUi(row.grossYieldAmount),
        applied: row.applied,
        yieldSplitterStatus: row.yieldSplitterStatus,
      }));

      const totalBaseUnits = rows.reduce((acc, row) => {
        try {
          return acc + BigInt(row.grossYieldAmount ?? '0');
        } catch {
          return acc;
        }
      }, 0n);

      const info = getYieldStrategyInfo();
      return reply.send({
        count: harvests.length,
        totalGrossYieldAmount: totalBaseUnits.toString(),
        totalGrossYieldUsdcUi: toUsdcUi(totalBaseUnits.toString()),
        currentApyBps: info.kamino?.lastApyBps ?? info.fixedApyBps ?? null,
        currentProfile: info.profile,
        harvests,
      });
    },
  });
}
