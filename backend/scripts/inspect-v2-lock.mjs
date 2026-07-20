// Support inspector for one user's v2 position: everything needed to answer
// "my claim failed" without guessing.
//
// The only per-lock inspector before this was scripts/inspect-lock-vault.mjs,
// which is pinned to the V1 program id, the V1 'lock' seed and the V1 account
// discriminator — it cannot read a v2 lock at all.
//
// Usage:
//   node scripts/inspect-v2-lock.mjs --wallet <address> [--course <courseId>] [--json]
//
// With no --course it inspects every course the wallet has an enrollment or a
// runtime-state row for.
//
// STRICTLY READ-ONLY: every DB read runs inside a `set transaction read only`
// transaction and no instruction is ever built or sent. Safe against prod.

import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { appConfig, CLUSTER } from '../src/config.mjs';
import { hasDatabase, withTransactionAsWallet } from '../src/lib/db.mjs';
import { deriveLockPdaServer, readLockPosition } from '../src/lib/lockPosition.mjs';

const CONFIG_SEED = Buffer.from('vault-v2b');

// LockV2 (vault_v2.rs): disc[8] owner[32] course_id_hash[32] principal u64@72
// lock_start_ts i64@80 status u8@88 bump u8@89.
const LOCK_STATUS = { 0: 'ACTIVE', 1: 'PENDING', 2: 'CLOSED' };

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function formatAtomicUi(atomic, decimals = 6) {
  const base = 10n ** BigInt(decimals);
  const whole = atomic / base;
  const frac = atomic % base;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

function tsToIso(seconds) {
  if (!seconds || seconds <= 0) return null;
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  return new Date(ms).toISOString();
}

function readPk(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

/** Decode VaultV2Config. Offsets mirror web-app/services/solana/vaultV2.ts. */
function decodeConfig(data) {
  return {
    authority: readPk(data, 8),
    usdcMint: readPk(data, 40),
    kaminoProgram: readPk(data, 72),
    kaminoReserve: readPk(data, 104),
    kaminoMarket: readPk(data, 136),
    kaminoLma: readPk(data, 168),
    kaminoLiquiditySupply: readPk(data, 200),
    collateralMint: readPk(data, 232),
    potVault: readPk(data, 264),
    feeVault: readPk(data, 296),
    minPrincipalUi: formatAtomicUi(data.readBigUInt64LE(328)),
    maxPrincipalPerLockUi: formatAtomicUi(data.readBigUInt64LE(336)),
    globalTvlCapUi: formatAtomicUi(data.readBigUInt64LE(344)),
    currentTvlUi: formatAtomicUi(data.readBigUInt64LE(352)),
    platformFeeBps: data.readUInt16LE(360),
    paused: data[362] === 1,
  };
}

function decodeLock(data) {
  return {
    owner: readPk(data, 8),
    courseIdHashHex: data.subarray(40, 72).toString('hex'),
    principalUi: formatAtomicUi(data.readBigUInt64LE(72)),
    principalAtomic: data.readBigUInt64LE(72).toString(),
    lockStartTs: Number(data.readBigInt64LE(80)),
    lockStartIso: tsToIso(Number(data.readBigInt64LE(80))),
    status: LOCK_STATUS[data[88]] ?? `UNKNOWN(${data[88]})`,
    bump: data[89],
  };
}

async function readDbRows(walletAddress, courseFilter) {
  if (!hasDatabase()) return null;

  return withTransactionAsWallet(walletAddress, async (client) => {
    // Belt-and-braces: even a typo'd query cannot mutate prod from here.
    await client.query('set transaction read only');

    const enrollments = await client.query(
      `select course_id, enrolled_at
         from lesson.user_course_enrollments
        where wallet_address = $1
          and ($2::text is null or course_id = $2)
        order by enrolled_at`,
      [walletAddress, courseFilter],
    );

    const runtimeState = await client.query(
      `select course_id, current_streak, longest_streak, shields, lapse_open,
              lapse_count, consecutive_lesson_days, course_completed_at,
              last_completed_day, lock_account_address, principal_amount,
              lock_start_at, lock_end_at, updated_at
         from lesson.user_course_runtime_state
        where wallet_address = $1
          and ($2::text is null or course_id = $2)
        order by course_id`,
      [walletAddress, courseFilter],
    );

    const vouchers = await client.query(
      `select course_id, lock_address, lapse_count, bps, expiry,
              authority_pubkey, signature, issued_at
         from lesson.completion_vouchers
        where wallet_address = $1
          and ($2::text is null or course_id = $2)
        order by course_id`,
      [walletAddress, courseFilter],
    );

    // Lesson progress against the PUBLISHED release — the same join the
    // voucher endpoint's completion check uses, so a mismatch here explains a
    // 403 "not complete" straight away.
    const progress = await client.query(
      `with published as (
         select pm.course_id, pl.lesson_id
           from lesson.published_modules pm
           join lesson.published_lessons pl
             on pl.module_id = pm.module_id and pl.release_id = pm.release_id
          where ($2::text is null or pm.course_id = $2)
       )
       select p.course_id,
              count(distinct p.lesson_id) as total_lessons,
              count(distinct ulp.lesson_id) filter (where ulp.completed) as completed_lessons,
              max(ulp.completed_at) as last_completed_at
         from published p
         left join lesson.user_lesson_progress ulp
           on ulp.lesson_id = p.lesson_id and ulp.wallet_address = $1
        group by p.course_id
        order by p.course_id`,
      [walletAddress, courseFilter],
    );

    return {
      enrollments: enrollments.rows,
      runtimeState: runtimeState.rows,
      vouchers: vouchers.rows,
      progress: progress.rows,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const walletArg = typeof args.wallet === 'string' ? args.wallet.trim() : '';
  const courseFilter = typeof args.course === 'string' ? args.course.trim() : null;
  const asJson = args.json === true;

  if (!walletArg) {
    console.error('Usage: node scripts/inspect-v2-lock.mjs --wallet <address> [--course <courseId>] [--json]');
    process.exit(1);
  }

  let wallet;
  try {
    wallet = new PublicKey(walletArg);
  } catch {
    console.error(`Not a valid Solana address: ${walletArg}`);
    process.exit(1);
  }

  const programId = appConfig.vaultV2ProgramId;
  if (!programId) {
    console.error('VAULT_V2_PROGRAM_ID is not configured — nothing to derive a v2 lock from.');
    process.exit(1);
  }

  const connection = new Connection(appConfig.solanaRpcUrl, 'confirmed');
  const report = {
    wallet: wallet.toBase58(),
    cluster: CLUSTER,
    rpcUrl: appConfig.solanaRpcUrl,
    vaultV2ProgramId: programId,
    config: null,
    walletUsdc: null,
    courses: [],
    db: null,
  };

  // ── VaultV2Config: the settings every lock below was read against ──
  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], new PublicKey(programId));
  const configInfo = await connection.getAccountInfo(configPda);
  report.config = configInfo
    ? { address: configPda.toBase58(), ...decodeConfig(configInfo.data) }
    : { address: configPda.toBase58(), missing: true };

  // ── Wallet USDC ATA: "the claim landed but I see nothing" starts here ──
  const usdcMint = report.config.usdcMint ?? appConfig.lockVaultUsdcMint;
  if (usdcMint) {
    const ata = getAssociatedTokenAddressSync(new PublicKey(usdcMint), wallet);
    try {
      const balance = await connection.getTokenAccountBalance(ata);
      report.walletUsdc = { mint: usdcMint, ata: ata.toBase58(), amountUi: balance.value.uiAmountString };
    } catch {
      report.walletUsdc = { mint: usdcMint, ata: ata.toBase58(), amountUi: null, note: 'ATA missing or unreadable' };
    }
  }

  // ── DB rows ──
  if (hasDatabase()) {
    try {
      report.db = await readDbRows(wallet.toBase58(), courseFilter);
    } catch (error) {
      report.db = { error: error?.message ?? String(error) };
    }
  } else {
    report.db = { error: 'DATABASE_URL is not configured — on-chain sections only.' };
  }

  // Course set: an explicit --course, else everything the DB knows about. A
  // wallet with no DB row still gets a chain read when --course is given, so a
  // deposit that never reached the backend is still visible.
  const courseIds = courseFilter
    ? [courseFilter]
    : [
        ...new Set([
          ...(report.db?.enrollments ?? []).map((row) => row.course_id),
          ...(report.db?.runtimeState ?? []).map((row) => row.course_id),
        ]),
      ];

  for (const courseId of courseIds) {
    const lockPda = deriveLockPdaServer(programId, wallet.toBase58(), courseId);
    const entry = { courseId, lockAddress: lockPda.toBase58() };

    const info = await connection.getAccountInfo(lockPda);
    if (!info) {
      // Claim and force-return CLOSE the PDA, so "missing" is the settled
      // state — not evidence that a deposit never happened.
      entry.onChain = { exists: false, note: 'No lock account (never opened, or already claimed/returned).' };
    } else {
      entry.onChain = { exists: true, programOwner: info.owner.toBase58(), ...decodeLock(info.data) };
      if (info.owner.toBase58() !== programId) {
        entry.onChain.warning = 'PROGRAM_OWNER_MISMATCH — this PDA is not owned by the configured v2 program.';
      } else if (entry.onChain.owner !== wallet.toBase58()) {
        entry.onChain.warning = 'LOCK_OWNER_MISMATCH — the lock stores a different owner.';
      }
    }

    // Live value via the same reader the position endpoint serves, cache
    // bypassed so support never reads a stale minute.
    try {
      const position = await readLockPosition(wallet.toBase58(), courseId, { bypassCache: true });
      entry.position = position;
    } catch (error) {
      entry.position = { error: error?.message ?? String(error) };
    }

    entry.db = {
      enrollment: (report.db?.enrollments ?? []).find((row) => row.course_id === courseId) ?? null,
      runtimeState: (report.db?.runtimeState ?? []).find((row) => row.course_id === courseId) ?? null,
      voucher: (report.db?.vouchers ?? []).find((row) => row.course_id === courseId) ?? null,
      progress: (report.db?.progress ?? []).find((row) => row.course_id === courseId) ?? null,
    };

    // The single most useful support signal: the stored lock pointer and the
    // v2 PDA the claim path derives disagree, so the user is looking at a v1
    // (or stale-program) lock while the v2 claim reads an empty address.
    const storedLock = entry.db.runtimeState?.lock_account_address ?? null;
    if (storedLock && storedLock !== entry.lockAddress) {
      entry.lockPointerMismatch = { storedInDb: storedLock, derivedV2: entry.lockAddress };
    }
    const voucherLock = entry.db.voucher?.lock_address ?? null;
    if (voucherLock && voucherLock !== entry.lockAddress) {
      entry.voucherLockMismatch = { issuedFor: voucherLock, derivedV2: entry.lockAddress };
    }

    report.courses.push(entry);
  }

  if (asJson) {
    console.log(JSON.stringify(report, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
    return;
  }

  console.log(`wallet   : ${report.wallet}`);
  console.log(`cluster  : ${report.cluster}  (${report.rpcUrl})`);
  console.log(`program  : ${report.vaultV2ProgramId}`);
  console.log('\n── VaultV2Config ──');
  console.log(report.config);
  console.log('\n── Wallet USDC ──');
  console.log(report.walletUsdc ?? 'no USDC mint configured');

  if (report.db?.error) console.log(`\n!! DB: ${report.db.error}`);

  if (report.courses.length === 0) {
    console.log('\nNo courses to inspect (no enrollment/runtime rows; pass --course to force a chain read).');
  }

  for (const entry of report.courses) {
    console.log(`\n══ ${entry.courseId} ══`);
    console.log(`lock PDA : ${entry.lockAddress}`);
    console.log('on-chain :', entry.onChain);
    console.log('position :', entry.position);
    console.log('enrollment   :', entry.db.enrollment);
    console.log('runtime state:', entry.db.runtimeState);
    console.log('progress     :', entry.db.progress);
    console.log('voucher      :', entry.db.voucher);
    if (entry.lockPointerMismatch) console.log('!! lock pointer mismatch:', entry.lockPointerMismatch);
    if (entry.voucherLockMismatch) console.log('!! voucher lock mismatch:', entry.voucherLockMismatch);
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  // RPC layers throw message-less errors often enough that the stack is the
  // only thing that tells support where it died.
  console.error('inspect-v2-lock failed:', error?.stack ?? error?.message ?? error);
  process.exit(1);
}
