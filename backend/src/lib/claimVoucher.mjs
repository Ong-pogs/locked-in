// Completion-voucher signing for v2 claims.
//
// When a course completes, the backend signs an Ed25519 voucher that the
// on-chain `claim_v2` verifies (programs/locked_in/src/voucher.rs). The message
// bytes MUST match `voucher.rs::build_message` exactly:
//
//   VOUCHER_DOMAIN(17) || program_id(32) || lock(32) || bps(u16 LE) || expiry(i64 LE)  = 91 bytes
//
// The client puts these into an Ed25519 precompile instruction placed before
// `claim_v2` in the same transaction; the program scans for it, checks the
// signer == the vault authority, and the message == the one it rebuilds.

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

const bs58lib = bs58.decode ? bs58 : bs58.default;

export const VOUCHER_DOMAIN = 'lockedin:claim:v1';
export const LOCK_SEED = 'lock-v2';
// bps a voucher may authorize — must match settle.rs VALID_YIELD_BPS.
export const VALID_YIELD_BPS = [10_000, 5_000, 0];

// The tier ladder. Index 0 keeps all yield, 1 keeps half, 2 keeps none.
const YIELD_TIERS = [10_000, 5_000, 0];
const MAX_TIER = YIELD_TIERS.length - 1;

function clampTier(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), max);
}

/**
 * THE MONEY TIER. This is the ONLY function permitted to decide the bps a
 * completion voucher signs — `issueVoucher` below is its single caller, and
 * every other yield-bps-shaped helper in this codebase is bookkeeping.
 *
 * Two inputs, both of which cost the user real yield:
 *   lapseCount        missed-day lapses, 0..2 (shieldLapseEngine)
 *   arenaPenaltyTiers 1 if the last settled arena stake season on this
 *                     (wallet, course, lock) was a FORFEIT, else 0
 *
 * arenaPenaltyTiers is clamped to 0..1 on purpose: a lock may span several
 * seasons, and an accumulating penalty would zero a position whose owner
 * never missed a day.
 */
export function effectiveYieldBps({ lapseCount = 0, arenaPenaltyTiers = 0 } = {}) {
  const tier = clampTier(lapseCount, MAX_TIER) + clampTier(arenaPenaltyTiers, 1);
  return YIELD_TIERS[Math.min(tier, MAX_TIER)];
}

/** Derive the v2 lock PDA: [b"lock-v2", owner, course_id_hash]. */
export function deriveLockPda(programId, ownerPubkey, courseIdHash) {
  const program = new PublicKey(programId);
  const owner = new PublicKey(ownerPubkey);
  const hash = courseIdHash instanceof Uint8Array ? courseIdHash : Uint8Array.from(courseIdHash);
  if (hash.length !== 32) throw new Error('course_id_hash must be 32 bytes');
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(LOCK_SEED), owner.toBuffer(), Buffer.from(hash)],
    program,
  );
  return pda;
}

/**
 * Build the 91-byte voucher message. `lock` is the lock PDA (PublicKey/base58),
 * `bps` one of VALID_YIELD_BPS, `expiry` a Unix timestamp (seconds).
 */
export function buildVoucherMessage(programId, lock, bps, expiry) {
  if (!VALID_YIELD_BPS.includes(bps)) throw new Error(`invalid bps ${bps}`);
  const program = new PublicKey(programId);
  const lockKey = new PublicKey(lock);
  const domain = Buffer.from(VOUCHER_DOMAIN, 'utf8'); // 17 bytes
  const bpsBuf = Buffer.alloc(2);
  bpsBuf.writeUInt16LE(bps);
  const expiryBuf = Buffer.alloc(8);
  expiryBuf.writeBigInt64LE(BigInt(expiry));
  const msg = Buffer.concat([domain, program.toBuffer(), lockKey.toBuffer(), bpsBuf, expiryBuf]);
  if (msg.length !== 91) throw new Error(`voucher message must be 91 bytes, got ${msg.length}`);
  return msg;
}

/**
 * Sign a full completion voucher. Returns everything the client needs to build
 * the Ed25519 precompile instruction + the claim.
 *
 * authoritySecretKey: base58 of the 64-byte nacl secret key (the vault ops key).
 */
export function issueVoucher({
  programId, authoritySecretKey, owner, courseIdHash,
  lapseCount = 0, arenaPenaltyTiers = 0, expiry,
}) {
  const secret = bs58lib.decode(authoritySecretKey);
  if (secret.length !== 64) throw new Error('authority secret key must be a 64-byte nacl key');
  const authorityPubkey = new PublicKey(secret.slice(32)); // last 32 bytes = public key

  const lock = deriveLockPda(programId, owner, courseIdHash);
  const bps = effectiveYieldBps({ lapseCount, arenaPenaltyTiers });
  const message = buildVoucherMessage(programId, lock, bps, expiry);
  const signature = nacl.sign.detached(message, secret);

  return {
    lock: lock.toBase58(),
    authorityPubkey: authorityPubkey.toBase58(),
    bps,
    expiry,
    message: Buffer.from(message).toString('base64'),
    signature: Buffer.from(signature).toString('base64'),
  };
}
