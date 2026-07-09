import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Keypair, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  FORCE_RETURN_AFTER_SECS,
  FORCE_RETURN_V2_DISCRIMINATOR,
  LOCKV2_ACCOUNT_DISCRIMINATOR,
  LOCKV2_ACCOUNT_SIZE,
  decodeLockV2,
  decodeVaultV2Config,
  isForceReturnable,
  buildForceReturnV2Instruction,
} from '../../../scripts/force-return-crank.mjs';

const sha8 = (preimage) =>
  createHash('sha256').update(preimage, 'utf8').digest().subarray(0, 8);

function fakeKey() {
  return Keypair.generate().publicKey;
}

// Serialize a LockV2 account exactly as Anchor lays it out:
// disc[8] owner[32] course_id_hash[32] principal u64@72 lock_start i64@80 status u8@88 bump u8@89
function encodeLockV2({ owner, courseIdHash, principal, lockStartTs, status, bump }) {
  const buf = Buffer.alloc(90);
  LOCKV2_ACCOUNT_DISCRIMINATOR.copy(buf, 0);
  owner.toBuffer().copy(buf, 8);
  Buffer.from(courseIdHash).copy(buf, 40);
  buf.writeBigUInt64LE(BigInt(principal), 72);
  buf.writeBigInt64LE(BigInt(lockStartTs), 80);
  buf.writeUInt8(status, 88);
  buf.writeUInt8(bump, 89);
  return buf;
}

// Serialize VaultV2Config: disc[8] then 10 pubkeys then 4 u64, u16, bool, bump.
function encodeVaultV2Config(c) {
  const buf = Buffer.alloc(364);
  sha8('account:VaultV2Config').copy(buf, 0);
  const keys = [
    c.authority, c.usdcMint, c.kaminoProgram, c.kaminoReserve, c.kaminoMarket,
    c.kaminoLma, c.kaminoLiquiditySupply, c.kaminoCollateralMint, c.potVault, c.feeVault,
  ];
  keys.forEach((k, i) => k.toBuffer().copy(buf, 8 + i * 32));
  buf.writeBigUInt64LE(BigInt(c.minPrincipal ?? 0), 328);
  buf.writeBigUInt64LE(BigInt(c.maxPrincipalPerLock ?? 0), 336);
  buf.writeBigUInt64LE(BigInt(c.globalTvlCap ?? 0), 344);
  buf.writeBigUInt64LE(BigInt(c.currentTvl ?? 0), 352);
  buf.writeUInt16LE(c.platformFeeBps ?? 0, 360);
  buf.writeUInt8(c.paused ? 1 : 0, 362);
  buf.writeUInt8(c.bump ?? 255, 363);
  return buf;
}

describe('discriminators and constants', () => {
  it('force_return_v2 instruction discriminator matches sha256("global:force_return_v2")[..8]', () => {
    expect(Buffer.from(FORCE_RETURN_V2_DISCRIMINATOR)).toEqual(sha8('global:force_return_v2'));
    // Pinned bytes from the task/program spec.
    expect([...FORCE_RETURN_V2_DISCRIMINATOR]).toEqual([219, 13, 235, 112, 177, 242, 216, 123]);
  });

  it('LockV2 account discriminator matches sha256("account:LockV2")[..8]', () => {
    expect(Buffer.from(LOCKV2_ACCOUNT_DISCRIMINATOR)).toEqual(sha8('account:LockV2'));
  });

  it('pins the 180-day force-return window and the LockV2 account size', () => {
    expect(FORCE_RETURN_AFTER_SECS).toBe(15_552_000);
    expect(LOCKV2_ACCOUNT_SIZE).toBe(90);
  });
});

describe('decodeLockV2', () => {
  it('decodes owner, principal, lock_start_ts and status at the pinned offsets', () => {
    const owner = fakeKey();
    const courseIdHash = createHash('sha256').update('some-course').digest();
    const data = encodeLockV2({
      owner,
      courseIdHash,
      principal: 25_000_000n,
      lockStartTs: 1_780_000_123n,
      status: 0,
      bump: 254,
    });
    const lock = decodeLockV2(data);
    expect(lock.owner.equals(owner)).toBe(true);
    expect(Buffer.from(lock.courseIdHash)).toEqual(courseIdHash);
    expect(lock.principal).toBe(25_000_000n);
    expect(lock.lockStartTs).toBe(1_780_000_123n);
    expect(lock.status).toBe(0);
  });
});

describe('decodeVaultV2Config', () => {
  it('decodes the pinned account pubkeys at their Anchor offsets', () => {
    const c = {
      authority: fakeKey(), usdcMint: fakeKey(), kaminoProgram: fakeKey(),
      kaminoReserve: fakeKey(), kaminoMarket: fakeKey(), kaminoLma: fakeKey(),
      kaminoLiquiditySupply: fakeKey(), kaminoCollateralMint: fakeKey(),
      potVault: fakeKey(), feeVault: fakeKey(),
    };
    const decoded = decodeVaultV2Config(encodeVaultV2Config(c));
    for (const [name, key] of Object.entries(c)) {
      expect(decoded[name].equals(key), `field ${name}`).toBe(true);
    }
    // Cross-check the two offsets lockPosition.mjs already relies on.
    expect(decoded.kaminoLiquiditySupply.toBuffer()).toEqual(
      encodeVaultV2Config(c).subarray(200, 232),
    );
    expect(decoded.kaminoCollateralMint.toBuffer()).toEqual(
      encodeVaultV2Config(c).subarray(232, 264),
    );
  });
});

describe('isForceReturnable', () => {
  const start = 1_700_000_000n;
  const deadline = start + BigInt(FORCE_RETURN_AFTER_SECS);

  it('is true for an ACTIVE lock exactly at and after the 180-day deadline', () => {
    expect(isForceReturnable({ status: 0, lockStartTs: start }, deadline)).toBe(true);
    expect(isForceReturnable({ status: 0, lockStartTs: start }, deadline + 1n)).toBe(true);
  });

  it('is false one second before the deadline', () => {
    expect(isForceReturnable({ status: 0, lockStartTs: start }, deadline - 1n)).toBe(false);
  });

  it('is false for PENDING and CLOSED locks no matter how old', () => {
    expect(isForceReturnable({ status: 1, lockStartTs: start }, deadline + 999_999n)).toBe(false);
    expect(isForceReturnable({ status: 2, lockStartTs: start }, deadline + 999_999n)).toBe(false);
  });
});

describe('buildForceReturnV2Instruction — exact ForceReturnV2 account order', () => {
  const programId = fakeKey();
  const configPda = fakeKey();
  const lockPda = fakeKey();
  const owner = fakeKey();
  const caller = fakeKey();
  const config = {
    authority: fakeKey(), usdcMint: fakeKey(), kaminoProgram: fakeKey(),
    kaminoReserve: fakeKey(), kaminoMarket: fakeKey(), kaminoLma: fakeKey(),
    kaminoLiquiditySupply: fakeKey(), kaminoCollateralMint: fakeKey(),
    potVault: fakeKey(), feeVault: fakeKey(),
  };

  const ix = buildForceReturnV2Instruction({ programId, configPda, lockPda, owner, caller, config });

  it('targets the program with the bare discriminator as data (no args)', () => {
    expect(ix.programId.equals(programId)).toBe(true);
    expect(Buffer.from(ix.data)).toEqual(sha8('global:force_return_v2'));
  });

  it('lays out all 20 accounts in the Rust struct order with exact flags', () => {
    const ownerUsdc = getAssociatedTokenAddressSync(config.usdcMint, owner, true);
    const lockLiquidity = getAssociatedTokenAddressSync(config.usdcMint, lockPda, true);
    const lockCollateral = getAssociatedTokenAddressSync(config.kaminoCollateralMint, lockPda, true);

    // [pubkey, isWritable, isSigner] — copied from ForceReturnV2 in vault_v2.rs.
    const expected = [
      [configPda, true, false],                    // config (mut)
      [lockPda, true, false],                      // lock (mut)
      [owner, true, false],                        // owner (mut, NOT signer)
      [caller, true, true],                        // caller (mut, signer)
      [config.usdcMint, false, false],             // usdc_mint
      [ownerUsdc, true, false],                    // owner_usdc (mut)
      [lockLiquidity, true, false],                // lock_liquidity (mut, init_if_needed)
      [lockCollateral, true, false],               // lock_collateral (mut)
      [config.potVault, true, false],              // pot_vault (mut)
      [config.feeVault, true, false],              // fee_vault (mut)
      [config.kaminoProgram, false, false],        // kamino_program
      [config.kaminoReserve, true, false],         // reserve (mut)
      [config.kaminoMarket, false, false],         // lending_market
      [config.kaminoLma, false, false],            // lending_market_authority
      [config.kaminoLiquiditySupply, true, false], // reserve_liquidity_supply (mut)
      [config.kaminoCollateralMint, true, false],  // reserve_collateral_mint (mut)
      [TOKEN_PROGRAM_ID, false, false],            // token_program
      [SYSVAR_INSTRUCTIONS_PUBKEY, false, false],  // instruction_sysvar
      [ASSOCIATED_TOKEN_PROGRAM_ID, false, false], // associated_token_program
      [SystemProgram.programId, false, false],     // system_program
    ];

    expect(ix.keys).toHaveLength(expected.length);
    expected.forEach(([pubkey, isWritable, isSigner], i) => {
      expect(ix.keys[i].pubkey.equals(pubkey), `account #${i} pubkey`).toBe(true);
      expect(ix.keys[i].isWritable, `account #${i} isWritable`).toBe(isWritable);
      expect(ix.keys[i].isSigner, `account #${i} isSigner`).toBe(isSigner);
    });
  });
});
