import crypto from 'crypto';
import bs58Module from 'bs58';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
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

// Merged locked_in program: pot config PDA seed renamed protocol → pot-protocol.
const PROTOCOL_SEED = Buffer.from('pot-protocol');
const WINDOW_SEED = Buffer.from('window');
const REDIRECT_SEED = Buffer.from('redirect');
const POT_WINDOW_DISCRIMINATOR = crypto
  .createHash('sha256')
  .update('account:PotWindow')
  .digest()
  .subarray(0, 8);
const DISTRIBUTION_WINDOW_DISCRIMINATOR = crypto
  .createHash('sha256')
  .update('account:DistributionWindow')
  .digest()
  .subarray(0, 8);
// Merged locked_in program: pot init instruction renamed initialize_protocol → initialize_pot.
const INIT_PROTOCOL_DISCRIMINATOR = anchorDiscriminator('initialize_pot');
const RECORD_REDIRECT_DISCRIMINATOR = anchorDiscriminator('record_redirect');
const CLOSE_DISTRIBUTION_WINDOW_DISCRIMINATOR = anchorDiscriminator(
  'close_distribution_window',
);
const DISTRIBUTE_WINDOW_DISCRIMINATOR = anchorDiscriminator('distribute_window');

let relay = null;

function anchorDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
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

function toUnixTimestampSeconds(value) {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Invalid timestamp value: ${value}`);
  }

  return Math.floor(milliseconds / 1000);
}

export function deriveCommunityPotWindowId(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid timestamp value: ${timestamp}`);
  }

  return date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);
}

export function hasCommunityPotRelayConfig() {
  return Boolean(
    appConfig.solanaRpcUrl &&
      appConfig.communityPotProgramId &&
      appConfig.lockVaultUsdcMint &&
      appConfig.communityPotWorkerPrivateKey,
  );
}

function getRelay() {
  if (!hasCommunityPotRelayConfig()) {
    throw new Error('CommunityPot relay config is incomplete.');
  }

  if (!relay) {
    relay = {
      connection: new Connection(
        appConfig.solanaRpcUrl || clusterApiUrl('devnet'),
        'confirmed',
      ),
      signer: Keypair.fromSecretKey(
        bs58.decode(appConfig.communityPotWorkerPrivateKey),
      ),
      programId: new PublicKey(appConfig.communityPotProgramId),
      stableMint: new PublicKey(appConfig.lockVaultUsdcMint),
    };
  }

  return relay;
}

export function deriveCommunityPotProtocol(programId) {
  return PublicKey.findProgramAddressSync([PROTOCOL_SEED], programId)[0];
}

export function deriveCommunityPotWindow(programId, windowId) {
  return PublicKey.findProgramAddressSync(
    [WINDOW_SEED, encodeI64LE(windowId)],
    programId,
  )[0];
}

export function deriveCommunityPotDistributionWindow(programId, windowId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('distribution'), encodeI64LE(windowId)],
    programId,
  )[0];
}

function deriveRedirectReceipt(programId, windowAccount, receiptKey) {
  return PublicKey.findProgramAddressSync(
    [REDIRECT_SEED, windowAccount.toBuffer(), receiptKey],
    programId,
  )[0];
}

function deriveDistributionReceipt(programId, distributionWindow, recipientKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('distribution-receipt'), distributionWindow.toBuffer(), recipientKey],
    programId,
  )[0];
}

export function deriveCommunityPotVaultAddress(programId) {
  const protocolConfig = deriveCommunityPotProtocol(programId);
  return getAssociatedTokenAddressSync(
    getRelay().stableMint,
    protocolConfig,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
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

export async function initializeCommunityPotProtocol() {
  const { connection, signer, programId, stableMint } = getRelay();
  const protocolConfig = deriveCommunityPotProtocol(programId);
  const existing = await connection.getAccountInfo(protocolConfig, 'confirmed');

  if (existing) {
    return {
      protocolConfig: protocolConfig.toBase58(),
      stableMint: stableMint.toBase58(),
      status: 'already_initialized',
    };
  }

  const result = await sendInstruction(
    [
      { pubkey: protocolConfig, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([INIT_PROTOCOL_DISCRIMINATOR, stableMint.toBuffer()]),
  );

  return {
    signature: result.signature,
    authority: result.authority,
    protocolConfig: protocolConfig.toBase58(),
    stableMint: stableMint.toBase58(),
    status: 'initialized',
  };
}

export async function publishRedirectToCommunityPot({
  redirectEventId,
  harvestedAt,
  redirectedAmount,
}) {
  const amount = BigInt(redirectedAmount);
  if (amount <= 0n) {
    throw new Error('Redirected amount must be greater than zero.');
  }

  const { connection, signer, programId } = getRelay();
  const protocolConfig = deriveCommunityPotProtocol(programId);
  const windowId = deriveCommunityPotWindowId(harvestedAt);
  const windowAccount = deriveCommunityPotWindow(programId, windowId);
  const receiptKey = hashString(redirectEventId);
  const receiptAccount = deriveRedirectReceipt(programId, windowAccount, receiptKey);

  const existingProtocol = await connection.getAccountInfo(protocolConfig, 'confirmed');
  if (!existingProtocol) {
    throw new Error('CommunityPot protocol is not initialized.');
  }

  const result = await sendInstruction(
    [
      { pubkey: protocolConfig, isSigner: false, isWritable: true },
      { pubkey: windowAccount, isSigner: false, isWritable: true },
      { pubkey: receiptAccount, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([
      RECORD_REDIRECT_DISCRIMINATOR,
      receiptKey,
      encodeI64LE(windowId),
      encodeU64LE(amount),
      encodeI64LE(toUnixTimestampSeconds(harvestedAt)),
    ]),
  );

  return {
    signature: result.signature,
    authority: result.authority,
    protocolConfig: protocolConfig.toBase58(),
    windowId,
    windowAccount: windowAccount.toBase58(),
    receiptAccount: receiptAccount.toBase58(),
  };
}

export async function readCommunityPotWindow(windowId) {
  const { connection, programId } = getRelay();
  const windowAccount = deriveCommunityPotWindow(programId, windowId);
  const account = await connection.getAccountInfo(windowAccount, 'confirmed');

  if (!account) {
    return null;
  }

  const data = account.data;
  if (!data.subarray(0, 8).equals(POT_WINDOW_DISCRIMINATOR)) {
    throw new Error('Account is not a CommunityPot window.');
  }

  let offset = 8;
  const readPubkey = () => {
    const value = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    return value;
  };
  const readI64 = () => {
    const value = Number(data.readBigInt64LE(offset));
    offset += 8;
    return value;
  };
  const readU64 = () => {
    const value = Number(data.readBigUInt64LE(offset));
    offset += 8;
    return value;
  };
  const readU32 = () => {
    const value = data.readUInt32LE(offset);
    offset += 4;
    return value;
  };
  const readU8 = () => {
    const value = data.readUInt8(offset);
    offset += 1;
    return value;
  };

  return {
    windowAccount: windowAccount.toBase58(),
    protocolConfig: readPubkey(),
    windowId: readI64(),
    totalRedirectedAmount: readU64(),
    redirectCount: readU32(),
    openedAtTs: readI64(),
    lastRecordedAtTs: readI64(),
    status: readU8(),
    bump: readU8(),
  };
}

export async function closeCommunityPotDistributionWindow({
  windowId,
  totalWeight,
  eligibleRecipientCount,
  closedAt,
}) {
  const { connection, signer, programId } = getRelay();
  const protocolConfig = deriveCommunityPotProtocol(programId);
  const windowAccount = deriveCommunityPotWindow(programId, windowId);
  const distributionWindow = deriveCommunityPotDistributionWindow(programId, windowId);

  const existingProtocol = await connection.getAccountInfo(protocolConfig, 'confirmed');
  if (!existingProtocol) {
    throw new Error('CommunityPot protocol is not initialized.');
  }

  const existingWindow = await connection.getAccountInfo(windowAccount, 'confirmed');
  if (!existingWindow) {
    throw new Error(`CommunityPot window ${windowId} does not exist.`);
  }

  const result = await sendInstruction(
    [
      { pubkey: protocolConfig, isSigner: false, isWritable: true },
      { pubkey: windowAccount, isSigner: false, isWritable: false },
      { pubkey: distributionWindow, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([
      CLOSE_DISTRIBUTION_WINDOW_DISCRIMINATOR,
      encodeI64LE(windowId),
      encodeU64LE(totalWeight),
      Buffer.from(Uint8Array.of(
        eligibleRecipientCount & 0xff,
        (eligibleRecipientCount >> 8) & 0xff,
        (eligibleRecipientCount >> 16) & 0xff,
        (eligibleRecipientCount >> 24) & 0xff,
      )),
      encodeI64LE(toUnixTimestampSeconds(closedAt)),
    ]),
  );

  return {
    signature: result.signature,
    authority: result.authority,
    distributionWindow: distributionWindow.toBase58(),
    windowAccount: windowAccount.toBase58(),
    windowId,
  };
}

export async function distributeCommunityPotWindow({
  windowId,
  walletAddress,
  courseId,
  amount,
  distributedAt,
}) {
  const payoutAmount = BigInt(amount);
  if (payoutAmount <= 0n) {
    throw new Error('Distribution amount must be greater than zero.');
  }

  const { connection, signer, programId, stableMint } = getRelay();
  const protocolConfig = deriveCommunityPotProtocol(programId);
  const distributionWindow = deriveCommunityPotDistributionWindow(programId, windowId);
  const potVault = deriveCommunityPotVaultAddress(programId);
  const recipient = new PublicKey(walletAddress);
  const recipientStableTokenAccount = getAssociatedTokenAddressSync(
    stableMint,
    recipient,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const recipientKey = hashString(`${walletAddress}:${courseId}`);
  const distributionReceipt = deriveDistributionReceipt(
    programId,
    distributionWindow,
    recipientKey,
  );

  const result = await sendInstruction(
    [
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: distributionWindow, isSigner: false, isWritable: true },
      { pubkey: potVault, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: recipientStableTokenAccount, isSigner: false, isWritable: true },
      { pubkey: distributionReceipt, isSigner: false, isWritable: true },
      { pubkey: stableMint, isSigner: false, isWritable: false },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    Buffer.concat([
      DISTRIBUTE_WINDOW_DISCRIMINATOR,
      recipientKey,
      encodeI64LE(windowId),
      encodeU64LE(payoutAmount),
      encodeI64LE(toUnixTimestampSeconds(distributedAt)),
    ]),
  );

  return {
    signature: result.signature,
    authority: result.authority,
    distributionWindow: distributionWindow.toBase58(),
    potVault: potVault.toBase58(),
    recipientStableTokenAccount: recipientStableTokenAccount.toBase58(),
    distributionReceipt: distributionReceipt.toBase58(),
    walletAddress,
    courseId,
    amount: payoutAmount.toString(),
  };
}

export async function readCommunityPotDistributionWindow(windowId) {
  const { connection, programId } = getRelay();
  const distributionWindow = deriveCommunityPotDistributionWindow(programId, windowId);
  const account = await connection.getAccountInfo(distributionWindow, 'confirmed');

  if (!account) {
    return null;
  }

  const data = account.data;
  if (!data.subarray(0, 8).equals(DISTRIBUTION_WINDOW_DISCRIMINATOR)) {
    throw new Error('Account is not a CommunityPot distribution window.');
  }

  let offset = 8;
  const readPubkey = () => {
    const value = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    return value;
  };
  const readI64 = () => {
    const value = Number(data.readBigInt64LE(offset));
    offset += 8;
    return value;
  };
  const readU64 = () => {
    const value = Number(data.readBigUInt64LE(offset));
    offset += 8;
    return value;
  };
  const readU32 = () => {
    const value = data.readUInt32LE(offset);
    offset += 4;
    return value;
  };
  const readU8 = () => {
    const value = data.readUInt8(offset);
    offset += 1;
    return value;
  };

  return {
    distributionWindow: distributionWindow.toBase58(),
    protocolConfig: readPubkey(),
    potWindow: readPubkey(),
    windowId: readI64(),
    totalRedirectedAmount: readU64(),
    totalWeight: readU64(),
    eligibleRecipientCount: readU32(),
    distributedAmount: readU64(),
    distributionCount: readU32(),
    closedAtTs: readI64(),
    status: readU8(),
    bump: readU8(),
  };
}

export async function readCommunityPotVaultBalance() {
  const { connection, programId, stableMint } = getRelay();
  const potVault = deriveCommunityPotVaultAddress(programId);
  const account = await connection.getTokenAccountBalance(potVault, 'confirmed').catch(() => null);

  return {
    potVault: potVault.toBase58(),
    balanceAtomic: account?.value?.amount ?? '0',
    balanceUi: account?.value?.uiAmountString ?? '0',
    stableMint: stableMint.toBase58(),
  };
}
