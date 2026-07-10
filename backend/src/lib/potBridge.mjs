// v2 pot bridge — LockV2Settled event indexer + per-event record leg
// (pot-cycle ruling 2026-07-10, R2).
//
// Why per-event: the live devnet v2 config has pot_vault == fee_vault ==
// the deployer's own USDC ATA (GCWEHFyJ…), permanently commingled
// (set_config_v2 cannot repoint either vault). Sweeping that balance would
// sweep platform fees into the community pot, so pot amounts are derived
// ONLY from vault_v2's LockV2Settled events ({ lock, to_owner, to_pot, fee,
// forced }), each attributed to deriveCommunityPotWindowId(blockTime).
//
// Idempotency spine, in order of authority:
//   1. on-chain RedirectReceipt — record_redirect early-returns on a retry
//      (pot.rs:42-45), keyed by sha256(redirectEventId);
//   2. lesson.v2_pot_settle_events PK (tx_signature, lock_address) — a
//      re-scan re-inserts with ON CONFLICT DO NOTHING;
//   3. the scan cursor (v2_pot_scan_state.last_signature) only advances
//      AFTER the batch inserts commit — a crash mid-scan re-reads, never
//      skips.
//
// Closed-window re-book guard: record_redirect has NO closed-window check
// (verified pot.rs:33-85) — recording into a window whose DistributionWindow
// already exists strands the funds forever. Before publishing, any event
// whose window is already closed is re-booked into the CURRENT open UTC
// month.

import crypto from 'node:crypto';
import { Connection, PublicKey } from '@solana/web3.js';
import { appConfig } from '../config.mjs';
import { query, withTransaction } from './db.mjs';
import {
  deriveCommunityPotWindowId,
  publishRedirectToCommunityPot,
  readCommunityPotDistributionWindow,
} from './communityPot.mjs';

// Anchor event discriminator: sha256('event:LockV2Settled')[..8].
const LOCK_V2_SETTLED_DISCRIMINATOR = crypto
  .createHash('sha256')
  .update('event:LockV2Settled')
  .digest()
  .subarray(0, 8);

const PROGRAM_DATA_PREFIX = 'Program data: ';
// Layout after the 8-byte discriminator:
// lock Pubkey(32) + to_owner u64 + to_pot u64 + fee u64 + forced u8 = 57.
const EVENT_PAYLOAD_LENGTH = 8 + 32 + 8 + 8 + 8 + 1;

let scanConnection = null;
function getScanConnection() {
  if (!scanConnection) {
    scanConnection = new Connection(appConfig.solanaRpcUrl, 'confirmed');
  }
  return scanConnection;
}

/**
 * Decode every LockV2Settled event from a transaction's log messages.
 * Exported for the R14 unit tests; pure.
 */
export function decodeLockV2SettledFromLogs(logMessages) {
  const events = [];
  for (const line of logMessages ?? []) {
    if (typeof line !== 'string' || !line.startsWith(PROGRAM_DATA_PREFIX)) {
      continue;
    }
    let decoded;
    try {
      decoded = Buffer.from(line.slice(PROGRAM_DATA_PREFIX.length), 'base64');
    } catch {
      continue;
    }
    if (
      decoded.length < EVENT_PAYLOAD_LENGTH ||
      !decoded.subarray(0, 8).equals(LOCK_V2_SETTLED_DISCRIMINATOR)
    ) {
      continue;
    }
    events.push({
      lock: new PublicKey(decoded.subarray(8, 40)).toBase58(),
      toOwner: decoded.readBigUInt64LE(40),
      toPot: decoded.readBigUInt64LE(48),
      fee: decoded.readBigUInt64LE(56),
      forced: decoded.readUInt8(64) === 1,
    });
  }
  return events;
}

/** A timestamp guaranteed to fall inside the window's UTC month. Prefers the
 * real block time when it maps to the window (audit-friendly); otherwise a
 * synthetic timestamp on the 2nd of the month (never a boundary). */
function timestampInsideWindow(windowId, blockTime = null) {
  if (blockTime != null) {
    const candidate = new Date(blockTime);
    if (
      Number.isFinite(candidate.getTime()) &&
      deriveCommunityPotWindowId(candidate) === Number(windowId)
    ) {
      return candidate.toISOString();
    }
  }
  const year = Math.floor(Number(windowId) / 100);
  const month = Number(windowId) % 100;
  return new Date(Date.UTC(year, month - 1, 2)).toISOString();
}

/**
 * Scan the vault_v2 program's signatures since the persisted cursor, decode
 * LockV2Settled events from 'Program data:' logs, and insert every to_pot > 0
 * event into lesson.v2_pot_settle_events (ON CONFLICT DO NOTHING). The scan
 * cursor advances only AFTER the batch inserts commit. Read-only on-chain —
 * safe under execute=false.
 */
export async function scanV2SettleEvents({ log = null, deps = {} } = {}) {
  const { connection = getScanConnection() } = deps;

  if (!appConfig.vaultV2ProgramId) {
    throw new Error('vaultV2ProgramId is not configured — refusing to scan.');
  }
  const programId = new PublicKey(appConfig.vaultV2ProgramId);

  const stateResult = await query(
    'select last_signature from lesson.v2_pot_scan_state where id = 1',
  );
  const until = stateResult.rows[0]?.last_signature ?? undefined;

  // getSignaturesForAddress returns newest-first; page back to `until`, then
  // reverse so events are processed oldest-first.
  const signatureInfos = [];
  let before;
  for (;;) {
    const page = await connection.getSignaturesForAddress(
      programId,
      { until, before, limit: 1000 },
      'confirmed',
    );
    if (page.length === 0) {
      break;
    }
    signatureInfos.push(...page);
    if (page.length < 1000) {
      break;
    }
    before = page[page.length - 1].signature;
  }
  signatureInfos.reverse();

  const newestSignature =
    signatureInfos.length > 0
      ? signatureInfos[signatureInfos.length - 1].signature
      : null;

  const rows = [];
  for (const info of signatureInfos) {
    if (info.err) {
      continue;
    }
    const tx = await connection.getTransaction(info.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || tx.meta?.err) {
      continue;
    }
    const events = decodeLockV2SettledFromLogs(tx.meta?.logMessages);
    if (events.length === 0) {
      continue;
    }
    const blockTime = info.blockTime ?? tx.blockTime ?? null;
    if (blockTime == null) {
      // Cannot attribute a window without a block time — loud skip; the event
      // stays visible in logs for a manual re-book. Never guess a month.
      log?.warn?.(
        { signature: info.signature },
        'pot_bridge.settle_event_missing_block_time',
      );
      continue;
    }
    const blockTimeMs = blockTime * 1000;
    for (const event of events) {
      if (event.toPot <= 0n) {
        continue;
      }
      rows.push({
        txSignature: info.signature,
        lockAddress: event.lock,
        toPot: event.toPot,
        blockTimeMs,
        windowId: deriveCommunityPotWindowId(blockTimeMs),
      });
    }
  }

  if (rows.length > 0) {
    await withTransaction(async (client) => {
      for (const row of rows) {
        await client.query(
          `insert into lesson.v2_pot_settle_events
             (tx_signature, lock_address, to_pot, block_time, window_id)
           values ($1, $2, $3::bigint, $4, $5::bigint)
           on conflict do nothing`,
          [
            row.txSignature,
            row.lockAddress,
            row.toPot.toString(),
            new Date(row.blockTimeMs).toISOString(),
            row.windowId,
          ],
        );
      }
    });
  }

  // Cursor advances only after the inserts above committed.
  if (newestSignature) {
    await query(
      `insert into lesson.v2_pot_scan_state (id, last_signature, updated_at)
       values (1, $1, now())
       on conflict (id) do update
         set last_signature = excluded.last_signature, updated_at = now()`,
      [newestSignature],
    );
  }

  return {
    scannedSignatures: signatureInfos.length,
    settleEventsFound: rows.length,
    newestSignature,
  };
}

/**
 * Publish every pending/failed settle event to the merged program's pot via
 * the existing record_redirect relay. Per event:
 *   - closed-window re-book guard: if the event's window already has a
 *     DistributionWindow, re-book the row into the current open UTC month
 *     BEFORE publishing (a post-close record_redirect strands funds);
 *   - redirectEventId = `v2-settle:${tx_signature}:${lock_address}` — the
 *     on-chain RedirectReceipt makes a crash between publish and mark safe;
 *   - a row is NEVER marked 'published' without a confirmed signature.
 * execute=false performs ZERO on-chain sends and ZERO row mutations — it only
 * reports what would be published.
 */
export async function recordPendingSettleEvents({
  execute = true,
  log = null,
  deps = {},
} = {}) {
  const {
    readDistributionWindow = readCommunityPotDistributionWindow,
    publishRedirect = publishRedirectToCommunityPot,
    now = () => new Date(),
  } = deps;

  const pendingResult = await query(
    `select
       tx_signature as "txSignature",
       lock_address as "lockAddress",
       to_pot as "toPot",
       block_time as "blockTime",
       window_id as "windowId"
     from lesson.v2_pot_settle_events
     where record_status in ('pending', 'failed')
     order by block_time asc, tx_signature asc, lock_address asc`,
  );

  if (!execute) {
    return {
      executed: false,
      pending: pendingResult.rows.length,
      published: 0,
      rebooked: 0,
      failed: 0,
      rows: pendingResult.rows.map((row) => ({
        txSignature: row.txSignature,
        lockAddress: row.lockAddress,
        toPot: String(row.toPot),
        windowId: Number(row.windowId),
      })),
    };
  }

  const closedWindowCache = new Map();
  const counters = { executed: true, pending: pendingResult.rows.length, published: 0, rebooked: 0, failed: 0 };

  for (const row of pendingResult.rows) {
    let windowId = Number(row.windowId);

    let windowClosed = closedWindowCache.get(windowId);
    if (windowClosed === undefined) {
      windowClosed = (await readDistributionWindow(windowId)) != null;
      closedWindowCache.set(windowId, windowClosed);
    }

    if (windowClosed) {
      // R2 re-book: the window is already closed — record_redirect has no
      // closed-window guard, so booking there would strand the amount. Move
      // the event into the current open month first.
      const rebookedWindowId = deriveCommunityPotWindowId(now());
      await query(
        `update lesson.v2_pot_settle_events
         set window_id = $3::bigint, updated_at = now()
         where tx_signature = $1 and lock_address = $2`,
        [row.txSignature, row.lockAddress, rebookedWindowId],
      );
      log?.info?.(
        {
          txSignature: row.txSignature,
          lockAddress: row.lockAddress,
          fromWindowId: windowId,
          toWindowId: rebookedWindowId,
        },
        'pot_bridge.settle_event_rebooked',
      );
      windowId = rebookedWindowId;
      counters.rebooked += 1;
    }

    try {
      const result = await publishRedirect({
        redirectEventId: `v2-settle:${row.txSignature}:${row.lockAddress}`,
        harvestedAt: timestampInsideWindow(
          windowId,
          windowClosed ? null : row.blockTime,
        ),
        redirectedAmount: String(row.toPot),
      });
      if (!result?.signature) {
        // Never mark 'published' without a confirmed signature.
        throw new Error('publishRedirectToCommunityPot returned no signature');
      }
      await query(
        `update lesson.v2_pot_settle_events
         set record_status = 'published',
             record_signature = $3,
             record_last_error = null,
             updated_at = now()
         where tx_signature = $1 and lock_address = $2`,
        [row.txSignature, row.lockAddress, result.signature],
      );
      counters.published += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await query(
        `update lesson.v2_pot_settle_events
         set record_status = 'failed',
             record_last_error = $3,
             updated_at = now()
         where tx_signature = $1 and lock_address = $2`,
        [row.txSignature, row.lockAddress, message],
      );
      counters.failed += 1;
      log?.warn?.(
        { txSignature: row.txSignature, lockAddress: row.lockAddress, error: message },
        'pot_bridge.settle_event_publish_failed',
      );
    }
  }

  return counters;
}
