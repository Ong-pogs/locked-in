import { HttpError } from '../../lib/errors.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import { hasSolDripConfig, dripSolOnce } from '../../lib/solDrip.mjs';

// Gas stipend (onramp spec 2026-07-29): the SOL leg of fiat onboarding until
// the gasless relay ships. A Google-login embedded wallet arrives with 0 SOL;
// selling it USDC via the card onramp without gas strands real money in a
// wallet that cannot pay the deposit fee. This thin authed wrapper drips
// 0.005 SOL exactly once per wallet.
//
// All money logic — reserve-then-transfer ordering, idempotency, the global
// cap, fail-closed behavior — lives in lib/solDrip.mjs and is already tested.
// The dripped address is ALWAYS the authenticated session wallet: no request
// parameter exists, so the drip cannot be aimed at an arbitrary address.
export async function walletRoutes(app) {
  app.post(
    '/v1/wallet/gas-stipend',
    {
      preHandler: requireAccessAuth,
      // Same per-route budget as the faucet: 1 click = 1 request, and the
      // drip itself is once-per-wallet — the limit only blunts hammering.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request) => {
      if (!hasSolDripConfig()) {
        throw new HttpError(503, 'Gas stipend is not available.', 'GAS_STIPEND_UNCONFIGURED');
      }
      return dripSolOnce(request.auth.walletAddress);
    },
  );
}
