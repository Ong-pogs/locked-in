import crypto from 'crypto';
import bs58Module from 'bs58';
import {
  clusterApiUrl,
  Connection,
  PublicKey,
} from '@solana/web3.js';
import { appConfig } from '../config.mjs';

const bs58 = bs58Module.decode ? bs58Module : bs58Module.default;

const LOCK_SEED = Buffer.from('lock');
const LOCK_ACCOUNT_DISCRIMINATOR = 'df40477cff5676c0';

// Custody-core program exposes only initialize_protocol / lock_funds /
// unlock_funds. The backend never signs lock_vault game-layer txs anymore —
// the game layer is fully off-chain (DB is source of truth). We only READ the
// LockAccount + inspect unlock transactions here.
const UNLOCK_FUNDS_DISCRIMINATOR = anchorDiscriminator('unlock_funds');

let readConnection = null;

function anchorDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function hashString(value) {
  return crypto.createHash('sha256').update(value).digest();
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

function getReadContext() {
  if (!hasLockVaultReadConfig()) {
    throw new Error('LockVault read config is incomplete.');
  }

  return {
    connection: getReadConnection(),
    programId: new PublicKey(appConfig.lockVaultProgramId),
  };
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

// New custody-core LockAccount: 9 fields only. Layout/order/types mirror
// target/idl/lock_vault.json -> types.LockAccount:
//   owner(pubkey) course_id_hash([u8;32]) stable_mint(pubkey)
//   principal_amount(u64) skr_locked_amount(u64) lock_start_ts(i64)
//   lock_end_ts(i64) status(u8) bump(u8)
// Total = 8 disc + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1 = 138 bytes.
function decodeLockAccountSnapshot(data) {
  if (data.length < 138) {
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

  return {
    owner: readPubkey(),
    courseIdHash: Buffer.from(readBytes(32)).toString('hex'),
    stableMint: readPubkey(),
    principalAmount: readU64(),
    skrLockedAmount: readU64(),
    lockStartTs: readI64(),
    lockEndTs: readI64(),
    status: readU8(),
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

export async function readLockAccountSnapshot(walletAddress, courseId) {
  const { connection, programId } = getReadContext();
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
  const inspection = await inspectUnlockTransaction(unlockTxSignature);
  if (!inspection.valid) {
    return inspection;
  }

  if (walletAddress && inspection.walletAddress !== walletAddress) {
    return {
      valid: false,
      reason: 'SIGNER_MISMATCH',
    };
  }

  if (
    lockAccountAddress &&
    inspection.lockAccountAddress &&
    lockAccountAddress !== inspection.lockAccountAddress
  ) {
    return {
      valid: false,
      reason: 'LOCK_ACCOUNT_MISMATCH',
      lockAccountAddress: inspection.lockAccountAddress,
    };
  }

  return inspection;
}

export async function inspectUnlockTransaction(unlockTxSignature) {
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
    return Boolean(accountKey?.signer);
  });

  if (!signerMatchesWallet) {
    return {
      valid: false,
      reason: 'MISSING_SIGNER',
    };
  }

  const signerWalletAddress =
    accountKeys.find((accountKey) => Boolean(accountKey?.signer))?.pubkey?.toBase58?.() ??
    toBase58PublicKey(accountKeys.find((accountKey) => Boolean(accountKey?.signer))) ??
    null;

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

  return {
    valid: true,
    walletAddress: signerWalletAddress,
    slot: transaction.slot,
    blockTime:
      transaction.blockTime != null
        ? new Date(transaction.blockTime * 1000).toISOString()
        : null,
    lockAccountAddress: derivedLockAccountAddress,
  };
}

export async function listRecentLockVaultProgramSignatures(limit = 25) {
  const connection = getReadConnection();
  const programId = new PublicKey(appConfig.lockVaultProgramId);
  return connection.getSignaturesForAddress(programId, {
    limit: Math.max(1, Number(limit) || 25),
  });
}
