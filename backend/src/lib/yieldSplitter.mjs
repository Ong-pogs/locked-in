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
const RECEIPT_SEED = Buffer.from('receipt');
const LOCK_SEED = Buffer.from('lock');
const HARVEST_RECEIPT_DISCRIMINATOR = crypto
  .createHash('sha256')
  .update('account:HarvestReceipt')
  .digest()
  .subarray(0, 8);
const INIT_PROTOCOL_DISCRIMINATOR = anchorDiscriminator('initialize_protocol');
const HARVEST_AND_SPLIT_DISCRIMINATOR = anchorDiscriminator('harvest_and_split');

let relay = null;

function anchorDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function encodeU16LE(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function encodeU64LE(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
}

function encodeI64LE(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(BigInt(value), 0);
  return buffer;
}

function hashString(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function toUnixTimestampSeconds(value) {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Invalid timestamp value: ${value}`);
  }

  return Math.floor(milliseconds / 1000);
}

function deriveCourseIdHash(courseId) {
  return hashString(courseId);
}

export function hasYieldSplitterRelayConfig() {
  return Boolean(
    appConfig.solanaRpcUrl &&
      appConfig.yieldSplitterProgramId &&
      appConfig.lockVaultProgramId &&
      appConfig.yieldSplitterWorkerPrivateKey,
  );
}

function getRelay() {
  if (!hasYieldSplitterRelayConfig()) {
    throw new Error('YieldSplitter relay config is incomplete.');
  }

  if (!relay) {
    relay = {
      connection: new Connection(
        appConfig.solanaRpcUrl || clusterApiUrl('devnet'),
        'confirmed',
      ),
      signer: Keypair.fromSecretKey(
        bs58.decode(appConfig.yieldSplitterWorkerPrivateKey),
      ),
      programId: new PublicKey(appConfig.yieldSplitterProgramId),
      lockVaultProgramId: new PublicKey(appConfig.lockVaultProgramId),
    };
  }

  return relay;
}

export function deriveYieldSplitterProtocol(programId) {
  return PublicKey.findProgramAddressSync([PROTOCOL_SEED], programId)[0];
}

function deriveLockAccount(lockVaultProgramId, walletAddress, courseId) {
  const owner = new PublicKey(walletAddress);
  const [lockAccount] = PublicKey.findProgramAddressSync(
    [LOCK_SEED, owner.toBuffer(), deriveCourseIdHash(courseId)],
    lockVaultProgramId,
  );
  return lockAccount;
}

function deriveHarvestReceipt(programId, lockAccount, receiptKey) {
  return PublicKey.findProgramAddressSync(
    [RECEIPT_SEED, lockAccount.toBuffer(), receiptKey],
    programId,
  )[0];
}

function decodeHarvestReceipt(data) {
  if (data.length < 129) {
    throw new Error('YieldSplitter harvest receipt data is shorter than expected.');
  }

  const discriminator = data.subarray(0, 8);
  if (!discriminator.equals(HARVEST_RECEIPT_DISCRIMINATOR)) {
    throw new Error('Account is not a YieldSplitter HarvestReceipt.');
  }

  let offset = 8;
  const readPubkey = () => {
    const value = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    return value;
  };
  const readBytes = (size) => {
    const value = Buffer.from(data.subarray(offset, offset + size));
    offset += size;
    return value;
  };
  const readU64 = () => {
    const value = data.readBigUInt64LE(offset).toString();
    offset += 8;
    return value;
  };
  const readU16 = () => {
    const value = data.readUInt16LE(offset);
    offset += 2;
    return value;
  };
  const readBool = () => {
    const value = data.readUInt8(offset) === 1;
    offset += 1;
    return value;
  };
  const readU8 = () => {
    const value = data.readUInt8(offset);
    offset += 1;
    return value;
  };
  const readI64 = () => {
    const value = Number(data.readBigInt64LE(offset));
    offset += 8;
    return value;
  };

  return {
    lockAccount: readPubkey(),
    receiptKey: readBytes(32).toString('hex'),
    grossYieldAmount: readU64(),
    platformFeeAmount: readU64(),
    redirectedAmount: readU64(),
    userShareAmount: readU64(),
    ichorAwarded: readU64(),
    redirectBps: readU16(),
    platformFeeBps: readU16(),
    brewerActive: readBool(),
    applied: readBool(),
    outcome: readU8(),
    processedAtTs: readI64(),
    skrTier: readU8(),
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

async function readHarvestReceipt(connection, receiptAccount) {
  const account = await connection.getAccountInfo(receiptAccount, 'confirmed');
  if (!account) {
    throw new Error(`YieldSplitter receipt account not found: ${receiptAccount.toBase58()}`);
  }

  return decodeHarvestReceipt(account.data);
}

async function sendInstruction(keys, data) {
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

export async function initializeYieldSplitterProtocol({
  stableMint,
  lockVaultProgramId,
  communityPotProgramId,
  platformFeeBps = 1_000,
} = {}) {
  const { connection, signer, programId } = getRelay();
  const protocolConfig = deriveYieldSplitterProtocol(programId);
  const existing = await connection.getAccountInfo(protocolConfig, 'confirmed');
  const stableMintKey = new PublicKey(stableMint ?? appConfig.lockVaultUsdcMint);
  const lockVaultProgramKey = new PublicKey(
    lockVaultProgramId ?? appConfig.lockVaultProgramId,
  );
  const communityPotProgramKey = new PublicKey(
    communityPotProgramId ?? appConfig.communityPotProgramId,
  );

  if (existing) {
    return {
      protocolConfig: protocolConfig.toBase58(),
      stableMint: stableMintKey.toBase58(),
      lockVaultProgramId: lockVaultProgramKey.toBase58(),
      communityPotProgramId: communityPotProgramKey.toBase58(),
      status: 'already_initialized',
    };
  }

  const result = await sendInstruction(
    [
      { pubkey: protocolConfig, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([
      INIT_PROTOCOL_DISCRIMINATOR,
      stableMintKey.toBuffer(),
      lockVaultProgramKey.toBuffer(),
      communityPotProgramKey.toBuffer(),
      encodeU16LE(platformFeeBps),
    ]),
  );

  return {
    signature: result.signature,
    authority: result.authority,
    protocolConfig: protocolConfig.toBase58(),
    stableMint: stableMintKey.toBase58(),
    lockVaultProgramId: lockVaultProgramKey.toBase58(),
    communityPotProgramId: communityPotProgramKey.toBase58(),
    platformFeeBps,
    status: 'initialized',
  };
}

export async function publishHarvestSplitToYieldSplitter({
  walletAddress,
  courseId,
  harvestId,
  grossYieldAmount,
  redirectBps,
  brewerActive,
  skrTier,
  processedAt,
}) {
  const { connection, signer, programId, lockVaultProgramId } = getRelay();
  const protocolConfig = deriveYieldSplitterProtocol(programId);
  const lockAccount = deriveLockAccount(lockVaultProgramId, walletAddress, courseId);
  const receiptKey = hashString(harvestId);
  const receiptAccount = deriveHarvestReceipt(programId, lockAccount, receiptKey);

  await assertLockAccountExists(connection, lockAccount);

  const result = await sendInstruction(
    [
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: lockAccount, isSigner: false, isWritable: false },
      { pubkey: receiptAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([
      HARVEST_AND_SPLIT_DISCRIMINATOR,
      receiptKey,
      encodeU64LE(grossYieldAmount),
      encodeU16LE(redirectBps),
      Buffer.from([brewerActive ? 1 : 0]),
      Buffer.from([skrTier]),
      encodeI64LE(toUnixTimestampSeconds(processedAt)),
    ]),
  );

  const receipt = await readHarvestReceipt(connection, receiptAccount);
  return {
    signature: result.signature,
    authority: result.authority,
    lockAccount: lockAccount.toBase58(),
    receiptAccount: receiptAccount.toBase58(),
    receipt,
  };
}
