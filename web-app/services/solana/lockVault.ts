import { Buffer } from 'buffer';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { connection } from './connection';

export type LockDurationDays = 14 | 30 | 45 | 60 | 90 | 180 | 365;

const LOCK_FUNDS_DISCRIMINATOR = Uint8Array.from([171, 49, 9, 86, 156, 155, 2, 88]);
const UNLOCK_FUNDS_DISCRIMINATOR = Uint8Array.from([175, 119, 16, 245, 141, 55, 255, 43]);
const LOCK_ACCOUNT_DISCRIMINATOR_HEX = 'df40477cff5676c0';
// Merged locked_in program: vault config PDA seed renamed protocol → vault-protocol.
const PROTOCOL_SEED = Buffer.from('vault-protocol');
const LOCK_SEED = Buffer.from('lock');

const rawProgramId = (process.env.NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID ?? '').trim();
const rawUsdcMint = (process.env.NEXT_PUBLIC_LOCK_VAULT_USDC_MINT ?? '').trim();

interface LockVaultConfig {
  programId: PublicKey;
  usdcMint: PublicKey;
}

export interface WalletDepositBalances {
  stableBalanceUi: string;
  solBalanceUi: string;
}

export interface LockFundsBuildResult {
  transaction: Transaction;
  lockAccountAddress: string;
  stableVaultAddress: string;
  stableMintAddress: string;
  stableAmountAtomic: string;
}

export interface UnlockFundsBuildResult {
  transaction: Transaction;
  lockAccountAddress: string;
  stableVaultAddress: string;
  ownerStableTokenAccountAddress: string;
}

// Custody-only snapshot — mirrors the 8-field on-chain LockAccount.
// Game state (fuel/ichor/streak/saver/redirect) is OFF-CHAIN now, sourced from
// the backend progress API, not from this decoder.
export interface LockAccountSnapshot {
  lockAccountAddress: string;
  principalAmountUi: string;
  lockStartDate: string; // ISO from lock_start_ts*1000
  lockEndDate: string; // ISO from lock_end_ts*1000
  unlockEligible: boolean; // status !== 2 && now >= lock_end_ts*1000
  status: number; // u8
}

function parsePublicKey(value: string): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function formatConfigError(): string {
  return [
    'Missing LockVault env config.',
    'Set NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID and NEXT_PUBLIC_LOCK_VAULT_USDC_MINT.',
  ].join(' ');
}

export function hasLockVaultConfig(): boolean {
  return Boolean(parsePublicKey(rawProgramId) && parsePublicKey(rawUsdcMint));
}

export function getLockVaultConfig(): LockVaultConfig {
  const programId = parsePublicKey(rawProgramId);
  const usdcMint = parsePublicKey(rawUsdcMint);

  if (!programId || !usdcMint) {
    throw new Error(formatConfigError());
  }

  return {
    programId,
    usdcMint,
  };
}

export function getStableMintAddress(): string {
  return getLockVaultConfig().usdcMint.toBase58();
}

function encodeU16LE(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  bytes[0] = value & 0xff;
  bytes[1] = (value >> 8) & 0xff;
  return bytes;
}

function encodeU64LE(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let remaining = value;

  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return bytes;
}

function encodeLockFundsInstructionData(
  courseIdHash: Uint8Array,
  lockDurationDays: LockDurationDays,
  stableAmount: bigint,
): Buffer {
  return Buffer.concat([
    Buffer.from(LOCK_FUNDS_DISCRIMINATOR),
    Buffer.from(courseIdHash),
    Buffer.from(encodeU16LE(lockDurationDays)),
    Buffer.from(encodeU64LE(stableAmount)),
  ]);
}

function encodeUnlockFundsInstructionData(): Buffer {
  return Buffer.from(UNLOCK_FUNDS_DISCRIMINATOR);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(bytes[offset + index] ?? 0) << (BigInt(index) * 8n);
  }
  return value;
}

function readI64LE(bytes: Uint8Array, offset: number): bigint {
  const value = readU64LE(bytes, offset);
  return value >= (1n << 63n) ? value - (1n << 64n) : value;
}

function decodeLockAccountSnapshot(
  data: Uint8Array,
  lockAccountAddress: string,
  stableDecimals: number,
): LockAccountSnapshot {
  if (bytesToHex(data.subarray(0, 8)) !== LOCK_ACCOUNT_DISCRIMINATOR_HEX) {
    throw new Error('Account is not a LockVault lock account.');
  }

  // 8-field custody LockAccount layout (130 bytes total), IDL order:
  // disc[8] owner[32] course_id_hash[32] stable_mint[32]
  // principal_amount(u64) lock_start_ts(i64) lock_end_ts(i64)
  // status(u8) bump(u8).
  let offset = 8;
  const skip = (size: number) => {
    offset += size;
  };
  const readU64 = () => {
    const value = readU64LE(data, offset);
    offset += 8;
    return value;
  };
  const readI64 = () => {
    const value = readI64LE(data, offset);
    offset += 8;
    return value;
  };
  const readU8 = () => {
    const value = data[offset] ?? 0;
    offset += 1;
    return value;
  };

  skip(32); // owner
  skip(32); // course_id_hash
  skip(32); // stable_mint
  const principalAmount = readU64(); // principal_amount
  const lockStartTs = readI64(); // lock_start_ts
  const lockEndTs = readI64(); // lock_end_ts
  const status = readU8(); // status
  // bump (u8) intentionally not read

  return {
    lockAccountAddress,
    principalAmountUi: formatAtomicAmount(principalAmount, stableDecimals),
    lockStartDate: new Date(Number(lockStartTs) * 1000).toISOString(),
    lockEndDate: new Date(Number(lockEndTs) * 1000).toISOString(),
    unlockEligible: status !== 2 && Date.now() >= Number(lockEndTs) * 1000,
    status,
  };
}

export function parseUiTokenAmount(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Enter a valid numeric amount.');
  }

  const [wholePart, fractionalPart = ''] = normalized.split('.');
  if (fractionalPart.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places.`);
  }

  const paddedFraction = fractionalPart.padEnd(decimals, '0');
  const combined = `${wholePart}${paddedFraction}`.replace(/^0+(?=\d)/, '');
  const atomic = BigInt(combined || '0');

  return atomic;
}

function formatAtomicAmount(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;

  if (fraction === 0n) {
    return whole.toString();
  }

  const paddedFraction = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${paddedFraction}`;
}

function formatLamportsAmount(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  const formatted = sol.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return formatted || '0';
}

// Use Web Crypto API instead of expo-crypto
async function hashCourseId(courseId: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(courseId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(hashBuffer);
}

export async function deriveLockAccountAddress(
  ownerAddress: string,
  courseId: string,
): Promise<string> {
  const config = getLockVaultConfig();
  const owner = new PublicKey(ownerAddress);
  const courseIdHash = await hashCourseId(courseId);
  const [lockAccount] = PublicKey.findProgramAddressSync(
    [LOCK_SEED, owner.toBuffer(), Buffer.from(courseIdHash)],
    config.programId,
  );

  return lockAccount.toBase58();
}

/**
 * Batch-check which courses have existing on-chain LockAccounts for this wallet.
 * One RPC call via getMultipleAccountsInfo. Returns a Map of courseId → snapshot
 * for courses that have an active lock.
 */
export async function batchCheckLockAccounts(
  ownerAddress: string,
  courseIds: string[],
): Promise<Map<string, LockAccountSnapshot>> {
  if (courseIds.length === 0 || !hasLockVaultConfig()) return new Map();

  const config = getLockVaultConfig();
  const owner = new PublicKey(ownerAddress);

  // Derive all PDAs
  const hashes = await Promise.all(courseIds.map((id) => hashCourseId(id)));
  const pubkeys = hashes.map((hash) => {
    const [pda] = PublicKey.findProgramAddressSync(
      [LOCK_SEED, owner.toBuffer(), Buffer.from(hash)],
      config.programId,
    );
    return pda;
  });

  // One batch RPC call
  const accounts = await connection.getMultipleAccountsInfo(pubkeys, 'confirmed');

  // Decode mint decimals once (needed for all snapshots)
  const stableDecimals = await getMintDecimals(config.usdcMint);

  const result = new Map<string, LockAccountSnapshot>();
  for (let i = 0; i < courseIds.length; i++) {
    const info = accounts[i];
    if (!info) continue;
    try {
      const snapshot = decodeLockAccountSnapshot(
        new Uint8Array(info.data),
        pubkeys[i].toBase58(),
        stableDecimals,
      );
      result.set(courseIds[i], snapshot);
    } catch (err) {
      console.warn(`[lockVault] Failed to decode lock account for course ${courseIds[i]}:`, err);
      continue;
    }
  }

  // No on-chain lock accounts found — normal for users who haven't enrolled yet,
  // or wallets that have never locked. Only surface at info level.
  if (result.size === 0 && courseIds.length > 0) {
    console.info('[lockVault] No on-chain lock accounts found for this wallet');
  }

  return result;
}

export async function fetchLockAccountSnapshot(params: {
  ownerAddress: string;
  courseId: string;
}): Promise<LockAccountSnapshot> {
  const config = getLockVaultConfig();
  const owner = new PublicKey(params.ownerAddress);
  const [stableDecimals, courseIdHash] = await Promise.all([
    getMintDecimals(config.usdcMint),
    hashCourseId(params.courseId),
  ]);
  const [lockAccount] = PublicKey.findProgramAddressSync(
    [LOCK_SEED, owner.toBuffer(), Buffer.from(courseIdHash)],
    config.programId,
  );

  const accountInfo = await connection.getAccountInfo(lockAccount, 'confirmed');
  if (!accountInfo) {
    throw new Error('No LockVault account was found for this wallet and course.');
  }

  return decodeLockAccountSnapshot(
    new Uint8Array(accountInfo.data),
    lockAccount.toBase58(),
    stableDecimals,
  );
}

async function getMintDecimals(mintAddress: PublicKey): Promise<number> {
  const mint = await getMint(connection, mintAddress, 'confirmed', TOKEN_PROGRAM_ID);
  return mint.decimals;
}

async function getTokenBalanceUi(
  ownerAddress: PublicKey,
  mintAddress: PublicKey,
): Promise<string> {
  const ownerAta = getAssociatedTokenAddressSync(
    mintAddress,
    ownerAddress,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const account = await connection.getAccountInfo(ownerAta, 'confirmed');
  if (!account) {
    return '0';
  }

  const balance = await connection.getTokenAccountBalance(ownerAta, 'confirmed');
  return balance.value.uiAmountString ?? '0';
}

export async function fetchWalletDepositBalances(
  ownerAddress: string,
): Promise<WalletDepositBalances> {
  const config = getLockVaultConfig();
  const owner = new PublicKey(ownerAddress);

  const [stableBalanceUi, solLamports] = await Promise.all([
    getTokenBalanceUi(owner, config.usdcMint),
    connection.getBalance(owner, 'confirmed'),
  ]);

  return {
    stableBalanceUi,
    solBalanceUi: formatLamportsAmount(solLamports),
  };
}

export async function buildLockFundsTransaction(params: {
  ownerAddress: string;
  courseId: string;
  stableAmountUi: string;
  lockDurationDays: LockDurationDays;
}): Promise<LockFundsBuildResult> {
  const config = getLockVaultConfig();
  const owner = new PublicKey(params.ownerAddress);
  const stableMint = config.usdcMint;

  const [stableDecimals, courseIdHash] = await Promise.all([
    getMintDecimals(stableMint),
    hashCourseId(params.courseId),
  ]);

  const stableAmount = parseUiTokenAmount(params.stableAmountUi, stableDecimals);

  if (stableAmount <= 0n) {
    throw new Error('Stable deposit amount must be greater than zero.');
  }

  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [PROTOCOL_SEED],
    config.programId,
  );
  const [lockAccount] = PublicKey.findProgramAddressSync(
    [LOCK_SEED, owner.toBuffer(), Buffer.from(courseIdHash)],
    config.programId,
  );

  const ownerStableTokenAccount = getAssociatedTokenAddressSync(
    stableMint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const stableVault = getAssociatedTokenAddressSync(
    stableMint,
    lockAccount,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const stableSourceAccount = await connection.getAccountInfo(
    ownerStableTokenAccount,
    'confirmed',
  );

  if (!stableSourceAccount) {
    throw new Error('No USDC token account was found for this wallet on the configured cluster.');
  }

  // 9 keys in exact IDL `lock_funds` account order (USDC-only custody):
  // protocol_config, lock_account, stable_mint, owner,
  // owner_stable_token_account, stable_vault, token_program,
  // associated_token_program, system_program.
  const keys = [
    { pubkey: protocolConfig, isSigner: false, isWritable: false },
    { pubkey: lockAccount, isSigner: false, isWritable: true },
    { pubkey: stableMint, isSigner: false, isWritable: false },
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: ownerStableTokenAccount, isSigner: false, isWritable: true },
    { pubkey: stableVault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({
    programId: config.programId,
    keys,
    data: encodeLockFundsInstructionData(
      courseIdHash,
      params.lockDurationDays,
      stableAmount,
    ),
  });

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    feePayer: owner,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction);

  return {
    transaction,
    lockAccountAddress: lockAccount.toBase58(),
    stableVaultAddress: stableVault.toBase58(),
    stableMintAddress: stableMint.toBase58(),
    stableAmountAtomic: stableAmount.toString(),
  };
}

export async function buildUnlockFundsTransaction(params: {
  ownerAddress: string;
  courseId: string;
}): Promise<UnlockFundsBuildResult> {
  const config = getLockVaultConfig();
  const owner = new PublicKey(params.ownerAddress);
  const courseIdHash = await hashCourseId(params.courseId);
  const [lockAccount] = PublicKey.findProgramAddressSync(
    [LOCK_SEED, owner.toBuffer(), Buffer.from(courseIdHash)],
    config.programId,
  );

  const lockAccountInfo = await connection.getAccountInfo(lockAccount, 'confirmed');
  if (!lockAccountInfo) {
    throw new Error('No LockVault account was found for this wallet and course.');
  }

  const ownerStableTokenAccount = getAssociatedTokenAddressSync(
    config.usdcMint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const stableVault = getAssociatedTokenAddressSync(
    config.usdcMint,
    lockAccount,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // 8 keys in exact IDL `unlock_funds` account order (USDC-only custody;
  // no protocol_config — it only existed to bind the removed SKR mint):
  // lock_account, stable_mint, owner, stable_vault,
  // owner_stable_token_account, token_program, associated_token_program,
  // system_program. stable_mint is bound on-chain to lock_account.stable_mint.
  const instruction = new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: lockAccount, isSigner: false, isWritable: true },
      { pubkey: config.usdcMint, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: stableVault, isSigner: false, isWritable: true },
      { pubkey: ownerStableTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeUnlockFundsInstructionData(),
  });

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    feePayer: owner,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction);

  return {
    transaction,
    lockAccountAddress: lockAccount.toBase58(),
    stableVaultAddress: stableVault.toBase58(),
    ownerStableTokenAccountAddress: ownerStableTokenAccount.toBase58(),
  };
}

export function formatDepositAmountUi(amountAtomic: string, decimals: number): string {
  return formatAtomicAmount(BigInt(amountAtomic), decimals);
}
