// v2 lock position reader (spec §4.2): live value + authoritative status for
// a (wallet, course) lock. The card arms CLAIM only on status === 'ACTIVE';
// the live value is collateral shares × the reserve exchange rate.
//
// Exchange-rate source: the VaultV2Config's liquidity-supply token account
// divided by the collateral mint supply — exact for the devnet mock reserve
// (share-based). For real Kamino this must switch to the klend SDK exchange
// rate; if the rate is unreadable we return liveValueUi: null, never a guess.

import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { appConfig } from '../config.mjs';

const LOCK_SEED = Buffer.from('lock-v2');
const CONFIG_SEED = Buffer.from('vault-v2b');

// LockV2 layout (fixed Anchor offsets, pinned by the devnet-proven client):
// disc[8] owner[32] course_id_hash[32] principal u64@72 lock_start i64@80 status u8@88
const STATUS_BY_BYTE = { 0: 'ACTIVE', 1: 'PENDING', 2: 'CLOSED' };

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // `${wallet}:${courseId}` -> { at, value }

let connection = null;
function getConnection() {
  if (!connection) connection = new Connection(appConfig.solanaRpcUrl, 'confirmed');
  return connection;
}

export function hasPositionConfig() {
  return Boolean(appConfig.vaultV2ProgramId);
}

export function deriveLockPdaServer(programId, ownerAddress, courseId) {
  const courseHash = createHash('sha256').update(String(courseId), 'utf8').digest();
  const [pda] = PublicKey.findProgramAddressSync(
    [LOCK_SEED, new PublicKey(ownerAddress).toBuffer(), courseHash],
    new PublicKey(programId),
  );
  return pda;
}

function formatAtomicUi(atomic, decimals = 6) {
  const base = 10n ** BigInt(decimals);
  const whole = atomic / base;
  const frac = atomic % base;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

async function readLiveValue(conn, programId, lockPda) {
  try {
    const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], new PublicKey(programId));
    const configInfo = await conn.getAccountInfo(configPda);
    if (!configInfo) return null;
    // VaultV2Config offsets: kamino_liquidity_supply @200, collateral_mint @232.
    const liquiditySupply = new PublicKey(configInfo.data.subarray(200, 232));
    const collateralMint = new PublicKey(configInfo.data.subarray(232, 264));

    const lockCollateralAta = getAssociatedTokenAddressSync(collateralMint, lockPda, true);
    const [shares, liquidity, supply] = await Promise.all([
      conn.getTokenAccountBalance(lockCollateralAta),
      conn.getTokenAccountBalance(liquiditySupply),
      conn.getTokenSupply(collateralMint),
    ]);
    const sharesAtomic = BigInt(shares.value.amount);
    const liquidityAtomic = BigInt(liquidity.value.amount);
    const supplyAtomic = BigInt(supply.value.amount);
    if (supplyAtomic === 0n) return null;
    const valueAtomic = (sharesAtomic * liquidityAtomic) / supplyAtomic;
    return formatAtomicUi(valueAtomic, shares.value.decimals ?? 6);
  } catch {
    return null; // rate unreadable — report null, never fabricate
  }
}

/**
 * Read the position for (wallet, course). Cached 60s per pair; on RPC failure
 * within TTL the cached value is served with its original asOf.
 */
export async function readLockPosition(walletAddress, courseId) {
  const key = `${walletAddress}:${courseId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const programId = appConfig.vaultV2ProgramId;
  const conn = getConnection();
  const lockPda = deriveLockPdaServer(programId, walletAddress, courseId);

  let value;
  try {
    const info = await conn.getAccountInfo(lockPda);
    if (!info) {
      value = {
        courseId,
        status: 'NONE',
        lockAddress: null,
        principalUi: null,
        liveValueUi: null,
        asOf: new Date().toISOString(),
      };
    } else {
      const d = info.data;
      const principal = d.readBigUInt64LE(72);
      const statusByte = d[88];
      const status = STATUS_BY_BYTE[statusByte] ?? 'CLOSED';
      const liveValueUi = status === 'ACTIVE' ? await readLiveValue(conn, programId, lockPda) : null;
      value = {
        courseId,
        status,
        lockAddress: lockPda.toBase58(),
        principalUi: formatAtomicUi(principal),
        liveValueUi,
        asOf: new Date().toISOString(),
      };
    }
  } catch (error) {
    if (hit) return hit.value; // stale-if-error within reason
    throw error;
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}

// Test hook.
export function __clearPositionCache() {
  cache.clear();
}
