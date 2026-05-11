import { appConfig } from '../../config.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import { HttpError } from '../../lib/errors.mjs';
import {
  hasFaucetConfig,
  isDevnetOnly,
  transferSol,
  transferUsdc,
  reserveClaim,
  recordClaimSignatures,
  releaseReservation,
} from '../../lib/faucet.mjs';

export async function faucetRoutes(app) {
  app.post('/v1/faucet/claim', {
    preHandler: [requireAccessAuth],
    // Belt-and-suspenders rate limit on top of the per-wallet UNIQUE
    // constraint. The UNIQUE in `lesson.faucet_claims (wallet_address,
    // round)` already prevents a successful double-claim, but a flood of
    // requests still costs us Solana RPC calls. 5 requests / minute / IP
    // is plenty for a legitimate user (1 click = 1 request).
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
    handler: async (request, reply) => {
      const walletAddress = request.auth.walletAddress;

      if (!hasFaucetConfig()) {
        throw new HttpError(503, 'Faucet is not enabled.', 'FAUCET_DISABLED');
      }

      if (!isDevnetOnly()) {
        throw new HttpError(403, 'Faucet is only available on devnet.', 'FAUCET_MAINNET_BLOCKED');
      }

      // Atomic reservation — INSERT ON CONFLICT DO NOTHING. If another
      // concurrent request from the same wallet/round wins, this returns
      // null and we reject before spending any SOL.
      const reservationId = await reserveClaim(walletAddress);
      if (!reservationId) {
        return reply.status(429).send({
          claimed: false,
          message: 'Already claimed for this round.',
        });
      }

      let solResult = { signature: null, error: null };
      let usdcResult = null;
      try {
        // SOL transfer — best-effort. If it fails the user still gets
        // USDC; we surface the error in the response.
        try {
          const sol = await transferSol(walletAddress, appConfig.faucetSolLamports);
          solResult.signature = sol.signature;
          request.log.info({ walletAddress, signature: sol.signature }, 'faucet.sol.ok');
        } catch (err) {
          solResult.error = err.message ?? 'SOL transfer failed';
          request.log.warn({ walletAddress, err: err.message }, 'faucet.sol.failed');
        }

        // USDC transfer — must succeed.
        usdcResult = await transferUsdc(walletAddress, appConfig.faucetUsdcAmountUi);
        request.log.info({ walletAddress, signature: usdcResult.signature }, 'faucet.usdc.ok');
      } catch (err) {
        // USDC failed → release the reservation so the user can retry
        // (otherwise they'd be locked out until FAUCET_ROUND bumps).
        await releaseReservation(reservationId).catch(() => {});
        request.log.error({ walletAddress, err: err.message }, 'faucet.usdc.failed');
        throw err;
      }

      // Both transfers (or at least USDC) succeeded — update the
      // reservation with the actual signatures so it sticks.
      await recordClaimSignatures(
        reservationId,
        solResult.signature ?? '',
        usdcResult.signature,
        solResult.signature ? appConfig.faucetSolLamports : 0,
        usdcResult.amountAtomic.toString(),
      );

      return {
        claimed: true,
        sol: {
          signature: solResult.signature,
          amountSol: String(appConfig.faucetSolLamports / 1_000_000_000),
          error: solResult.error,
        },
        usdc: {
          signature: usdcResult.signature,
          amountUsdc: appConfig.faucetUsdcAmountUi,
        },
      };
    },
  });
}
