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

// Devnet mock reserve (share-based, slot-linear rate). NEVER on mainnet.
const MOCK_RESERVE_PROGRAM = '3kqzsQV7Ab8aakkNugM9aXBqQrgwnshF6a47HxJcfLtp';
const RATE_SCALE = 1_000_000_000_000n; // 1e12, mock_reserve RATE_SCALE
const SLOTS_PER_YEAR = 63_072_000n; // mock_reserve SLOTS_PER_YEAR

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
    // VaultV2Config offsets: kamino_program @72, kamino_reserve @104,
    // collateral_mint @232.
    const kaminoProgram = new PublicKey(configInfo.data.subarray(72, 104));
    const kaminoReserve = new PublicKey(configInfo.data.subarray(104, 136));
    const collateralMint = new PublicKey(configInfo.data.subarray(232, 264));

    const lockCollateralAta = getAssociatedTokenAddressSync(collateralMint, lockPda, true);
    const sharesBal = await conn.getTokenAccountBalance(lockCollateralAta);
    const shares = BigInt(sharesBal.value.amount);
    if (shares === 0n) return null;

    // Live value = what a redeem would pay = shares × exchange_rate. This MUST
    // match the reserve's settlement math, not a pool-balance/share-supply
    // ratio (which overstates: liquidity_supply pools every lock's deposit).
    // Only the devnet mock reserve's rate is computed here; real Kamino needs
    // the klend collateral exchange rate (mainnet-readiness blocker).
    if (kaminoProgram.toBase58() !== MOCK_RESERVE_PROGRAM) return null;

    const reserveInfo = await conn.getAccountInfo(kaminoReserve);
    if (!reserveInfo) return null;
    // mock Reserve layout: apy_bps u16 @104, genesis_slot u64 @106.
    const apyBps = BigInt(reserveInfo.data.readUInt16LE(104));
    const genesisSlot = reserveInfo.data.readBigUInt64LE(106);
    const now = BigInt(await conn.getSlot());
    const elapsed = now > genesisSlot ? now - genesisSlot : 0n;
    // exchange_rate = RATE_SCALE + apy_bps*elapsed*RATE_SCALE / (10000*SLOTS_PER_YEAR)
    const rate = RATE_SCALE + (apyBps * elapsed * RATE_SCALE) / (10_000n * SLOTS_PER_YEAR);
    const valueAtomic = (shares * rate) / RATE_SCALE;
    return formatAtomicUi(valueAtomic, sharesBal.value.decimals ?? 6);
  } catch {
    return null; // rate unreadable — report null, never fabricate
  }
}

/**
 * Read the position for (wallet, course). Cached 60s per pair; on RPC failure
 * within TTL the cached value is served with its original asOf. Pass
 * { bypassCache: true } to skip the cache read (the result still refreshes
 * the cache) — money-path callers must never decide off a stale hit.
 */
export async function readLockPosition(walletAddress, courseId, { bypassCache = false } = {}) {
  const key = `${walletAddress}:${courseId}`;
  const hit = cache.get(key);
  if (!bypassCache && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

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
        principalAtomic: null,
        lockStartTs: null,
        liveValueUi: null,
        asOf: new Date().toISOString(),
      };
    } else {
      const d = info.data;
      const principal = d.readBigUInt64LE(72);
      const lockStartTs = d.readBigInt64LE(80);
      const statusByte = d[88];
      const status = STATUS_BY_BYTE[statusByte] ?? 'CLOSED';
      const liveValueUi = status === 'ACTIVE' ? await readLiveValue(conn, programId, lockPda) : null;
      value = {
        courseId,
        status,
        lockAddress: lockPda.toBase58(),
        principalUi: formatAtomicUi(principal),
        principalAtomic: principal.toString(),
        lockStartTs: Number(lockStartTs),
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

// Test-only override for the fresh on-chain reader. Lets DB-integration tests
// drive the enroll/sweep money paths deterministically without an RPC. Set to
// null to restore the real reader.
let freshReadOverride = null;
export function __setLockV2FreshReadOverride(fn) {
  freshReadOverride = fn;
}

/**
 * Fresh, uncached LockV2 read for money-path decisions (enroll ruling R5).
 * NEVER reads or writes the position cache. Returns:
 *   - null when the account does not exist ("account missing" IS the settled
 *     state: claim_v2/force_return_v2 close the PDA, CLOSED is unobservable);
 *   - { mismatch: true, reason } when the account exists but is not owned by
 *     the configured vault_v2 program, or its owner bytes are not the wallet —
 *     callers must treat this exactly as LOCK_ADDRESS_MISMATCH (config skew);
 *   - { status, principal: bigint, lockStartTs: number, lockAddress } otherwise.
 */
export async function readLockV2AccountFresh(walletAddress, courseId) {
  if (freshReadOverride) return freshReadOverride(walletAddress, courseId);

  const programId = appConfig.vaultV2ProgramId;
  const conn = getConnection();
  const lockPda = deriveLockPdaServer(programId, walletAddress, courseId);
  const info = await conn.getAccountInfo(lockPda, 'confirmed');
  if (!info) return null;

  if (info.owner.toBase58() !== programId) {
    return { mismatch: true, reason: 'PROGRAM_OWNER_MISMATCH', lockAddress: lockPda.toBase58() };
  }
  const d = info.data;
  const ownerBytes = new PublicKey(d.subarray(8, 40)).toBase58();
  if (ownerBytes !== walletAddress) {
    return { mismatch: true, reason: 'LOCK_OWNER_MISMATCH', lockAddress: lockPda.toBase58() };
  }

  return {
    mismatch: false,
    status: STATUS_BY_BYTE[d[88]] ?? 'CLOSED',
    principal: d.readBigUInt64LE(72),
    lockStartTs: Number(d.readBigInt64LE(80)),
    lockAddress: lockPda.toBase58(),
  };
}

/**
 * Drop the cached position for (wallet, course). Call whenever the server
 * learns the on-chain lock changed underneath the cache.
 */
export function invalidateLockPosition(walletAddress, courseId) {
  cache.delete(`${walletAddress}:${courseId}`);
}

/**
 * Seed the position cache after a server-verified state change (enroll ruling
 * R10): without this, a NONE cached by a pre-deposit poll keeps painting the
 * course card for up to 60s after enroll succeeds.
 */
export function primeLockPositionCache(walletAddress, courseId, value) {
  cache.set(`${walletAddress}:${courseId}`, { at: Date.now(), value });
}

// Test hook.
export function __clearPositionCache() {
  cache.clear();
}
