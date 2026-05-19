// Runtime scheduler: hourly harvest tick + daily miss-consequence tick
// per active lock.
//
// Yield routing per harvest:
//   - Fire OUT (fire_lit_until <= now): 100% to community pot.
//   - Fire LIT: split by current_yield_redirect_bps (saver tier).
//     0 savers used → 0% pot, 100% user.
//     1/2/3 used   → 10/15/20% pot, rest to user.
//
// Miss consequence:
//   - Day after lastCompletedDay with no completion → consume one saver
//     (bumps redirect_bps). If all 3 savers are already used → streak
//     resets to 0, redirect stays at 20% cap.
import { appConfig } from '../config.mjs';
import { hasLockVaultRelayConfig, readLockAccountSnapshot } from '../lib/lockVault.mjs';
import {
  createYieldStrategyAdapter,
  deriveHarvestBucketTimestamp,
  hasYieldStrategyConfig,
} from '../lib/yieldStrategy.mjs';
import {
  consumeSaverOrApplyFullConsequence,
  listRuntimeSchedulerCandidates,
  publishHarvestRedirectToCommunityPot,
  publishHarvestResultReceipt,
  publishMissConsequenceReceipt,
  recordHarvestResult,
  syncCourseRuntimeStateWithLockSnapshot,
} from '../modules/progress/repository.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function addDays(dateText, delta) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  return new Date(date.getTime() + delta * DAY_MS).toISOString().slice(0, 10);
}

function maxIsoDate(...values) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function lockStartDayFromSnapshot(snapshot) {
  return new Date(snapshot.lockStartTs * 1000).toISOString().slice(0, 10);
}

function isFireLitAt(runtime, moment) {
  if (!runtime?.fireLitUntil) return false;
  const litUntil = new Date(runtime.fireLitUntil).getTime();
  if (!Number.isFinite(litUntil)) return false;
  return litUntil > moment.getTime();
}

function computeRedirectedAmount(grossYieldStr, fireLit, redirectBps) {
  if (!fireLit) return grossYieldStr;
  const bps = BigInt(redirectBps ?? 0);
  if (bps <= 0n) return '0';
  const gross = BigInt(grossYieldStr);
  return ((gross * bps) / 10_000n).toString();
}

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

function deriveDueMiss(runtime, snapshot, now) {
  // A miss event fires once per missed day. baseDay is the most recent
  // day we know about (last lesson, last miss, or the day before lock-up
  // for fresh locks); nextMissDay is the day after that. If nextMissDay
  // is strictly before today, that day went un-completed.
  const today = isoDate(now);
  const baseDay = maxIsoDate(
    runtime.lastCompletedDay,
    runtime.lastMissDay,
    addDays(lockStartDayFromSnapshot(snapshot), -1),
  );
  const nextMissDay = addDays(baseDay, 1);
  if (nextMissDay >= today) {
    return null;
  }
  return {
    missEventId: `auto-miss:${runtime.walletAddress}:${runtime.courseId}:${nextMissDay}`,
    missDay: nextMissDay,
  };
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
    return { harvestProcessed: 0, missProcessed: 0 };
  }

  const runtime = await syncCourseRuntimeStateWithLockSnapshot(
    candidate.walletAddress,
    candidate.courseId,
    snapshot,
  );

  let harvestProcessed = 0;
  let missProcessed = 0;

  // ── Harvest ────────────────────────────────────────────────────────
  if (hasYieldStrategyConfig()) {
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

      if (dueHarvest) {
        const fireLit = isFireLitAt(runtime, now);
        const redirectedAmount = computeRedirectedAmount(
          dueHarvest.grossYieldAmount,
          fireLit,
          runtime?.currentYieldRedirectBps,
        );

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
            redirectBps: runtime?.currentYieldRedirectBps ?? 0,
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
      }
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
  }

  // ── Miss-day consequence ───────────────────────────────────────────
  const dueMiss = deriveDueMiss(
    {
      ...runtime,
      walletAddress: candidate.walletAddress,
      lastMissDay: candidate.lastMissDay,
    },
    snapshot,
    now,
  );

  if (dueMiss) {
    try {
      const missResult = await consumeSaverOrApplyFullConsequence(
        candidate.walletAddress,
        candidate.courseId,
        dueMiss.missEventId,
        dueMiss.missDay,
      );
      const publishResult = await publishMissConsequenceReceipt(
        candidate.walletAddress,
        candidate.courseId,
        dueMiss.missEventId,
      );

      app.log.info(
        {
          walletAddress: candidate.walletAddress,
          courseId: candidate.courseId,
          missEventId: dueMiss.missEventId,
          missDay: dueMiss.missDay,
          missReason: missResult.reason,
          relayReason: publishResult.reason,
        },
        'runtime_scheduler.miss_processed',
      );
      missProcessed += 1;
    } catch (error) {
      app.log.warn(
        {
          walletAddress: candidate.walletAddress,
          courseId: candidate.courseId,
          missEventId: dueMiss.missEventId,
          error: error instanceof Error ? error.message : String(error),
        },
        'runtime_scheduler.miss_skipped',
      );
    }
  }

  return { harvestProcessed, missProcessed };
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
      let missProcessed = 0;

      for (const candidate of candidates) {
        const result = await processRuntimeCandidate(app, candidate, new Date());
        harvestProcessed += result.harvestProcessed;
        missProcessed += result.missProcessed;
      }

      if (harvestProcessed > 0 || missProcessed > 0) {
        app.log.info(
          {
            candidates: candidates.length,
            harvestProcessed,
            missProcessed,
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
