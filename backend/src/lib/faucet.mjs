import bs58Module from 'bs58';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  getAccount,
} from '@solana/spl-token';
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { appConfig } from '../config.mjs';
import { getPool } from './db.mjs';

const bs58 = bs58Module.decode ? bs58Module : bs58Module.default;

let client = null;

function getClient() {
  if (!client) {
    client = {
      connection: new Connection(
        appConfig.solanaRpcUrl || clusterApiUrl('devnet'),
        'confirmed',
      ),
      signer: Keypair.fromSecretKey(bs58.decode(appConfig.lockVaultWorkerPrivateKey)),
      usdcMint: new PublicKey(appConfig.lockVaultUsdcMint),
    };
  }
  return client;
}

function parseUiAmount(value, decimals) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid UI amount: ${value}`);
  }
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimals.`);
  }
  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}` || '0');
}

export function hasFaucetConfig() {
  return Boolean(
    appConfig.faucetEnabled &&
      appConfig.solanaRpcUrl &&
      appConfig.lockVaultUsdcMint &&
      appConfig.lockVaultWorkerPrivateKey,
  );
}

export function isDevnetOnly() {
  return (appConfig.solanaRpcUrl ?? '').includes('devnet');
}

export async function transferSol(walletAddress, lamports) {
  const { connection, signer } = getClient();
  const recipient = new PublicKey(walletAddress);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: recipient,
      lamports,
    }),
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [signer], {
    commitment: 'confirmed',
  });

  return { signature };
}

export async function transferUsdc(walletAddress, amountUi) {
  const { connection, signer, usdcMint } = getClient();
  const recipient = new PublicKey(walletAddress);

  const sourceAta = getAssociatedTokenAddressSync(
    usdcMint,
    signer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const destAta = getAssociatedTokenAddressSync(
    usdcMint,
    recipient,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const mint = await getMint(connection, usdcMint, 'confirmed', TOKEN_PROGRAM_ID);
  const amountAtomic = parseUiAmount(amountUi, mint.decimals);

  const instructions = [];

  // Create recipient ATA if it doesn't exist (worker pays rent)
  try {
    await getAccount(connection, destAta, 'confirmed', TOKEN_PROGRAM_ID);
  } catch {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        signer.publicKey,
        destAta,
        recipient,
        usdcMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  instructions.push(
    createTransferCheckedInstruction(
      sourceAta,
      usdcMint,
      destAta,
      signer.publicKey,
      amountAtomic,
      mint.decimals,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  const transaction = new Transaction().add(...instructions);
  const signature = await sendAndConfirmTransaction(connection, transaction, [signer], {
    commitment: 'confirmed',
  });

  return { signature, amountAtomic };
}

export async function checkCooldown(walletAddress) {
  const pool = getPool();
  if (!pool) {
    throw new Error('Faucet requires DATABASE_URL to be configured');
  }
  const { rows } = await pool.query(
    `SELECT 1 FROM lesson.faucet_claims
     WHERE wallet_address = $1 AND round = $2
     LIMIT 1`,
    [walletAddress, appConfig.faucetRound],
  );

  if (rows.length === 0) {
    return { eligible: true };
  }

  return { eligible: false };
}

export async function recordClaim(walletAddress, solSignature, usdcSignature, solLamports, usdcAtomic) {
  const pool = getPool();
  if (!pool) {
    throw new Error('Faucet requires DATABASE_URL to be configured');
  }
  await pool.query(
    `INSERT INTO lesson.faucet_claims
       (wallet_address, sol_signature, usdc_signature, sol_amount_lamports, usdc_amount_atomic, round)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [walletAddress, solSignature, usdcSignature, solLamports, usdcAtomic, appConfig.faucetRound],
  );
}
