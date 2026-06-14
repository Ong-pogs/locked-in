import { appConfig } from '../config.mjs';
import { hasLockVaultRelayConfig } from '../lib/lockVault.mjs';
import { publishVerifiedCompletionEvent } from '../modules/progress/repository.mjs';

export function registerLockVaultRelayWorker(app) {
  let timer = null;
  let stopped = false;
  let inFlight = false;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleNextRun(delayMs = appConfig.lockVaultRelayIntervalMs) {
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
      let published = 0;
      let failed = 0;

      for (let index = 0; index < appConfig.lockVaultRelayBatchSize; index += 1) {
        const result = await publishVerifiedCompletionEvent();
        if (result.reason === 'NO_PENDING_EVENT') {
          break;
        }

        if (result.processed) {
          published += 1;
          app.log.info(
            {
              eventId: result.eventId,
              walletAddress: result.walletAddress,
              courseId: result.courseId,
              signature: result.signature,
            },
            'lock_vault_relay.published',
          );
          continue;
        }

        failed += 1;
        app.log.warn(
          {
            reason: result.reason,
            eventId: result.eventId ?? null,
            walletAddress: result.walletAddress ?? null,
            courseId: result.courseId ?? null,
            error: result.error ?? null,
          },
          'lock_vault_relay.skipped',
        );
      }

      if (published > 0 || failed > 0) {
        app.log.info(
          {
            published,
            failed,
            batchSize: appConfig.lockVaultRelayBatchSize,
          },
          'lock_vault_relay.cycle_complete',
        );
      }
    } catch (error) {
      app.log.error({ err: error }, 'lock_vault_relay.cycle_failed');
    } finally {
      inFlight = false;
      scheduleNextRun();
    }
  }

  app.addHook('onReady', async () => {
    if (!appConfig.lockVaultRelayEnabled) {
      app.log.info('LockVault relay worker disabled');
      return;
    }

    // Treasury-signing worker. Refuse on non-devnet clusters.
    if (!(appConfig.solanaRpcUrl ?? '').includes('devnet')) {
      app.log.error('CRITICAL: lock vault relay worker blocked on non-devnet cluster. Refusing to start.');
      return;
    }

    if (!hasLockVaultRelayConfig()) {
      app.log.warn('LockVault relay worker disabled because relay config is incomplete');
      return;
    }

    app.log.info(
      {
        intervalMs: appConfig.lockVaultRelayIntervalMs,
        batchSize: appConfig.lockVaultRelayBatchSize,
      },
      'LockVault relay worker started',
    );
    scheduleNextRun(1000);
  });

  app.addHook('onClose', async () => {
    stopped = true;
    clearTimer();
  });
}
