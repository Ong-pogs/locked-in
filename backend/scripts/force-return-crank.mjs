// Force-return crank (spec §4.2): daily sweep that returns principal on
// abandoned v2 locks. Scans the program's LockV2 accounts, keeps those with
// status == ACTIVE whose lock_start_ts is at least 180 days old, and submits
// a sponsored force_return_v2 for each (worker key pays; on-chain the owner
// gets principal + rent, all yield goes to the pot).
//
// Everything that can be wrong twice is safe here:
//   - replay/races: force_return_v2 requires the lock to still be ACTIVE, so a
//     re-submission (or a user claiming between scan and submit) fails on-chain
//     without moving funds; each lock is tried independently (per-lock catch).
//   - owner's USDC ATA closed: an idempotent create-ATA (paid by the caller)
//     is prepended, since ForceReturnV2 does NOT init_if_needed owner_usdc.
//   - real Kamino: klend rejects settles against a stale reserve, so a klend
//     refresh_reserve is prepended in the same tx whenever the config pins the
//     real klend program (never on the devnet mock, which needs no refresh).
//
// The tx-building here is pure and unit-tested against the ForceReturnV2
// accounts struct in programs/locked_in/src/vault_v2.rs; main() only wires RPC.
//
// Usage: node scripts/force-return-crank.mjs [--dry-run]

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bs58Module from 'bs58';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { appConfig } from '../src/config.mjs';

const bs58 = bs58Module.decode ? bs58Module : bs58Module.default;

// ── constants (pinned against the Rust program) ───────────────────────────

// caps.rs FORCE_RETURN_AFTER_SECS — 180 days.
export const FORCE_RETURN_AFTER_SECS = 15_552_000;

// LockV2 status byte (vault_v2.rs).
export const LOCK_STATUS_ACTIVE = 0;

// 8 disc + 32 owner + 32 course_id_hash + 8 principal + 8 lock_start + 1 status + 1 bump.
export const LOCKV2_ACCOUNT_SIZE = 90;

// Config seed "vault-v2b" — matches vault_v2.rs CONFIG_SEED and every
// devnet-proven client (lockPosition.mjs, the programs-tests scripts).
// Overridable for a rebuild that changes the seed.
export const CONFIG_SEED = process.env.VAULT_V2_CONFIG_SEED ?? 'vault-v2b';

// kamino.rs KLEND_PROGRAM_ID — settling against the REAL klend requires a
// refresh_reserve prepended in the same tx (max oracle age 180s).
export const KLEND_PROGRAM_ID = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';

// Scope prices account for the pinned USDC reserve — a public account, not a
// secret. Default = Kamino main-market USDC scope oracle; override per reserve.
// Mirrors NEXT_PUBLIC_KAMINO_SCOPE_PRICES in web-app/services/solana/vaultV2.ts.
export const KAMINO_SCOPE_PRICES =
  process.env.KAMINO_SCOPE_PRICES ?? '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH';

const sha8 = (preimage) =>
  createHash('sha256').update(preimage, 'utf8').digest().subarray(0, 8);

// sha256("global:force_return_v2")[..8] = [219,13,235,112,177,242,216,123].
export const FORCE_RETURN_V2_DISCRIMINATOR = sha8('global:force_return_v2');

// sha256("account:LockV2")[..8] — getProgramAccounts memcmp filter.
export const LOCKV2_ACCOUNT_DISCRIMINATOR = sha8('account:LockV2');

// sha256("global:refresh_reserve")[..8] = [2,218,138,235,79,201,25,102].
export const REFRESH_RESERVE_DISCRIMINATOR = sha8('global:refresh_reserve');

// ── pure decode / predicate / build ───────────────────────────────────────

/** Decode a LockV2 account at the fixed Anchor offsets (see lockPosition.mjs). */
export function decodeLockV2(data) {
  return {
    owner: new PublicKey(data.subarray(8, 40)),
    courseIdHash: Uint8Array.from(data.subarray(40, 72)),
    principal: data.readBigUInt64LE(72),
    lockStartTs: data.readBigInt64LE(80),
    status: data[88],
    bump: data[89],
  };
}

/** Decode the VaultV2Config pinned accounts (authority..fee_vault, 10 pubkeys). */
export function decodeVaultV2Config(data) {
  const key = (offset) => new PublicKey(data.subarray(offset, offset + 32));
  return {
    authority: key(8),
    usdcMint: key(40),
    kaminoProgram: key(72),
    kaminoReserve: key(104),
    kaminoMarket: key(136),
    kaminoLma: key(168),
    kaminoLiquiditySupply: key(200),
    kaminoCollateralMint: key(232),
    potVault: key(264),
    feeVault: key(296),
  };
}

/** caps.rs force_returnable: ACTIVE and now >= lock_start + 180d. */
export function isForceReturnable(lock, nowSec) {
  return (
    lock.status === LOCK_STATUS_ACTIVE &&
    BigInt(nowSec) >= BigInt(lock.lockStartTs) + BigInt(FORCE_RETURN_AFTER_SECS)
  );
}

/**
 * Build the force_return_v2 instruction. Account order is copied 1:1 from the
 * ForceReturnV2 accounts struct in programs/locked_in/src/vault_v2.rs — the
 * unit test pins every position and writable/signer flag against it.
 */
export function buildForceReturnV2Instruction({ programId, configPda, lockPda, owner, caller, config }) {
  const ownerUsdc = getAssociatedTokenAddressSync(config.usdcMint, owner, true);
  const lockLiquidity = getAssociatedTokenAddressSync(config.usdcMint, lockPda, true);
  const lockCollateral = getAssociatedTokenAddressSync(config.kaminoCollateralMint, lockPda, true);
  const m = (pubkey, isWritable, isSigner = false) => ({ pubkey, isWritable, isSigner });

  return new TransactionInstruction({
    programId,
    keys: [
      m(configPda, true),                     // config (mut)
      m(lockPda, true),                       // lock (mut, close = owner)
      m(owner, true),                         // owner (mut, NOT a signer)
      m(caller, true, true),                  // caller (mut, signer/payer)
      m(config.usdcMint, false),              // usdc_mint
      m(ownerUsdc, true),                     // owner_usdc (mut)
      m(lockLiquidity, true),                 // lock_liquidity (mut, init_if_needed)
      m(lockCollateral, true),                // lock_collateral (mut)
      m(config.potVault, true),               // pot_vault (mut)
      m(config.feeVault, true),               // fee_vault (mut)
      m(config.kaminoProgram, false),         // kamino_program
      m(config.kaminoReserve, true),          // reserve (mut)
      m(config.kaminoMarket, false),          // lending_market
      m(config.kaminoLma, false),             // lending_market_authority
      m(config.kaminoLiquiditySupply, true),  // reserve_liquidity_supply (mut)
      m(config.kaminoCollateralMint, true),   // reserve_collateral_mint (mut)
      m(TOKEN_PROGRAM_ID, false),             // token_program
      m(SYSVAR_INSTRUCTIONS_PUBKEY, false),   // instruction_sysvar
      m(ASSOCIATED_TOKEN_PROGRAM_ID, false),  // associated_token_program
      m(SystemProgram.programId, false),      // system_program
    ],
    data: Buffer.from(FORCE_RETURN_V2_DISCRIMINATOR),
  });
}

/**
 * klend refresh_reserve, byte-for-byte as buildRefreshReserveIx in
 * web-app/services/solana/vaultV2.ts builds it: accounts [reserve(w),
 * lendingMarket, pyth, switchboardPrice, switchboardTwap, scopePrices], with
 * the klend program id as the sentinel for the oracles USDC does not use.
 * Returns null for the devnet mock reserve, which needs no refresh.
 */
export function buildRefreshReserveIx(config) {
  if (config.kaminoProgram.toBase58() !== KLEND_PROGRAM_ID) return null;
  if (!KAMINO_SCOPE_PRICES) throw new Error('Missing KAMINO_SCOPE_PRICES for real Kamino refresh_reserve.');
  const klend = new PublicKey(KLEND_PROGRAM_ID);
  const ro = (pubkey) => ({ pubkey, isWritable: false, isSigner: false });

  return new TransactionInstruction({
    programId: klend,
    keys: [
      { pubkey: config.kaminoReserve, isWritable: true, isSigner: false },
      ro(config.kaminoMarket),
      ro(klend), // pyth (unused → sentinel)
      ro(klend), // switchboard price (unused → sentinel)
      ro(klend), // switchboard twap (unused → sentinel)
      ro(new PublicKey(KAMINO_SCOPE_PRICES)),
    ],
    data: Buffer.from(REFRESH_RESERVE_DISCRIMINATOR),
  });
}

/**
 * Full per-lock instruction list: idempotent owner-USDC ATA create (the
 * program does not init it and a closed ATA would trap the return), a CU
 * bump for the redeem CPI, refresh_reserve on real klend, then
 * force_return_v2 itself. Ordering matches buildClaimTransaction's real-Kamino
 * shape — refresh_reserve immediately precedes the settling instruction.
 */
export function buildForceReturnTransactionIxs({ programId, configPda, lockPda, owner, caller, config }) {
  const ownerUsdc = getAssociatedTokenAddressSync(config.usdcMint, owner, true);
  const refresh = buildRefreshReserveIx(config); // null on devnet/mock
  return [
    createAssociatedTokenAccountIdempotentInstruction(caller, ownerUsdc, owner, config.usdcMint),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ...(refresh ? [refresh] : []),
    buildForceReturnV2Instruction({ programId, configPda, lockPda, owner, caller, config }),
  ];
}

// ── RPC wiring (main only) ─────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { solanaRpcUrl, vaultV2ProgramId, lockVaultWorkerPrivateKey } = appConfig;
  if (!vaultV2ProgramId) throw new Error('VAULT_V2_PROGRAM_ID is required');
  if (!lockVaultWorkerPrivateKey) throw new Error('LOCK_VAULT_WORKER_PRIVATE_KEY is required');

  const programId = new PublicKey(vaultV2ProgramId);
  const worker = Keypair.fromSecretKey(bs58.decode(lockVaultWorkerPrivateKey));
  const connection = new Connection(solanaRpcUrl, 'confirmed');
  console.log(`force-return crank | rpc=${solanaRpcUrl} program=${programId.toBase58()} caller=${worker.publicKey.toBase58()}${dryRun ? ' [dry-run]' : ''}`);

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], programId);
  const configInfo = await connection.getAccountInfo(configPda);
  if (!configInfo) throw new Error(`VaultV2Config not found at ${configPda.toBase58()} (seed '${CONFIG_SEED}')`);
  const config = decodeVaultV2Config(configInfo.data);

  // Fail before the scan rather than per-lock: a bad/missing scope oracle would
  // otherwise burn fees on every settle in the sweep.
  const refresh = buildRefreshReserveIx(config);
  console.log(refresh ? `real klend: prepending refresh_reserve (scope ${KAMINO_SCOPE_PRICES})` : 'mock reserve: no refresh_reserve needed');

  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { dataSize: LOCKV2_ACCOUNT_SIZE },
      { memcmp: { offset: 0, bytes: bs58.encode(LOCKV2_ACCOUNT_DISCRIMINATOR) } },
    ],
  });
  const now = Math.floor(Date.now() / 1000);
  const due = accounts
    .map(({ pubkey, account }) => ({ pubkey, lock: decodeLockV2(account.data) }))
    .filter(({ lock }) => isForceReturnable(lock, now));
  console.log(`scanned ${accounts.length} LockV2 accounts — ${due.length} past the 180-day deadline`);

  let returned = 0;
  let failed = 0;
  for (const { pubkey, lock } of due) {
    const label = `${pubkey.toBase58()} (owner ${lock.owner.toBase58()}, principal ${lock.principal})`;
    if (dryRun) {
      console.log(`would force-return ${label}`);
      continue;
    }
    try {
      const ixs = buildForceReturnTransactionIxs({
        programId,
        configPda,
        lockPda: pubkey,
        owner: lock.owner,
        caller: worker.publicKey,
        config,
      });
      const signature = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(...ixs),
        [worker],
        { commitment: 'confirmed' },
      );
      returned += 1;
      console.log(`force-returned ${label}: ${signature}`);
    } catch (error) {
      // One stuck lock (e.g. claimed between scan and submit — LockNotActive)
      // must not block the rest of the sweep.
      failed += 1;
      console.error(`force_return failed for ${label}: ${error.message ?? error}`);
    }
  }
  console.log(`done: ${returned} returned, ${failed} failed, ${due.length} due`);
  if (failed > 0) process.exitCode = 1;
}

// Import-safe: unit tests import the pure builders without triggering RPC.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('force-return crank failed:', error.message ?? error);
    process.exit(1);
  });
}
