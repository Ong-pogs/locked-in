// Runtime scheduler: hourly harvest tick per active lock.
//
// Fire-timer model: each user runs a fire that burns for 24h per fuel
// they feed (additive — feeding while lit stacks the timer). At each
// harvest tick we check whether the fire was lit AT THE HARVEST MOMENT.
// If yes, the gross yield routes to the user's unclaimed pool. If no,
// it routes to the community pot. Fuel auto-burn and miss-consequence
// flows from the gauntlet era have been removed — the fire timer is
// now the sole "did the user show up?" signal.
import { appConfig } from '../config.mjs';
import { hasLockVaultRelayConfig, readLockAccountSnapshot } from '../lib/lockVault.mjs';
import {
  createYieldStrategyAdapter,
  deriveHarvestBucketTimestamp,
  hasYieldStrategyConfig,
} from '../lib/yieldStrategy.mjs';
import {
  listRuntimeSchedulerCandidates,
  publishHarvestRedirectToCommunityPot,
  publishHarvestResultReceipt,
  recordHarvestResult,
  syncCourseRuntimeStateWithLockSnapshot,
} from '../modules/progress/repository.mjs';

async function deriveDueHarvest(runtime, snapshot, now, strategy) {
  const intervalSeconds = strategy.intervalSeconds;
  const intervalMs = intervalSeconds * 1000;
  const lastHarvestedAt = runtime.lastHarvestedAt
    ? new Date(runtime.lastHarvestedAt).getTime()
    : null;
  const cursorMs = Number.isFinite(lastHarvestedAt)
    ? lastHarvestedAt
    : new Date(runtime.updatedAt).getTime();

  if (!Number.isFinite(cursorMs)) {
    return null;
  }

  if (now.getTime() - cursorMs < intervalMs) {
    return null;
  }

  const harvestBucket = deriveHarvestBucketTimestamp(now, intervalSeconds);
  const elapsedSeconds = Math.max(
    intervalSeconds,
    Math.floor((now.getTime() - cursorMs) / 1000),
  );
  if (elapsedSeconds <= 0) {
    return null;
  }

  const quote = await strategy.quoteHarvest({
    principalAmount: snapshot.principalAmount,
    elapsedSeconds,
  });
  const grossYieldAmount = BigInt(quote.grossYieldAmount ?? '0');
  if (grossYieldAmount <= 0n) {
    return null;
  }

  const harvestedAtIso = now.toISOString();
  return {
    harvestId: `auto-harvest:${runtime.walletAddress}:${runtime.courseId}:${Math.floor(
      harvestBucket.getTime() / 1000,
    )}`,
    harvestedAt: harvestedAtIso,
    grossYieldAmount: grossYieldAmount.toString(),
    elapsedSeconds,
    apyBps: Number(quote.apyBps ?? 0),
  };
}

function isFireLitAt(runtime, moment) {
  if (!runtime?.fireLitUntil) return false;
  const litUntil = new Date(runtime.fireLitUntil).getTime();
  if (!Number.isFinite(litUntil)) return false;
  return litUntil > moment.getTime();
}

async function processRuntimeCandidate(app, candidate, now) {
  let snapshot;

  try {
    snapshot = await readLockAccountSnapshot(candidate.walletAddress, candidate.courseId);
  } catch (error) {
    app.log.warn(
      {
        walletAddress: candidate.walletAddress,
        courseId: candidate.courseId,
        error: error instanceof Error ? error.message : String(error),
      },
      'runtime_scheduler.lock_missing',
    );
    return { harvestProcessed: 0 };
  }

  const runtime = await syncCourseRuntimeStateWithLockSnapshot(
    candidate.walletAddress,
    candidate.courseId,
    snapshot,
  );

  let harvestProcessed = 0;

  if (!hasYieldStrategyConfig()) {
    return { harvestProcessed };
  }

  try {
    const strategy = createYieldStrategyAdapter();
    const dueHarvest = await deriveDueHarvest(
      {
        walletAddress: candidate.walletAddress,
        courseId: candidate.courseId,
        updatedAt: candidate.updatedAt,
        lastHarvestedAt: candidate.lastHarvestedAt,
      },
      snapshot,
      now,
      strategy,
    );

    if (!dueHarvest) {
      return { harvestProcessed };
    }

    const fireLit = isFireLitAt(runtime, now);
    // Fire lit at harvest moment → 0 redirected (full yield to user).
    // Fire out → full gross redirected to the community pot.
    const redirectedAmount = fireLit ? '0' : dueHarvest.grossYieldAmount;

    const recorded = await recordHarvestResult(
      candidate.walletAddress,
      candidate.courseId,
      dueHarvest.harvestId,
      dueHarvest.grossYieldAmount,
      dueHarvest.harvestedAt,
      redirectedAmount,
    );
    const lockVaultResult = await publishHarvestResultReceipt(
      candidate.walletAddress,
      candidate.courseId,
      dueHarvest.harvestId,
      true,
    );
    const communityPotResult = await publishHarvestRedirectToCommunityPot(
      candidate.walletAddress,
      candidate.courseId,
      dueHarvest.harvestId,
      true,
    );

    app.log.info(
      {
        walletAddress: candidate.walletAddress,
        courseId: candidate.courseId,
        harvestId: dueHarvest.harvestId,
        harvestedAt: dueHarvest.harvestedAt,
        grossYieldAmount: dueHarvest.grossYieldAmount,
        redirectedAmount,
        fireLit,
        elapsedSeconds: dueHarvest.elapsedSeconds,
        strategyKind: strategy.kind,
        quotedApyBps: dueHarvest.apyBps ?? null,
        recordStatus: recorded.yieldSplitterStatus ?? null,
        lockVaultReason: lockVaultResult.reason,
        communityPotReason: communityPotResult.reason,
        lockVaultSignature: lockVaultResult.signature ?? null,
      },
      'runtime_scheduler.harvest_processed',
    );
    harvestProcessed += 1;
  } catch (error) {
    app.log.warn(
      {
        walletAddress: candidate.walletAddress,
        courseId: candidate.courseId,
        error: error instanceof Error ? error.message : String(error),
      },
      'runtime_scheduler.harvest_skipped',
    );
  }

  return { harvestProcessed };
}

export function registerRuntimeSchedulerWorker(app) {
  let timer = null;
  let stopped = false;
  let inFlight = false;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleNextRun(delayMs = appConfig.runtimeSchedulerIntervalMs) {
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
      const candidates = await listRuntimeSchedulerCandidates(
        appConfig.runtimeSchedulerBatchSize,
      );
      let harvestProcessed = 0;

      for (const candidate of candidates) {
        const result = await processRuntimeCandidate(app, candidate, new Date());
        harvestProcessed += result.harvestProcessed;
      }

      if (harvestProcessed > 0) {
        app.log.info(
          {
            candidates: candidates.length,
            harvestProcessed,
          },
          'runtime_scheduler.cycle_complete',
        );
      }
    } catch (error) {
      app.log.error({ err: error }, 'runtime_scheduler.cycle_failed');
    } finally {
      inFlight = false;
      scheduleNextRun();
    }
  }

  app.addHook('onReady', async () => {
    if (!appConfig.runtimeSchedulerEnabled) {
      app.log.info('Runtime scheduler worker disabled');
      return;
    }

    if (!hasLockVaultRelayConfig()) {
      app.log.warn('Runtime scheduler worker disabled because relay config is incomplete');
      return;
    }

    app.log.info(
      {
        intervalMs: appConfig.runtimeSchedulerIntervalMs,
        batchSize: appConfig.runtimeSchedulerBatchSize,
        yieldStrategyProfile: appConfig.yieldStrategyProfile,
        yieldStrategyKind: appConfig.yieldStrategyKind,
      },
      'Runtime scheduler worker started',
    );
    scheduleNextRun(1000);
  });

  app.addHook('onClose', async () => {
    stopped = true;
    clearTimer();
  });
}
