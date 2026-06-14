import { appConfig } from '../config.mjs';
import { ensureRedemptionVaultLiquidity, hasRedemptionVaultAutofundConfig } from '../lib/redemptionVault.mjs';

export function registerRedemptionVaultAutofundWorker(app) {
  let timer = null;
  let stopped = false;
  let inFlight = false;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleNextRun(delayMs = appConfig.redemptionVaultAutofundIntervalMs) {
    if (stopped) {
      return;
    }

    clearTimer();
    timer = setTimeout(async () => {
      await runCycle();
    }, Math.max(1000, delayMs));
    timer.unref?.();
  }

  async function runCycle() {
    if (stopped) {
      return;
    }

    if (inFlight) {
      scheduleNextRun();
      return;
    }

    inFlight = true;

    try {
      const result = await ensureRedemptionVaultLiquidity();
      if (result.processed || result.reason !== 'AT_OR_ABOVE_MINIMUM') {
        app.log.info(
          {
            reason: result.reason,
            redemptionVault: result.redemptionVault,
            currentBalanceUi: result.currentBalanceUi,
            targetBalanceUi: result.targetBalanceUi ?? null,
            fundedAmountUi: result.fundedAmountUi ?? null,
            signature: result.signature ?? null,
          },
          'redemption_vault_autofund.cycle_result',
        );
      }
    } catch (error) {
      app.log.error({ err: error }, 'redemption_vault_autofund.cycle_failed');
    } finally {
      inFlight = false;
      scheduleNextRun();
    }
  }

  app.addHook('onReady', async () => {
    if (!appConfig.redemptionVaultAutofundEnabled) {
      app.log.info('Redemption vault autofund worker disabled');
      return;
    }

    // Treasury-signing worker. Refuse on non-devnet clusters — autofund
    // moves real funds and there is no on-chain Kamino backing yet.
    if (!(appConfig.solanaRpcUrl ?? '').includes('devnet')) {
      app.log.error('CRITICAL: redemption vault autofund worker blocked on non-devnet cluster. Refusing to start.');
      return;
    }

    if (!hasRedemptionVaultAutofundConfig()) {
      app.log.warn('Redemption vault autofund worker disabled because config is incomplete');
      return;
    }

    app.log.info(
      {
        intervalMs: appConfig.redemptionVaultAutofundIntervalMs,
        minimumBalanceUi: appConfig.redemptionVaultMinimumBalanceUi,
        targetBalanceUi: appConfig.redemptionVaultTargetBalanceUi,
      },
      'Redemption vault autofund worker started',
    );
    scheduleNextRun(1000);
  });

  app.addHook('onClose', async () => {
    stopped = true;
    clearTimer();
  });
}
