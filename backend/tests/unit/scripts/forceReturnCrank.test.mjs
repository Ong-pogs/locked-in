import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
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
  KLEND_PROGRAM_ID,
  KAMINO_SCOPE_PRICES,
  REFRESH_RESERVE_DISCRIMINATOR,
  PRIORITY_FEE_FLOOR,
  PRIORITY_FEE_CEILING,
  decodeLockV2,
  decodeVaultV2Config,
  isForceReturnable,
  buildForceReturnV2Instruction,
  buildRefreshReserveIx,
  buildPriorityFeeIx,
  writableKeysOf,
  buildForceReturnTransactionIxs,
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

// Literal values the CLIENT (web-app/services/solana/vaultV2.ts) hard-codes.
// Pinned here so buildRefreshReserveIx is proven byte-identical to the client
// impl, not merely internally consistent with the crank's own constants.
const CLIENT_KLEND_PROGRAM_ID = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const CLIENT_SCOPE_PRICES = '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH';

function fullConfig(overrides = {}) {
  return {
    authority: fakeKey(), usdcMint: fakeKey(), kaminoProgram: fakeKey(),
    kaminoReserve: fakeKey(), kaminoMarket: fakeKey(), kaminoLma: fakeKey(),
    kaminoLiquiditySupply: fakeKey(), kaminoCollateralMint: fakeKey(),
    potVault: fakeKey(), feeVault: fakeKey(),
    ...overrides,
  };
}

describe('buildRefreshReserveIx', () => {
  it('sanity-pins the crank constants against the client literals', () => {
    // If either side drifts, the refresh_reserve tx silently points at the
    // wrong program/oracle — the whole point of keeping them in lockstep.
    expect(KLEND_PROGRAM_ID).toBe(CLIENT_KLEND_PROGRAM_ID);
    expect(KAMINO_SCOPE_PRICES).toBe(CLIENT_SCOPE_PRICES);
  });

  it('returns null for a mock/devnet config (kaminoProgram != klend)', () => {
    // The devnet mock reserve is a different program and needs no refresh.
    expect(buildRefreshReserveIx(fullConfig())).toBeNull();
  });

  it('builds the exact 6-account klend refresh_reserve, byte-identical to the client', () => {
    const config = fullConfig({ kaminoProgram: new PublicKey(CLIENT_KLEND_PROGRAM_ID) });
    const ix = buildRefreshReserveIx(config);

    expect(ix.programId.equals(new PublicKey(CLIENT_KLEND_PROGRAM_ID))).toBe(true);
    expect(Buffer.from(ix.data)).toEqual(sha8('global:refresh_reserve'));
    expect(Buffer.from(ix.data)).toEqual(Buffer.from(REFRESH_RESERVE_DISCRIMINATOR));
    // Pinned bytes from the program/client spec.
    expect([...ix.data]).toEqual([2, 218, 138, 235, 79, 201, 25, 102]);

    const klend = new PublicKey(CLIENT_KLEND_PROGRAM_ID);
    const scope = new PublicKey(CLIENT_SCOPE_PRICES);
    // [reserve(w), lendingMarket, pyth, switchboardPrice, switchboardTwap, scopePrices];
    // absent oracles use the klend program-id as the sentinel (USDC = Scope-only).
    const expected = [
      [config.kaminoReserve, true],  // reserve (mut)
      [config.kaminoMarket, false],  // lending_market
      [klend, false],                // pyth (sentinel)
      [klend, false],                // switchboard price (sentinel)
      [klend, false],                // switchboard twap (sentinel)
      [scope, false],                // scope_prices
    ];
    expect(ix.keys).toHaveLength(expected.length);
    expected.forEach(([pubkey, isWritable], i) => {
      expect(ix.keys[i].pubkey.equals(pubkey), `account #${i} pubkey`).toBe(true);
      expect(ix.keys[i].isWritable, `account #${i} isWritable`).toBe(isWritable);
      expect(ix.keys[i].isSigner, `account #${i} isSigner`).toBe(false);
    });
  });
});

describe('buildPriorityFeeIx', () => {
  // A fake Connection whose getRecentPrioritizationFees is fully stubbed — the
  // builder must never touch the real network to price a bid.
  const fakeConn = (impl) => ({ getRecentPrioritizationFees: impl });
  // Decode setComputeUnitPrice: data[0]=3 discriminator, then u64 LE microLamports.
  const priceOf = (ix) => {
    expect(ix.programId.equals(ComputeBudgetProgram.programId)).toBe(true);
    expect(ix.data[0]).toBe(3);
    return Number(Buffer.from(ix.data).readBigUInt64LE(1));
  };

  it('floors when getRecentPrioritizationFees throws (RPC unsupported/timeout)', async () => {
    const ix = await buildPriorityFeeIx(
      fakeConn(async () => { throw new Error('RPC method not supported'); }),
      [fakeKey()],
    );
    expect(priceOf(ix)).toBe(PRIORITY_FEE_FLOOR);
  });

  it('floors on an empty recent-fee window (quiet network)', async () => {
    const ix = await buildPriorityFeeIx(fakeConn(async () => []), [fakeKey()]);
    expect(priceOf(ix)).toBe(PRIORITY_FEE_FLOOR);
  });

  it('floors when every sample is zero/invalid and gets filtered out', async () => {
    const ix = await buildPriorityFeeIx(
      fakeConn(async () => [
        { prioritizationFee: 0 },
        { prioritizationFee: -5 },
        { prioritizationFee: Number.NaN },
      ]),
      [fakeKey()],
    );
    expect(priceOf(ix)).toBe(PRIORITY_FEE_FLOOR);
  });

  it('clamps a huge outlier sample down to the ceiling', async () => {
    const ix = await buildPriorityFeeIx(
      fakeConn(async () => [{ prioritizationFee: 50_000_000 }]),
      [fakeKey()],
    );
    expect(priceOf(ix)).toBe(PRIORITY_FEE_CEILING);
  });

  it('picks the p75 of a spread — above the median, below the max()', async () => {
    // 10 shuffled samples, all inside the [floor, ceiling] band, plus junk that
    // must be filtered. Sorted ascending: 15,25,...,105k. index = floor(10*0.75)
    // = 7 → the 8th sample (85_000), NOT the 105_000 max.
    const fees = [55_000, 15_000, 105_000, 35_000, 95_000, 25_000, 85_000, 45_000, 75_000, 65_000];
    const ix = await buildPriorityFeeIx(
      fakeConn(async () => [
        ...fees.map((prioritizationFee) => ({ prioritizationFee })),
        { prioritizationFee: 0 },
        { prioritizationFee: Number.NaN },
      ]),
      [fakeKey()],
    );
    const picked = priceOf(ix);
    expect(picked).toBe(85_000);
    expect(picked).toBeGreaterThan(Math.max(...fees) / 2); // above the median
    expect(picked).toBeLessThan(Math.max(...fees)); // below the outlier max
  });
});

describe('writableKeysOf', () => {
  it('dedups writable keys across instructions and drops read-only ones', () => {
    const a = fakeKey();
    const b = fakeKey();
    const ro = fakeKey();
    const ix1 = { keys: [
      { pubkey: a, isWritable: true, isSigner: false },
      { pubkey: ro, isWritable: false, isSigner: false },
    ] };
    const ix2 = { keys: [
      { pubkey: a, isWritable: true, isSigner: false }, // duplicate of ix1
      { pubkey: b, isWritable: true, isSigner: false },
    ] };
    const out = writableKeysOf([ix1, ix2]);
    const base58 = out.map((k) => k.toBase58()).sort();
    expect(out).toHaveLength(2);
    expect(base58).toEqual([a.toBase58(), b.toBase58()].sort());
    expect(base58).not.toContain(ro.toBase58());
  });
});

describe('buildForceReturnTransactionIxs — instruction ordering', () => {
  const programId = fakeKey();
  const configPda = fakeKey();
  const lockPda = fakeKey();
  const owner = fakeKey();
  const caller = fakeKey();
  // A distinct injected bid we can recognise by reference in the output.
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 42_000 });

  const isAtaCreate = (ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID);
  const isCuLimit = (ix) =>
    ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 2;
  const isCuPrice = (ix) =>
    ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 3;
  const isForceReturn = (ix) =>
    ix.programId.equals(programId) &&
    Buffer.from(ix.data).equals(Buffer.from(FORCE_RETURN_V2_DISCRIMINATOR));

  it('mock/devnet config: [create-ATA, cu_limit, cu_price, force_return] — no refresh', () => {
    const config = fullConfig(); // kaminoProgram != klend → refresh null
    const ixs = buildForceReturnTransactionIxs({
      programId, configPda, lockPda, owner, caller, config, priorityFeeIx,
    });

    expect(ixs).toHaveLength(4);
    expect(isAtaCreate(ixs[0])).toBe(true);
    expect(isCuLimit(ixs[1])).toBe(true);
    expect(ixs[1].data).toEqual(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }).data);
    expect(ixs[2]).toBe(priorityFeeIx); // injected bid passed through untouched
    expect(isForceReturn(ixs[3])).toBe(true);

    // Both a CU limit and a CU price are present.
    expect(ixs.filter(isCuLimit)).toHaveLength(1);
    expect(ixs.filter(isCuPrice)).toHaveLength(1);
    // No refresh_reserve on the mock path.
    expect(ixs.some((ix) => ix.programId.equals(new PublicKey(CLIENT_KLEND_PROGRAM_ID)))).toBe(false);
  });

  it('klend config: refresh_reserve is present and immediately precedes force_return', () => {
    const config = fullConfig({ kaminoProgram: new PublicKey(CLIENT_KLEND_PROGRAM_ID) });
    const ixs = buildForceReturnTransactionIxs({
      programId, configPda, lockPda, owner, caller, config, priorityFeeIx,
    });

    // [create-ATA, cu_limit, cu_price, refresh_reserve, force_return]
    expect(ixs).toHaveLength(5);
    expect(isAtaCreate(ixs[0])).toBe(true);
    expect(isCuLimit(ixs[1])).toBe(true);
    expect(ixs[2]).toBe(priorityFeeIx);

    const refreshIdx = 3;
    const forceIdx = 4;
    expect(ixs[refreshIdx].programId.equals(new PublicKey(CLIENT_KLEND_PROGRAM_ID))).toBe(true);
    expect(Buffer.from(ixs[refreshIdx].data)).toEqual(Buffer.from(REFRESH_RESERVE_DISCRIMINATOR));
    expect(isForceReturn(ixs[forceIdx])).toBe(true);
    // The settling ix must come straight after the refresh (klend max oracle
    // age 180s — nothing may sit between them).
    expect(forceIdx).toBe(refreshIdx + 1);

    expect(ixs.filter(isCuLimit)).toHaveLength(1);
    expect(ixs.filter(isCuPrice)).toHaveLength(1);
  });

  it('omitting the injected bid drops only the cu_price ix, keeping the rest ordered', () => {
    const config = fullConfig();
    const ixs = buildForceReturnTransactionIxs({
      programId, configPda, lockPda, owner, caller, config,
    });
    // [create-ATA, cu_limit, force_return] — the un-prioritised devnet shape.
    expect(ixs).toHaveLength(3);
    expect(isAtaCreate(ixs[0])).toBe(true);
    expect(isCuLimit(ixs[1])).toBe(true);
    expect(isForceReturn(ixs[2])).toBe(true);
    expect(ixs.some(isCuPrice)).toBe(false);
  });
});
