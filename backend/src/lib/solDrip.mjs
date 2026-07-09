// One-time SOL drip (spec §4.2): ~0.005 SOL from the worker key to a wallet
// so fresh onboarding wallets can pay their first fees.
//
// Ordering is the whole design: reserve the lesson.sol_drips row FIRST
// (UNIQUE wallet_address, ON CONFLICT DO NOTHING), transfer second, record
// the signature last. Every failure mode then lands on the safe side:
//   - concurrent double-request → one reservation wins, the loser pays nothing;
//   - transfer fails            → reservation released, the wallet may retry;
//   - crash after the transfer  → the row stays (empty signature) and keeps
//                                 blocking re-drips — fail closed, no double pay
//                                 (ops can inspect/delete the row manually);
//   - DB unreachable            → refuse before any transfer (fail closed).
// The global cap is counted under a pg advisory xact lock so two requests at
// the boundary cannot both slip under it.

import bs58Module from 'bs58';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { appConfig } from '../config.mjs';
import { getPool, withTransaction } from './db.mjs';

const bs58 = bs58Module.decode ? bs58Module : bs58Module.default;

let connection = null;
function getConnection() {
  if (!connection) connection = new Connection(appConfig.solanaRpcUrl, 'confirmed');
  return connection;
}

export function hasSolDripConfig() {
  return Boolean(
    appConfig.solanaRpcUrl && appConfig.lockVaultWorkerPrivateKey && getPool(),
  );
}

async function transferSolReal(walletAddress, lamports) {
  const signer = Keypair.fromSecretKey(bs58.decode(appConfig.lockVaultWorkerPrivateKey));
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: new PublicKey(walletAddress),
      lamports,
    }),
  );
  const signature = await sendAndConfirmTransaction(getConnection(), transaction, [signer], {
    commitment: 'confirmed',
  });
  return { signature };
}

// Test hook (same convention as lockPosition.__clearPositionCache): swap the
// on-chain transfer out in integration tests. Pass null to restore the real one.
let transferOverride = null;
export function __setTransferSolForTests(fn) {
  transferOverride = fn;
}

/**
 * Core drip flow with injected effects — pure decision logic, unit-testable.
 *
 * reserveAndCount(wallet) → { id, total }: id is null when the wallet already
 * has a row; total counts ALL rows including the fresh reservation.
 * record(id, signature, lamports) persists the payout; release(id) undoes a
 * reservation that must not stick.
 */
export async function executeDripFlow({
  walletAddress,
  lamports,
  maxDrips,
  reserveAndCount,
  record,
  release,
  transfer,
}) {
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new Error(`solDrip: lamports must be a positive number, got ${lamports}`);
  }

  const { id, total } = await reserveAndCount(walletAddress);
  // A wallet that already dripped is 'already_dripped' even at the cap — its
  // earlier row is what the cap counted.
  if (!id) return { status: 'already_dripped' };
  if (total > maxDrips) {
    await release(id);
    return { status: 'cap_reached' };
  }

  let signature;
  try {
    ({ signature } = await transfer(walletAddress, lamports));
  } catch (error) {
    // No SOL left the treasury — free the slot so a retry can pay.
    await release(id).catch(() => {});
    throw error;
  }

  // Past this point the SOL is GONE. If recording fails we deliberately keep
  // the reservation row (empty signature) so a replay cannot pay twice.
  await record(id, signature, lamports);
  return { status: 'dripped', signature, lamports };
}

async function reserveAndCountPg(walletAddress) {
  return withTransaction(async (client) => {
    // Serialize cap accounting: without the lock, two inserts for different
    // wallets each see a count that excludes the other and both slip under
    // the cap. hashtext keys the lock to this table only.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('lesson.sol_drips'))`);
    const inserted = await client.query(
      `INSERT INTO lesson.sol_drips (wallet_address) VALUES ($1)
       ON CONFLICT (wallet_address) DO NOTHING
       RETURNING id`,
      [walletAddress],
    );
    const counted = await client.query(`SELECT count(*)::int AS total FROM lesson.sol_drips`);
    return {
      id: inserted.rows.length > 0 ? inserted.rows[0].id : null,
      total: counted.rows[0].total,
    };
  });
}

/**
 * Drip appConfig.solDripLamports to walletAddress exactly once, capped at
 * appConfig.solDripMaxTotal rows total. Throws without a database (fail
 * closed — never transfer untracked SOL).
 */
export async function dripSolOnce(walletAddress) {
  const pool = getPool();
  if (!pool) {
    throw new Error('solDrip requires DATABASE_URL to be configured');
  }
  return executeDripFlow({
    walletAddress,
    lamports: appConfig.solDripLamports,
    maxDrips: appConfig.solDripMaxTotal,
    reserveAndCount: reserveAndCountPg,
    record: async (id, signature, lamports) => {
      await pool.query(
        `UPDATE lesson.sol_drips SET signature = $1, lamports = $2 WHERE id = $3`,
        [signature, lamports, id],
      );
    },
    release: async (id) => {
      await pool.query(`DELETE FROM lesson.sol_drips WHERE id = $1`, [id]);
    },
    transfer: (wallet, lamports) =>
      (transferOverride ?? transferSolReal)(wallet, lamports),
  });
}
