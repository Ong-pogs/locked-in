import crypto from 'crypto';
import bs58Module from 'bs58';
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { appConfig } from '../config.mjs';

const bs58 = bs58Module.decode ? bs58Module : bs58Module.default;

const PROTOCOL_SEED = Buffer.from('protocol');
const LOCK_SEED = Buffer.from('lock');
const COMPLETION_SEED = Buffer.from('completion');
const FUEL_BURN_SEED = Buffer.from('fuel-burn');
const MISS_SEED = Buffer.from('miss');
const HARVEST_SEED = Buffer.from('harvest');
const LOCK_ACCOUNT_DISCRIMINATOR = 'df40477cff5676c0';

const APPLY_VERIFIED_COMPLETION_DISCRIMINATOR = anchorDiscriminator(
  'apply_verified_completion',
);
const CONSUME_DAILY_FUEL_DISCRIMINATOR = anchorDiscriminator('consume_daily_fuel');
const CONSUME_SAVER_OR_FULL_CONSEQUENCE_DISCRIMINATOR = anchorDiscriminator(
  'consume_saver_or_apply_full_consequence',
);
const APPLY_HARVEST_RESULT_DISCRIMINATOR = anchorDiscriminator('apply_harvest_result');
const UNLOCK_FUNDS_DISCRIMINATOR = anchorDiscriminator('unlock_funds');

let relay = null;
let readConnection = null;

function anchorDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function encodeU16LE(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function encodeI64LE(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(BigInt(value), 0);
  return buffer;
}

function encodeU64LE(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
}

function hashString(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function toEpochDay(value) {
  const milliseconds = new Date(`${value}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return Math.floor(milliseconds / 86_400_000);
}

function toUnixTimestampSeconds(value) {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Invalid timestamp value: ${value}`);
  }

  return Math.floor(milliseconds / 1000);
}

export function hasLockVaultRelayConfig() {
  return Boolean(
    appConfig.solanaRpcUrl &&
      appConfig.lockVaultProgramId &&
      appConfig.lockVaultUsdcMint &&
      appConfig.lockVaultSkrMint &&
      appConfig.lockVaultWorkerPrivateKey,
  );
}

export function hasLockVaultReadConfig() {
  return Boolean(appConfig.solanaRpcUrl && appConfig.lockVaultProgramId);
}

function getReadConnection() {
  if (!hasLockVaultReadConfig()) {
    throw new Error('LockVault read config is incomplete.');
  }

  if (!readConnection) {
    readConnection = new Connection(
      appConfig.solanaRpcUrl || clusterApiUrl('devnet'),
      'confirmed',
    );
  }

  return readConnection;
}

function getRelay() {
  if (!hasLockVaultRelayConfig()) {
    throw new Error('LockVault relay config is incomplete.');
  }

  if (!relay) {
    relay = {
      connection: new Connection(
        appConfig.solanaRpcUrl || clusterApiUrl('devnet'),
        'confirmed',
      ),
      signer: Keypair.fromSecretKey(
        bs58.decode(appConfig.lockVaultWorkerPrivateKey),
      ),
      programId: new PublicKey(appConfig.lockVaultProgramId),
    };
  }

  return relay;
}

function deriveCourseIdHash(courseId) {
  return hashString(courseId);
}

function deriveLockAccount(programId, walletAddress, courseId) {
  const owner = new PublicKey(walletAddress);
  const [lockAccount] = PublicKey.findProgramAddressSync(
    [LOCK_SEED, owner.toBuffer(), deriveCourseIdHash(courseId)],
    programId,
  );
  return lockAccount;
}

function deriveProtocolConfig(programId) {
  return PublicKey.findProgramAddressSync([PROTOCOL_SEED], programId)[0];
}

function deriveReceiptAccount(programId, seed, lockAccount, receiptKey) {
  return PublicKey.findProgramAddressSync(
    [seed, lockAccount.toBuffer(), receiptKey],
    programId,
  )[0];
}

function decodeLockAccountSnapshot(data) {
  if (data.length < 201) {
    throw new Error('Lock account data is shorter than expected.');
  }

  const discriminator = data.subarray(0, 8).toString('hex');
  if (discriminator !== LOCK_ACCOUNT_DISCRIMINATOR) {
    throw new Error('Account is not a LockVault LockAccount.');
  }

  let offset = 8;
  const readPubkey = () => {
    const value = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    return value;
  };
  const readBytes = (size) => {
    const value = data.subarray(offset, offset + size);
    offset += size;
    return value;
  };
  const readU64 = () => {
    const value = Number(data.readBigUInt64LE(offset));
    offset += 8;
    return value;
  };
  const readI64 = () => {
    const value = Number(data.readBigInt64LE(offset));
    offset += 8;
    return value;
  };
  const readU8 = () => {
    const value = data.readUInt8(offset);
    offset += 1;
    return value;
  };
  const readBool = () => readU8() === 1;
  const readU16 = () => {
    const value = data.readUInt16LE(offset);
    offset += 2;
    return value;
  };

  return {
    owner: readPubkey(),
    courseIdHash: Buffer.from(readBytes(32)).toString('hex'),
    stableMint: readPubkey(),
    principalAmount: readU64(),
    lockStartTs: readI64(),
    lockEndTs: readI64(),
    extensionSecondsTotal: readU64(),
    status: readU8(),
    gauntletComplete: readBool(),
    gauntletDay: readU8(),
    currentStreak: readU16(),
    longestStreak: readU16(),
    saversRemaining: readU8(),
    saverRecoveryMode: readBool(),
    fuelCounter: readU16(),
    fuelCap: readU16(),
    lastFuelCreditDay: readI64(),
    lastBrewerBurnTs: readI64(),
    lastCompletionDay: readI64(),
    ichorCounter: readU64(),
    ichorLifetimeTotal: readU64(),
    skrLockedAmount: readU64(),
    skrTier: readU8(),
    currentYieldRedirectBps: readU16(),
    bump: readU8(),
  };
}

async function assertLockAccountExists(connection, lockAccount) {
  const account = await connection.getAccountInfo(lockAccount, 'confirmed');
  if (!account) {
    throw new Error(`Lock account not found: ${lockAccount.toBase58()}`);
  }

  return account;
}

async function sendWorkerInstruction(keys, data) {
  const { connection, signer, programId } = getRelay();
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');

  const transaction = new Transaction({
    feePayer: signer.publicKey,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(
    new TransactionInstruction({
      programId,
      keys,
      data,
    }),
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [signer], {
    commitment: 'confirmed',
  });

  return {
    signature,
    authority: signer.publicKey.toBase58(),
  };
}

export async function publishVerifiedCompletionToLockVault({
  eventId,
  walletAddress,
  courseId,
  completionDay,
  rewardUnits,
}) {
  const { connection, signer, programId } = getRelay();
  const protocolConfig = deriveProtocolConfig(programId);
  const lockAccount = deriveLockAccount(programId, walletAddress, courseId);
  const receiptKey = hashString(eventId);
  const receiptAccount = deriveReceiptAccount(
    programId,
    COMPLETION_SEED,
    lockAccount,
    receiptKey,
  );

  await assertLockAccountExists(connection, lockAccount);

  const data = Buffer.concat([
    APPLY_VERIFIED_COMPLETION_DISCRIMINATOR,
    receiptKey,
    encodeI64LE(toEpochDay(completionDay)),
    encodeU16LE(rewardUnits),
  ]);

  const result = await sendWorkerInstruction(
    [
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: lockAccount, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: receiptAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  );

  return {
    ...result,
    lockAccount: lockAccount.toBase58(),
    receiptAccount: receiptAccount.toBase58(),
    completionDay,
    rewardUnits,
  };
}

export async function readLockAccountTiming(walletAddress, courseId) {
  const { connection, programId } = getRelay();
  const lockAccount = deriveLockAccount(programId, walletAddress, courseId);
  const account = await assertLockAccountExists(connection, lockAccount);
  const snapshot = decodeLockAccountSnapshot(account.data);

  return {
    lockAccount: lockAccount.toBase58(),
    lockStartTs: snapshot.lockStartTs,
  };
}

export async function readLockAccountSnapshot(walletAddress, courseId) {
  const { connection, programId } = getRelay();
  const lockAccount = deriveLockAccount(programId, walletAddress, courseId);
  const account = await assertLockAccountExists(connection, lockAccount);

  return {
    lockAccount: lockAccount.toBase58(),
    ...decodeLockAccountSnapshot(account.data),
  };
}

function toBase58PublicKey(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value?.toBase58 === 'function') return value.toBase58();
  if (value.pubkey) {
    return toBase58PublicKey(value.pubkey);
  }
  return String(value);
}

export async function verifyUnlockTransaction({
  unlockTxSignature,
  walletAddress,
  lockAccountAddress = null,
}) {
  const connection = getReadConnection();
  const transaction = await connection.getParsedTransaction(unlockTxSignature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });

  if (!transaction) {
    return {
      valid: false,
      reason: 'TRANSACTION_NOT_FOUND',
    };
  }

  if (transaction.meta?.err != null) {
    return {
      valid: false,
      reason: 'TRANSACTION_FAILED',
    };
  }

  const accountKeys = transaction.transaction.message.accountKeys ?? [];
  const signerMatchesWallet = accountKeys.some((accountKey) => {
    const pubkey = toBase58PublicKey(accountKey);
    return Boolean(accountKey?.signer) && pubkey === walletAddress;
  });

  if (!signerMatchesWallet) {
    return {
      valid: false,
      reason: 'SIGNER_MISMATCH',
    };
  }

  const unlockInstruction = transaction.transaction.message.instructions.find((instruction) => {
    const programId = toBase58PublicKey(instruction?.programId);
    if (programId !== appConfig.lockVaultProgramId || typeof instruction?.data !== 'string') {
      return false;
    }

    try {
      const data = bs58.decode(instruction.data);
      return data.subarray(0, 8).equals(UNLOCK_FUNDS_DISCRIMINATOR);
    } catch {
      return false;
    }
  });

  if (!unlockInstruction) {
    return {
      valid: false,
      reason: 'NOT_UNLOCK_TRANSACTION',
    };
  }

  const instructionAccounts = Array.isArray(unlockInstruction.accounts)
    ? unlockInstruction.accounts.map((account) => toBase58PublicKey(account))
    : [];
  const derivedLockAccountAddress = instructionAccounts[0] ?? null;

  if (lockAccountAddress && derivedLockAccountAddress && lockAccountAddress !== derivedLockAccountAddress) {
    return {
      valid: false,
      reason: 'LOCK_ACCOUNT_MISMATCH',
      lockAccountAddress: derivedLockAccountAddress,
    };
  }

  return {
    valid: true,
    slot: transaction.slot,
    blockTime:
      transaction.blockTime != null
        ? new Date(transaction.blockTime * 1000).toISOString()
        : null,
    lockAccountAddress: derivedLockAccountAddress,
  };
}

export async function publishFuelBurnToLockVault({
  walletAddress,
  courseId,
  cycleId,
  burnedAt,
}) {
  const { connection, signer, programId } = getRelay();
  const protocolConfig = deriveProtocolConfig(programId);
  const lockAccount = deriveLockAccount(programId, walletAddress, courseId);
  const receiptKey = hashString(cycleId);
  const receiptAccount = deriveReceiptAccount(
    programId,
    FUEL_BURN_SEED,
    lockAccount,
    receiptKey,
  );

  await assertLockAccountExists(connection, lockAccount);

  const data = Buffer.concat([
    CONSUME_DAILY_FUEL_DISCRIMINATOR,
    receiptKey,
    encodeI64LE(toUnixTimestampSeconds(burnedAt)),
  ]);

  const result = await sendWorkerInstruction(
    [
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: lockAccount, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: receiptAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  );

  return {
    ...result,
    lockAccount: lockAccount.toBase58(),
    receiptAccount: receiptAccount.toBase58(),
    burnedAt,
  };
}

export async function publishMissConsequenceToLockVault({
  walletAddress,
  courseId,
  missEventId,
  missDay,
}) {
  const { connection, signer, programId } = getRelay();
  const protocolConfig = deriveProtocolConfig(programId);
  const lockAccount = deriveLockAccount(programId, walletAddress, courseId);
  const receiptKey = hashString(missEventId);
  const receiptAccount = deriveReceiptAccount(programId, MISS_SEED, lockAccount, receiptKey);

  await assertLockAccountExists(connection, lockAccount);

  const data = Buffer.concat([
    CONSUME_SAVER_OR_FULL_CONSEQUENCE_DISCRIMINATOR,
    receiptKey,
    encodeI64LE(toEpochDay(missDay)),
  ]);

  const result = await sendWorkerInstruction(
    [
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: lockAccount, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: receiptAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  );

  return {
    ...result,
    lockAccount: lockAccount.toBase58(),
    receiptAccount: receiptAccount.toBase58(),
    missDay,
  };
}

export async function publishHarvestToLockVault({
  walletAddress,
  courseId,
  harvestId,
  grossYieldAmount,
}) {
  const { connection, signer, programId } = getRelay();
  const protocolConfig = deriveProtocolConfig(programId);
  const lockAccount = deriveLockAccount(programId, walletAddress, courseId);
  const receiptKey = hashString(harvestId);
  const receiptAccount = deriveReceiptAccount(programId, HARVEST_SEED, lockAccount, receiptKey);

  await assertLockAccountExists(connection, lockAccount);

  const data = Buffer.concat([
    APPLY_HARVEST_RESULT_DISCRIMINATOR,
    receiptKey,
    encodeU64LE(BigInt(grossYieldAmount)),
  ]);

  const result = await sendWorkerInstruction(
    [
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: lockAccount, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: receiptAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  );

  return {
    ...result,
    lockAccount: lockAccount.toBase58(),
    receiptAccount: receiptAccount.toBase58(),
    grossYieldAmount,
  };
}
