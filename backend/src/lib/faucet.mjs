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

/**
 * Same as transferUsdc but accepts the raw base-unit amount (bigint or
 * string) directly. Used by the brewery claim flow where we already have
 * the amount as USDC base units from the harvest_result_receipts ledger
 * and don't want to round-trip through a UI-decimal string.
 */
export async function transferUsdcAtomic(walletAddress, amountAtomic) {
  // Defense-in-depth insolvency guard. Callers (brewery claim) also guard,
  // but this is the last gate before signing a real treasury transfer.
  // Treasury-funded payout is devnet-only until on-chain Kamino redemption
  // replaces it.
  if (!isDevnetOnly()) {
    throw new Error(
      'transferUsdcAtomic refused: treasury transfers are devnet-only on this cluster.',
    );
  }

  const { connection, signer, usdcMint } = getClient();
  const recipient = new PublicKey(walletAddress);

  const amount = typeof amountAtomic === 'bigint' ? amountAtomic : BigInt(amountAtomic);
  if (amount <= 0n) {
    throw new Error('transferUsdcAtomic: amount must be > 0');
  }

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

  const instructions = [];
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
      amount,
      mint.decimals,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  const transaction = new Transaction().add(...instructions);
  const signature = await sendAndConfirmTransaction(connection, transaction, [signer], {
    commitment: 'confirmed',
  });

  return { signature, amountAtomic: amount };
}

/**
 * Atomically reserve a faucet claim slot. Returns a reservation id on
 * success, or null if the wallet has already claimed for this round.
 *
 * This replaces the old checkCooldown + recordClaim two-step which was
 * vulnerable to TOCTOU: two parallel requests could both pass cooldown,
 * both run Solana transfers, both insert rows. With the UNIQUE constraint
 * on (wallet_address, round) added in migration 0034, the ON CONFLICT
 * DO NOTHING here guarantees only one reservation wins.
 *
 * Callers MUST call `recordClaimSignatures` after the transfers complete,
 * or `releaseReservation` on failure (so a botched attempt doesn't lock
 * the wallet out until the next round bump).
 */
export async function reserveClaim(walletAddress) {
  const pool = getPool();
  if (!pool) {
    throw new Error('Faucet requires DATABASE_URL to be configured');
  }
  const { rows } = await pool.query(
    `INSERT INTO lesson.faucet_claims
       (wallet_address, sol_signature, usdc_signature, sol_amount_lamports, usdc_amount_atomic, round)
     VALUES ($1, '', '', 0, 0, $2)
     ON CONFLICT (wallet_address, round) DO NOTHING
     RETURNING id`,
    [walletAddress, appConfig.faucetRound],
  );
  return rows.length > 0 ? rows[0].id : null;
}

export async function recordClaimSignatures(reservationId, solSignature, usdcSignature, solLamports, usdcAtomic) {
  const pool = getPool();
  if (!pool) {
    throw new Error('Faucet requires DATABASE_URL to be configured');
  }
  await pool.query(
    `UPDATE lesson.faucet_claims
       SET sol_signature = $1,
           usdc_signature = $2,
           sol_amount_lamports = $3,
           usdc_amount_atomic = $4
     WHERE id = $5`,
    [solSignature, usdcSignature, solLamports, usdcAtomic, reservationId],
  );
}

export async function releaseReservation(reservationId) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `DELETE FROM lesson.faucet_claims WHERE id = $1`,
    [reservationId],
  );
}

// Legacy exports kept so any unused-imports check doesn't break callers
// that haven't migrated yet. Marked deprecated.
/** @deprecated use reserveClaim instead — racy by design */
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

/** @deprecated use recordClaimSignatures after reserveClaim */
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
