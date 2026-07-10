// v2 pot cycle orchestrator (pot-cycle ruling 2026-07-10, R5 + R6).
//
// v2 windows are closed ONLY through this cycle (R7). The existing v1
// endpoints /v1/internal/community-pot/windows/close and /windows/distribute
// remain untouched as MANUAL v1 ops — they must never be pointed at a v2
// window (their eligibility loop reads legacy lock PDAs).
//
// Money-handling posture (R13, fail closed everywhere):
//   - pot amounts come ONLY from indexed LockV2Settled events — the
//     commingled ops ATA (GCWEHFyJ…, pot_vault == fee_vault == the deployer's
//     canonical USDC ATA) is NEVER swept;
//   - the deployer key NEVER appears here or anywhere on Render — the funding
//     leg is the LOCAL operator script scripts/bridge-v2-pot-transfer.mjs;
//   - payouts go ONLY through distribute_window (DistributionReceipt +
//     remaining_amount cap are the only double-pay/over-distribution guards);
//   - payout amounts stay pinned to the seeded snapshot rows — the run FAILS
//     with POT_VAULT_UNDERFUNDED rather than scale to the live balance;
//   - the target is always a fully elapsed UTC month, never current/future.
//
// execute=false performs ZERO on-chain sends and returns the eligibility +
// payout preview.

import { appConfig } from '../config.mjs';
import { getPool, hasDatabase, query } from './db.mjs';
import {
  deriveCommunityPotWindowId,
  ensureCommunityPotVaultAta,
  getCommunityPotRelayAuthority,
  hasCommunityPotRelayConfig,
  readCommunityPotConfig,
  readCommunityPotDistributionWindow,
  readCommunityPotVaultBalance,
  readCommunityPotWindow,
} from './communityPot.mjs';
import { recordPendingSettleEvents, scanV2SettleEvents } from './potBridge.mjs';
import {
  closeCommunityPotWindowAndSnapshotV2,
  distributeCommunityPotWindowBatch,
} from '../modules/progress/repository.mjs';

// 727274001 is migrate.mjs's advisory-lock key; this one is the pot cycle's.
export const POT_CYCLE_ADVISORY_LOCK_KEY = 727274002;

// Verified live: PotConfig.authority AND the live v2 config.authority both
// equal the Render relay worker key. The preflight compares PotConfig
// authority to the ACTUAL relay signer; this constant is for the loud log.
const EXPECTED_RELAY_AUTHORITY = '2myuLZ82FoZgk9rboKpog2n5qbHvoWeCxJ75R2n4VF1t';
const COMMINGLED_OPS_VAULT = 'GCWEHFyJPS3ARfXk9V3jnfsZfaFCe8xmQfPKknjMM3yJ';
const BRIDGE_REMEDY =
  'run `node scripts/bridge-v2-pot-transfer.mjs --execute` locally with the ' +
  'deployer key, then re-trigger the pot cycle';

const MAX_DISTRIBUTE_ITERATIONS = 100;

function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (key, val) => (typeof val === 'bigint' ? val.toString() : val)),
  );
}

/**
 * The pot cycle's target: the previous UTC month — derived as the month of
 * (first day of the current UTC month minus 1 day). Exported for the R14
 * month-boundary unit tests.
 */
export function derivePreviousUtcMonthWindowId(now = new Date()) {
  const firstOfCurrentMonthUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return deriveCommunityPotWindowId(new Date(firstOfCurrentMonthUtc - 86_400_000));
}

/**
 * Global solvency requirement (R3's formula, shared with the bridge script):
 * SUM over all known window ids (settle events UNION distribution snapshots
 * UNION harvest receipts) of PotWindow.total_redirected_amount minus
 * DistributionWindow.distributed_amount (when the DistributionWindow exists).
 */
export async function computeRequiredPotFunding({
  readPotWindow = readCommunityPotWindow,
  readDistributionWindow = readCommunityPotDistributionWindow,
} = {}) {
  const idsResult = await query(
    `
      select window_id from (
        select distinct window_id from lesson.v2_pot_settle_events
        union
        select distinct window_id from lesson.community_pot_distribution_snapshots
        union
        select distinct community_pot_window_id from lesson.harvest_result_receipts
        where community_pot_window_id is not null
      ) windows
      where window_id is not null
      order by window_id asc
    `,
  );

  let required = 0n;
  const perWindow = [];
  for (const row of idsResult.rows) {
    const windowId = Number(row.window_id);
    const potWindow = await readPotWindow(windowId);
    if (!potWindow) {
      continue;
    }
    const total = BigInt(potWindow.totalRedirectedAmount ?? 0);
    const distributionWindow = await readDistributionWindow(windowId);
    const distributed = distributionWindow
      ? BigInt(distributionWindow.distributedAmount ?? 0)
      : 0n;
    const outstanding = total > distributed ? total - distributed : 0n;
    if (outstanding > 0n) {
      required += outstanding;
      perWindow.push({ windowId, outstandingAtomic: outstanding.toString() });
    }
  }

  return { required, perWindow };
}

/**
 * Reclaim snapshot rows stuck in 'publishing' for the target window. Only
 * rows older than 15 minutes are touched. Safe ONLY because distribute_window
 * early-returns on an existing DistributionReceipt (pot.rs:157-159) — a retry
 * of a row whose transaction actually landed is a no-op on-chain.
 */
export async function reclaimStalePublishingRows(windowId) {
  const result = await query(
    `
      update lesson.community_pot_distribution_snapshots
      set status = 'failed',
          distribution_last_error = 'reclaimed stale publishing',
          updated_at = now()
      where window_id = $1
        and status = 'publishing'
        and updated_at < now() - interval '15 minutes'
      returning wallet_address as "walletAddress", course_id as "courseId"
    `,
    [windowId],
  );
  return result.rows;
}

async function countUndistributedRows(windowId) {
  const result = await query(
    `
      select
        count(*)::int as total,
        count(*) filter (where status != 'distributed')::int as "notDistributed"
      from lesson.community_pot_distribution_snapshots
      where window_id = $1
    `,
    [windowId],
  );
  return result.rows[0];
}

/**
 * Run one full pot cycle for the target window (default: previous UTC month).
 * Returns { ok, benign, reason, windowId, execute, detail }. Benign exits per
 * R7's taxonomy: NOTHING_TO_DISTRIBUTE; ALREADY_CLOSED with seeded rows and
 * nothing pending; NO_PENDING_RECIPIENTS with all rows distributed (plus
 * PREVIEW, which only exists under execute=false). Everything else is a
 * failure (HTTP 500 / exit 1).
 *
 * `deps` is a test-injection surface; production callers pass nothing.
 */
export async function runPotCycle({
  windowId = null,
  execute = false,
  log = console,
  deps = {},
} = {}) {
  const {
    scanSettleEvents = scanV2SettleEvents,
    recordSettleEvents = recordPendingSettleEvents,
    readPotWindow = readCommunityPotWindow,
    readDistributionWindow = readCommunityPotDistributionWindow,
    readVaultBalance = readCommunityPotVaultBalance,
    readPotConfig = readCommunityPotConfig,
    relayAuthority = getCommunityPotRelayAuthority,
    ensureVaultAta = ensureCommunityPotVaultAta,
    closeWindowV2 = closeCommunityPotWindowAndSnapshotV2,
    closeDistributionWindow = undefined, // repository default (real relay)
    distributeBatch = distributeCommunityPotWindowBatch,
  } = deps;

  const startedAt = new Date();
  const nowWindowId = deriveCommunityPotWindowId(startedAt);
  const target =
    windowId != null ? Number(windowId) : derivePreviousUtcMonthWindowId(startedAt);

  // R5 step 11: a lesson.pot_cycle_runs receipt row in success AND failure
  // paths. A receipt-write failure never masks the run's actual result — it
  // is logged loudly and attached instead.
  const finish = async (result) => {
    const final = { windowId: target, execute, ...result };
    try {
      if (hasDatabase()) {
        await query(
          `insert into lesson.pot_cycle_runs
             (window_id, started_at, finished_at, status, detail)
           values ($1, $2, now(), $3, $4::jsonb)`,
          [
            target,
            startedAt.toISOString(),
            final.reason,
            JSON.stringify(
              jsonSafe({ ok: final.ok, benign: final.benign, execute, detail: final.detail ?? null }),
            ),
          ],
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log?.error?.({ error: message }, 'pot_cycle.receipt_write_failed');
      final.receiptError = message;
    }
    return final;
  };

  try {
    // ------------------------------------------------------------------ (1)
    // R6 preflight — before any send; every failure is loud.
    const preflightFailures = [];
    if (!appConfig.vaultV2ProgramId) {
      preflightFailures.push('vaultV2ProgramId is empty');
    }
    if (!appConfig.communityPotProgramId) {
      preflightFailures.push('communityPotProgramId is empty');
    }
    if (
      appConfig.vaultV2ProgramId &&
      appConfig.communityPotProgramId &&
      appConfig.vaultV2ProgramId === appConfig.communityPotProgramId
    ) {
      // The config.mjs fallback chains make an env mixup silent otherwise.
      preflightFailures.push(
        'vaultV2ProgramId equals communityPotProgramId — env mixup (expected the vault_v2 program vs the merged locked_in program)',
      );
    }
    if (!hasCommunityPotRelayConfig()) {
      preflightFailures.push('community pot relay config is incomplete');
    }
    if (!hasDatabase()) {
      preflightFailures.push('DATABASE_URL is not configured');
    }
    if (preflightFailures.length > 0) {
      return finish({
        ok: false,
        benign: false,
        reason: 'PREFLIGHT_FAILED',
        detail: { failures: preflightFailures },
      });
    }

    const potConfig = await readPotConfig();
    if (!potConfig) {
      return finish({
        ok: false,
        benign: false,
        reason: 'PREFLIGHT_FAILED',
        detail: {
          failures: [
            'PotConfig (seed pot-protocol) does not exist — run scripts/init-community-pot-protocol.mjs manually; the pot cycle NEVER auto-initializes',
          ],
        },
      });
    }
    const signerAuthority = relayAuthority();
    if (potConfig.authority !== signerAuthority) {
      return finish({
        ok: false,
        benign: false,
        reason: 'PREFLIGHT_FAILED',
        detail: {
          failures: [
            `PotConfig.authority ${potConfig.authority} does not match the relay signer ${signerAuthority} (expected ${EXPECTED_RELAY_AUTHORITY})`,
          ],
        },
      });
    }
    if (execute) {
      // The ONLY account creation the cron may do (worker pays rent).
      await ensureVaultAta();
    }
    log?.warn?.(
      { commingledOpsVault: COMMINGLED_OPS_VAULT },
      'pot_cycle.v2_pot_vault_equals_fee_vault — pot amounts are event-derived from LockV2Settled by construction; the ops ATA is never swept',
    );

    // ------------------------------------------------------------------ (2)
    // Target window: previous UTC month; NEVER current or future.
    if (target >= nowWindowId) {
      return finish({
        ok: false,
        benign: false,
        reason: 'WINDOW_NOT_PAST',
        detail: {
          target,
          currentWindowId: nowWindowId,
          message: 'the pot cycle only ever targets a fully elapsed UTC month',
        },
      });
    }

    // ------------------------------------------------------------------ (3)
    // ONE dedicated client held for the whole run: advisory locks are
    // session-scoped, so pooled query() calls must never be used for them.
    const pool = getPool();
    const client = await pool.connect();
    let lockAcquired = false;
    try {
      const lockResult = await client.query(
        'select pg_try_advisory_lock($1, $2) as locked',
        [POT_CYCLE_ADVISORY_LOCK_KEY, target],
      );
      if (!lockResult.rows[0]?.locked) {
        return finish({
          ok: false,
          benign: false,
          reason: 'POT_CYCLE_ALREADY_RUNNING',
          detail: { advisoryLockKey: POT_CYCLE_ADVISORY_LOCK_KEY, target },
        });
      }
      lockAcquired = true;

      // ---------------------------------------------------------------- (4)
      // Scan + record. Scanning is read-only on-chain; the record leg skips
      // ALL sends when execute=false.
      const scan = await scanSettleEvents({ log });
      const record = await recordSettleEvents({ execute, log });

      // ---------------------------------------------------------------- (5)
      const potWindow = await readPotWindow(target);
      if (!potWindow || BigInt(potWindow.totalRedirectedAmount ?? 0) === 0n) {
        return finish({
          ok: true,
          benign: true,
          reason: 'NOTHING_TO_DISTRIBUTE',
          detail: { scan: jsonSafe(scan), record: jsonSafe(record) },
        });
      }

      // ---------------------------------------------------------------- (6)
      // Solvency preflight: the PDA pot vault must cover every undistributed
      // recorded total globally. NEVER scale or re-pin payout amounts to the
      // live balance — fail and name the bridge script instead.
      const funding = await computeRequiredPotFunding({
        readPotWindow,
        readDistributionWindow,
      });
      const vaultBalance = await readVaultBalance();
      const balanceAtomic = BigInt(vaultBalance.balanceAtomic ?? 0);
      if (balanceAtomic < funding.required) {
        return finish({
          ok: false,
          benign: false,
          reason: 'POT_VAULT_UNDERFUNDED',
          detail: {
            potVault: vaultBalance.potVault,
            balanceAtomic: balanceAtomic.toString(),
            requiredAtomic: funding.required.toString(),
            perWindow: funding.perWindow,
            remedy: BRIDGE_REMEDY,
          },
        });
      }

      // ---------------------------------------------------------------- (7)
      const closeResult = await closeWindowV2(target, null, {
        execute,
        readDistributionWindow,
        readPotWindow,
        closeDistributionWindow,
      });

      if (!execute) {
        // Preview: zero on-chain sends happened anywhere above. Benignity
        // follows the same taxonomy as the real run.
        const rowsState = await countUndistributedRows(target);
        const benign =
          closeResult.reason === 'PREVIEW' ||
          closeResult.reason === 'NOTHING_TO_DISTRIBUTE' ||
          (closeResult.reason === 'ALREADY_CLOSED' &&
            rowsState.total > 0 &&
            rowsState.notDistributed === 0);
        return finish({
          ok: benign,
          benign,
          reason: closeResult.reason,
          detail: {
            preview: jsonSafe(closeResult),
            scan: jsonSafe(scan),
            record: jsonSafe(record),
            snapshotRows: rowsState,
            solvency: {
              balanceAtomic: balanceAtomic.toString(),
              requiredAtomic: funding.required.toString(),
            },
          },
        });
      }

      if (closeResult.reason !== 'CLOSED' && closeResult.reason !== 'ALREADY_CLOSED') {
        // NO_ELIGIBLE_RECIPIENTS, NO_DATABASE, COMMUNITY_POT_RELAY_DISABLED,
        // NOTHING_TO_DISTRIBUTE (raced) — all need operator eyes.
        return finish({
          ok: false,
          benign: false,
          reason: closeResult.reason,
          detail: { close: jsonSafe(closeResult) },
        });
      }
      const resumedAlreadyClosed = closeResult.reason === 'ALREADY_CLOSED';

      // ---------------------------------------------------------------- (8)
      const reclaimed = await reclaimStalePublishingRows(target);
      if (reclaimed.length > 0) {
        log?.warn?.(
          { windowId: target, reclaimed },
          'pot_cycle.reclaimed_stale_publishing_rows',
        );
      }

      // ---------------------------------------------------------------- (9)
      let iterations = 0;
      let distributedCount = 0;
      let failedCount = 0;
      let firstBatchNoPending = false;
      for (;;) {
        iterations += 1;
        if (iterations > MAX_DISTRIBUTE_ITERATIONS) {
          return finish({
            ok: false,
            benign: false,
            reason: 'DISTRIBUTION_LOOP_EXCEEDED',
            detail: { iterations: iterations - 1, distributedCount, failedCount },
          });
        }
        const batch = await distributeBatch(target, 10, true);
        if (batch.reason === 'NO_PENDING_RECIPIENTS') {
          if (iterations === 1) {
            firstBatchNoPending = true;
          }
          break;
        }
        if (!batch.processed) {
          return finish({
            ok: false,
            benign: false,
            reason: batch.reason,
            detail: { iterations, distributedCount, failedCount },
          });
        }
        for (const entry of batch.results ?? []) {
          if (entry.status === 'distributed') {
            distributedCount += 1;
          } else {
            failedCount += 1;
          }
        }
      }

      // --------------------------------------------------------------- (10)
      // Final audit: every snapshot row for the target must be distributed.
      const audit = await countUndistributedRows(target);
      if (audit.notDistributed > 0) {
        return finish({
          ok: false,
          benign: false,
          reason: 'DISTRIBUTION_INCOMPLETE',
          detail: {
            snapshotRows: audit,
            iterations,
            distributedCount,
            failedCount,
            reclaimedStale: reclaimed.length,
          },
        });
      }

      const reason =
        resumedAlreadyClosed && firstBatchNoPending && distributedCount === 0
          ? 'ALREADY_CLOSED'
          : 'NO_PENDING_RECIPIENTS';
      return finish({
        ok: true,
        benign: true,
        reason,
        detail: {
          snapshotRows: audit,
          iterations,
          distributedCount,
          failedCount,
          reclaimedStale: reclaimed.length,
          scan: jsonSafe(scan),
          record: jsonSafe(record),
        },
      });
    } finally {
      try {
        if (lockAcquired) {
          await client.query('select pg_advisory_unlock($1, $2)', [
            POT_CYCLE_ADVISORY_LOCK_KEY,
            target,
          ]);
        }
      } finally {
        client.release();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log?.error?.({ error: message, windowId: target }, 'pot_cycle.failed');
    return finish({
      ok: false,
      benign: false,
      reason: error?.code === 'WINDOW_NOT_PAST' ? 'WINDOW_NOT_PAST' : 'POT_CYCLE_ERROR',
      detail: { error: message },
    });
  }
}
