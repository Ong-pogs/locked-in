import { Buffer } from 'buffer';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  Ed25519Program,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { connection } from './connection';

// v2 custody client. Mirrors the deposit→claim flow proven on devnet in
// programs-tests/scripts/devnet-v2-deposit-claim.mjs. All reserve/pot/fee
// accounts are read from the on-chain VaultV2Config, so the same builders work
// for the devnet mock reserve and for real Kamino once config points at it.

// Anchor discriminators = sha256("global:<ix>")[..8].
const OPEN_LOCK_V2_DISCRIMINATOR = Uint8Array.from([27, 3, 244, 249, 254, 190, 169, 147]);
const LOCK_FUNDS_V2_DISCRIMINATOR = Uint8Array.from([151, 43, 254, 68, 70, 208, 150, 164]);
const CLAIM_V2_DISCRIMINATOR = Uint8Array.from([229, 87, 46, 162, 21, 157, 231, 114]);

const CONFIG_SEED = Buffer.from('vault-v2b');
const LOCK_SEED = Buffer.from('lock-v2');

// LockV2 status.
export const LOCK_STATUS_ACTIVE = 0;
export const LOCK_STATUS_PENDING = 1;
export const LOCK_STATUS_CLOSED = 2;

const rawProgramId = (process.env.NEXT_PUBLIC_VAULT_V2_PROGRAM_ID ?? '').trim();
const rawUsdcMint = (process.env.NEXT_PUBLIC_LOCK_VAULT_USDC_MINT ?? '').trim();

// Real Kamino Lend (klend) mainnet program. When config.kaminoProgram equals
// this, deposit/claim MUST carry a klend refresh_reserve instruction (klend
// rejects a stale reserve, max oracle age 180s). The devnet mock reserve is a
// different program and needs no refresh, so the prepend is gated on this
// equality — never added on devnet. Proven on a surfpool mainnet fork by
// backend/scripts/fork-proof-kamino-roundtrip.mjs.
const KLEND_PROGRAM_ID = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
// sha256("global:refresh_reserve")[..8]
const REFRESH_RESERVE_DISCRIMINATOR = Buffer.from([2, 218, 138, 235, 79, 201, 25, 102]);
// Scope prices account for the pinned USDC reserve (public account, not a
// secret). Default = Kamino main-market USDC scope oracle; override per reserve.
const rawScopePrices = (
  process.env.NEXT_PUBLIC_KAMINO_SCOPE_PRICES ?? '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH'
).trim();

/**
 * klend refresh_reserve, byte-for-byte as klend-sdk builds it: accounts
 * [reserve(w), lendingMarket, pyth, switchboardPrice, switchboardTwap,
 * scopePrices]; absent oracles use the klend program-id sentinel. USDC is
 * Scope-only. Returns null for the devnet mock reserve (no refresh needed).
 */
export function buildRefreshReserveIx(config: VaultV2Config): TransactionInstruction | null {
  if (!config.kaminoProgram.equals(KLEND_PROGRAM_ID)) return null;
  const scope = parsePublicKey(rawScopePrices);
  if (!scope) throw new Error('Missing NEXT_PUBLIC_KAMINO_SCOPE_PRICES for real Kamino refresh_reserve.');
  const ro = (pk: PublicKey) => ({ pubkey: pk, isSigner: false, isWritable: false });
  return new TransactionInstruction({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: config.kaminoReserve, isSigner: false, isWritable: true },
      ro(config.kaminoMarket),
      ro(KLEND_PROGRAM_ID), // pyth (unused → sentinel)
      ro(KLEND_PROGRAM_ID), // switchboard price (unused → sentinel)
      ro(KLEND_PROGRAM_ID), // switchboard twap (unused → sentinel)
      ro(scope),
    ],
    data: REFRESH_RESERVE_DISCRIMINATOR,
  });
}

// A v2 money tx is a Kamino CPI: expensive, and at 0 micro-lamports the first
// thing a mainnet leader drops under congestion. Bid the recent-window rate for
// the accounts we actually touch, clamped so an outlier slot can't drain a
// user's SOL and a quiet network still buys us queue position. At the 400k CU
// limit the band is ~4_000..400_000 lamports of priority fee.
const COMPUTE_UNIT_LIMIT = 400_000;
const PRIORITY_FEE_FLOOR = 10_000; // micro-lamports per CU
const PRIORITY_FEE_CEILING = 1_000_000;

/**
 * setComputeUnitPrice for a tx over `writableAccounts`, priced at the 75th
 * percentile of getRecentPrioritizationFees for those accounts — high enough to
 * clear the bulk of the recent window without chasing the max() outlier.
 * Degrades to the floor whenever the RPC is unavailable, unsupported, or quiet
 * (which is the devnet case), so pricing can never block a money tx.
 */
export async function buildPriorityFeeIx(
  writableAccounts: PublicKey[],
): Promise<TransactionInstruction> {
  let microLamports = PRIORITY_FEE_FLOOR;
  try {
    const recent = await connection.getRecentPrioritizationFees({
      // The RPC caps this list at 128 addresses.
      lockedWritableAccounts: writableAccounts.slice(0, 128),
    });
    const samples = (recent ?? [])
      .map((f) => f.prioritizationFee)
      .filter((fee) => Number.isFinite(fee) && fee > 0)
      .sort((a, b) => a - b);
    if (samples.length > 0) {
      microLamports = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.75))];
    }
  } catch {
    // Floor it.
  }
  return ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: Math.min(PRIORITY_FEE_CEILING, Math.max(PRIORITY_FEE_FLOOR, Math.ceil(microLamports))),
  });
}

function writableKeysOf(...instructions: TransactionInstruction[]): PublicKey[] {
  const seen = new Map<string, PublicKey>();
  for (const ix of instructions) {
    for (const key of ix.keys) {
      if (key.isWritable) seen.set(key.pubkey.toBase58(), key.pubkey);
    }
  }
  return [...seen.values()];
}

export interface VaultV2Config {
  configAddress: PublicKey;
  authority: PublicKey;
  usdcMint: PublicKey;
  kaminoProgram: PublicKey;
  kaminoReserve: PublicKey;
  kaminoMarket: PublicKey;
  kaminoLma: PublicKey;
  kaminoLiquiditySupply: PublicKey;
  collateralMint: PublicKey;
  potVault: PublicKey;
  feeVault: PublicKey;
  currentTvlUi: string;
  paused: boolean;
}

export interface LockV2Snapshot {
  lockAddress: string;
  owner: string;
  principalAmountUi: string;
  lockStartDate: string; // ISO
  status: number;
}

// A signed completion voucher, exactly as the backend endpoint returns it
// (POST /v1/progress/courses/:courseId/voucher). base64 message + signature.
export interface CompletionVoucher {
  lock: string;
  authorityPubkey: string;
  bps: number;
  expiry: number;
  message: string; // base64
  signature: string; // base64
}

function parsePublicKey(value: string): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export function hasVaultV2Config(): boolean {
  return Boolean(parsePublicKey(rawProgramId) && parsePublicKey(rawUsdcMint));
}

export function getProgramId(): PublicKey {
  const programId = parsePublicKey(rawProgramId);
  if (!programId) {
    throw new Error('Missing NEXT_PUBLIC_VAULT_V2_PROGRAM_ID.');
  }
  return programId;
}

export function getUsdcMint(): PublicKey {
  const usdcMint = parsePublicKey(rawUsdcMint);
  if (!usdcMint) {
    throw new Error('Missing NEXT_PUBLIC_LOCK_VAULT_USDC_MINT.');
  }
  return usdcMint;
}

/** SHA-256(utf8(courseId)) — MUST match backend courseIdHashBytes + voucher.rs. */
export async function hashCourseId(courseId: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(courseId);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(digest);
}

export function deriveConfigPda(programId: PublicKey = getProgramId()): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  return pda;
}

export async function deriveLockPda(
  ownerAddress: string,
  courseId: string,
  programId: PublicKey = getProgramId(),
): Promise<PublicKey> {
  const owner = new PublicKey(ownerAddress);
  const courseIdHash = await hashCourseId(courseId);
  const [pda] = PublicKey.findProgramAddressSync(
    [LOCK_SEED, owner.toBuffer(), Buffer.from(courseIdHash)],
    programId,
  );
  return pda;
}

function encodeU16LE(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}

function encodeI64LE(value: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(value));
  return b;
}

function encodeU64LE(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}

/**
 * Wallet USDC balance (UI string) for the deposit form — v2-native: needs only
 * the USDC mint, NOT the legacy v1 lock-vault program env (which does not exist
 * on a v2/mainnet build). Best-effort; null when the ATA is absent (audit M7).
 */
export async function readWalletUsdcUi(ownerAddress: string): Promise<string | null> {
  try {
    const ata = getAssociatedTokenAddressSync(getUsdcMint(), new PublicKey(ownerAddress));
    const { value } = await connection.getTokenAccountBalance(ata);
    return value.uiAmountString ?? null;
  } catch {
    return null;
  }
}

export function encodeOpenLockData(courseIdHash: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(OPEN_LOCK_V2_DISCRIMINATOR), Buffer.from(courseIdHash)]);
}

export function encodeLockFundsData(courseIdHash: Uint8Array, stableAmount: bigint): Buffer {
  return Buffer.concat([
    Buffer.from(LOCK_FUNDS_V2_DISCRIMINATOR),
    Buffer.from(courseIdHash),
    encodeU64LE(stableAmount),
  ]);
}

export function encodeClaimData(bps: number, expiry: number): Buffer {
  return Buffer.concat([Buffer.from(CLAIM_V2_DISCRIMINATOR), encodeU16LE(bps), encodeI64LE(expiry)]);
}

function readPk(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

/** Decode the on-chain VaultV2Config account. Fixed Anchor offsets. */
export async function readVaultV2Config(): Promise<VaultV2Config> {
  const programId = getProgramId();
  const configAddress = deriveConfigPda(programId);
  const info = await connection.getAccountInfo(configAddress);
  if (!info) {
    throw new Error('Vault v2 is not initialized.');
  }
  const d = info.data;
  return {
    configAddress,
    authority: readPk(d, 8),
    usdcMint: readPk(d, 40),
    kaminoProgram: readPk(d, 72),
    kaminoReserve: readPk(d, 104),
    kaminoMarket: readPk(d, 136),
    kaminoLma: readPk(d, 168),
    kaminoLiquiditySupply: readPk(d, 200),
    collateralMint: readPk(d, 232),
    potVault: readPk(d, 264),
    feeVault: readPk(d, 296),
    // u64s follow the 10 pubkeys: min@328 max@336 cap@344 tvl@352, bps u16@360.
    currentTvlUi: formatAtomicUsdc(d.readBigUInt64LE(352)),
    paused: d[362] === 1,
  };
}

const m = (pubkey: PublicKey, isWritable: boolean, isSigner = false) => ({ pubkey, isWritable, isSigner });

/**
 * open_lock_v2 — inits the lock PDA + its collateral ATA (no CPI). Must run
 * before the deposit. Idempotent-safe to skip if the lock already exists.
 */
export async function buildOpenLockTransaction(
  ownerAddress: string,
  courseId: string,
  config: VaultV2Config,
): Promise<Transaction> {
  const programId = getProgramId();
  const owner = new PublicKey(ownerAddress);
  const courseIdHash = await hashCourseId(courseId);
  const lock = await deriveLockPda(ownerAddress, courseId, programId);
  const lockCollateral = getAssociatedTokenAddressSync(config.collateralMint, lock, true);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      m(config.configAddress, false),
      m(lock, true),
      m(owner, true, true),
      m(config.collateralMint, false),
      m(lockCollateral, true),
      m(TOKEN_PROGRAM_ID, false),
      m(ASSOCIATED_TOKEN_PROGRAM_ID, false),
      m(SystemProgram.programId, false),
    ],
    data: encodeOpenLockData(courseIdHash),
  });
  return new Transaction().add(ix);
}

/**
 * lock_funds_v2 — CPI-deposits `stableAmount` (atomic USDC) into the reserve,
 * banking the collateral in the lock's ATA. The lock + ATA must already exist
 * (open_lock_v2). Prefixed with a compute-unit bump for the CPI and a priority
 * fee bid.
 */
export async function buildDepositTransaction(
  ownerAddress: string,
  courseId: string,
  stableAmount: bigint,
  config: VaultV2Config,
  prepend: TransactionInstruction[] = [],
): Promise<Transaction> {
  const programId = getProgramId();
  const owner = new PublicKey(ownerAddress);
  const courseIdHash = await hashCourseId(courseId);
  const lock = await deriveLockPda(ownerAddress, courseId, programId);
  const lockCollateral = getAssociatedTokenAddressSync(config.collateralMint, lock, true);
  const userUsdc = getAssociatedTokenAddressSync(config.usdcMint, owner);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      m(config.configAddress, true),
      m(lock, true),
      m(owner, true, true),
      m(config.usdcMint, false),
      m(userUsdc, true),
      m(lockCollateral, true),
      m(config.kaminoProgram, false),
      m(config.kaminoReserve, true),
      m(config.kaminoMarket, false),
      m(config.kaminoLma, false),
      m(config.kaminoLiquiditySupply, true),
      m(config.collateralMint, true),
      m(TOKEN_PROGRAM_ID, false),
      m(SYSVAR_INSTRUCTIONS_PUBKEY, false),
    ],
    data: encodeLockFundsData(courseIdHash, stableAmount),
  });
  const tx = new Transaction();
  for (const pre of prepend) tx.add(pre);
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }));
  tx.add(await buildPriorityFeeIx(writableKeysOf(ix)));
  const refresh = buildRefreshReserveIx(config); // null on devnet/mock
  if (refresh) tx.add(refresh);
  return tx.add(ix);
}

/**
 * claim_v2 — redeems collateral and splits principal/yield per the completion
 * voucher's bps, closing the lock. The tx is [compute_budget,
 * create_ata_idempotent, ed25519_verify(voucher), claim]; the program scans
 * instructions for the precompile. `voucher` is the backend endpoint's
 * response for this (owner, course).
 *
 * Against real Kamino refresh_reserve is inserted before ed25519_verify;
 * buildRefreshReserveIx injects refresh_reserve when
 * config.kaminoProgram == klend (null on the devnet mock). Proven byte-for-byte
 * on a surfpool mainnet fork (backend/scripts/fork-proof-kamino-roundtrip.mjs).
 */
export async function buildClaimTransaction(
  ownerAddress: string,
  courseId: string,
  voucher: CompletionVoucher,
  config: VaultV2Config,
  prepend: TransactionInstruction[] = [],
): Promise<Transaction> {
  const programId = getProgramId();
  const owner = new PublicKey(ownerAddress);
  const lock = await deriveLockPda(ownerAddress, courseId, programId);
  if (lock.toBase58() !== voucher.lock) {
    throw new Error('Voucher lock does not match the derived lock PDA.');
  }
  const lockLiquidity = getAssociatedTokenAddressSync(config.usdcMint, lock, true);
  const lockCollateral = getAssociatedTokenAddressSync(config.collateralMint, lock, true);
  const userUsdc = getAssociatedTokenAddressSync(config.usdcMint, owner);

  const edIx = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(voucher.authorityPubkey).toBytes(),
    message: Buffer.from(voucher.message, 'base64'),
    signature: Buffer.from(voucher.signature, 'base64'),
  });

  const claimIx = new TransactionInstruction({
    programId,
    keys: [
      m(config.configAddress, true),
      m(lock, true),
      m(owner, true, true),
      m(config.usdcMint, false),
      m(userUsdc, true),
      m(lockLiquidity, true),
      m(lockCollateral, true),
      m(config.potVault, true),
      m(config.feeVault, true),
      m(config.kaminoProgram, false),
      m(config.kaminoReserve, true),
      m(config.kaminoMarket, false),
      m(config.kaminoLma, false),
      m(config.kaminoLiquiditySupply, true),
      m(config.collateralMint, true),
      m(TOKEN_PROGRAM_ID, false),
      m(SYSVAR_INSTRUCTIONS_PUBKEY, false),
      m(ASSOCIATED_TOKEN_PROGRAM_ID, false),
      m(SystemProgram.programId, false),
    ],
    data: encodeClaimData(voucher.bps, voucher.expiry),
  });

  const tx = new Transaction();
  for (const pre of prepend) tx.add(pre);
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }));
  tx.add(await buildPriorityFeeIx(writableKeysOf(claimIx)));
  // The program declares owner_usdc as a plain `mut` ATA — it does NOT create
  // it. Wallets let users close token accounts, and a user who closed their
  // USDC ATA after depositing could otherwise never claim (the tx fails on the
  // missing destination with no in-app remedy). Idempotent: a no-op when the
  // ATA already exists, which is the overwhelmingly common case.
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      owner, // payer
      userUsdc,
      owner, // owner
      config.usdcMint,
    ),
  );
  const refresh = buildRefreshReserveIx(config); // null on devnet/mock
  if (refresh) tx.add(refresh);
  // [cu_limit, cu_price, create_ata_idempotent, refresh_reserve?,
  // ed25519_verify, claim]. The program scans instructions for the precompile, so ed25519
  // position is flexible; refresh must precede the redeem CPI. Proven on the
  // surfpool mainnet fork.
  return tx.add(edIx).add(claimIx);
}

/** Read + decode the LockV2 account for (owner, course). Null if it doesn't exist. */
export async function readLockV2(
  ownerAddress: string,
  courseId: string,
): Promise<LockV2Snapshot | null> {
  const lock = await deriveLockPda(ownerAddress, courseId);
  const info = await connection.getAccountInfo(lock);
  if (!info) return null;
  const d = info.data;
  const owner = readPk(d, 8);
  const principal = d.readBigUInt64LE(72);
  const lockStartTs = d.readBigInt64LE(80);
  const status = d[88];
  return {
    lockAddress: lock.toBase58(),
    owner: owner.toBase58(),
    principalAmountUi: formatAtomicUsdc(principal),
    lockStartDate: new Date(Number(lockStartTs) * 1000).toISOString(),
    status,
  };
}

function formatAtomicUsdc(atomic: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = atomic / base;
  const frac = atomic % base;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}
