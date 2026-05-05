import { appConfig } from '../../config.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import { HttpError } from '../../lib/errors.mjs';
import {
  hasFaucetConfig,
  isDevnetOnly,
  transferSol,
  transferUsdc,
  checkCooldown,
  recordClaim,
} from '../../lib/faucet.mjs';

export async function faucetRoutes(app) {
  app.post('/v1/faucet/claim', {
    preHandler: [requireAccessAuth],
    handler: async (request, reply) => {
      const walletAddress = request.auth.walletAddress;

      if (!hasFaucetConfig()) {
        throw new HttpError(503, 'Faucet is not enabled.', 'FAUCET_DISABLED');
      }

      if (!isDevnetOnly()) {
        throw new HttpError(403, 'Faucet is only available on devnet.', 'FAUCET_MAINNET_BLOCKED');
      }

      const cooldown = await checkCooldown(walletAddress);
      if (!cooldown.eligible) {
        return reply.status(429).send({
          claimed: false,
          message: 'Already claimed for this round.',
        });
      }

      // SOL transfer from worker wallet
      let solResult = { signature: null, error: null };
      try {
        const sol = await transferSol(walletAddress, appConfig.faucetSolLamports);
        solResult.signature = sol.signature;
        request.log.info({ walletAddress, signature: sol.signature }, 'faucet.sol.ok');
      } catch (err) {
        solResult.error = err.message ?? 'SOL transfer failed';
        request.log.warn({ walletAddress, err: err.message }, 'faucet.sol.failed');
      }

      // USDC transfer — must succeed
      const usdc = await transferUsdc(walletAddress, appConfig.faucetUsdcAmountUi);
      request.log.info({ walletAddress, signature: usdc.signature }, 'faucet.usdc.ok');

      await recordClaim(
        walletAddress,
        solResult.signature,
        usdc.signature,
        solResult.signature ? appConfig.faucetSolLamports : 0,
        usdc.amountAtomic.toString(),
      );

      return {
        claimed: true,
        sol: {
          signature: solResult.signature,
          amountSol: String(appConfig.faucetSolLamports / 1_000_000_000),
          error: solResult.error,
        },
        usdc: {
          signature: usdc.signature,
          amountUsdc: appConfig.faucetUsdcAmountUi,
        },
      };
    },
  });
}
