import { PublicKey } from '@solana/web3.js';
import { badRequest, unauthorized, HttpError } from '../../lib/errors.mjs';
import { secureEquals } from '../../lib/secureCompare.mjs';
import { appConfig } from '../../config.mjs';
import { hasSolDripConfig, dripSolOnce } from '../../lib/solDrip.mjs';

// Scheduler-key gate, same shape as the /v1/internal routes in
// modules/progress/routes.mjs: constant-time compare, no auth fallback.
function requireSchedulerAuth(request) {
  const schedulerKey = request.headers['x-scheduler-key'];
  if (
    typeof schedulerKey !== 'string' ||
    schedulerKey.length === 0 ||
    !secureEquals(schedulerKey, appConfig.schedulerSecret)
  ) {
    throw unauthorized('Invalid scheduler key', 'INVALID_SCHEDULER_KEY');
  }
}

export async function dripRoutes(app) {
  // One-time onboarding SOL drip (spec §4.2). Internal-only: the scheduler /
  // backend calls this at first deposit; it is never client-facing. Responds
  // with status 'dripped' | 'already_dripped' | 'cap_reached' — replays and
  // races resolve inside lib/solDrip.mjs, never with a second payout.
  app.post('/v1/internal/sol-drip', async (request) => {
    requireSchedulerAuth(request);

    const walletAddress = request.body?.walletAddress;
    if (!walletAddress || typeof walletAddress !== 'string') {
      throw badRequest('walletAddress is required', 'MISSING_WALLET_ADDRESS');
    }
    try {
      // Parse-only validation; also normalizes any exotic base58 spellings.
      new PublicKey(walletAddress);
    } catch {
      throw badRequest('walletAddress is not a valid public key', 'INVALID_WALLET_ADDRESS');
    }

    // Fail closed: without RPC + worker key + database there is no safe way
    // to pay (or to remember that we paid).
    if (!hasSolDripConfig()) {
      throw new HttpError(503, 'SOL drip is not configured.', 'SOL_DRIP_UNCONFIGURED');
    }

    return dripSolOnce(walletAddress);
  });
}
