// @vitest-environment node
// Pins the FULL ordered account metas (pubkey role, isWritable, isSigner) and
// instruction ordering of the v2 tx builders to the devnet-proven shape. Any
// drift here would produce on-chain failures that mocked e2e cannot catch.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

const getRecentPrioritizationFees = vi.fn().mockResolvedValue([]);
vi.mock('@/services/solana/connection', () => ({
  connection: {
    getAccountInfo: vi.fn().mockResolvedValue(null),
    getRecentPrioritizationFees: (...args: unknown[]) => getRecentPrioritizationFees(...args),
  },
  CLUSTER: 'devnet',
}));

const PROGRAM = 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN';
const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const OWNER = Keypair.generate().publicKey;

process.env.NEXT_PUBLIC_VAULT_V2_PROGRAM_ID = PROGRAM;
process.env.NEXT_PUBLIC_LOCK_VAULT_USDC_MINT = USDC;

function syntheticConfig(v2: typeof import('@/services/solana/vaultV2')) {
  const mk = () => Keypair.generate().publicKey;
  return {
    configAddress: v2.deriveConfigPda(new PublicKey(PROGRAM)),
    authority: mk(),
    usdcMint: new PublicKey(USDC),
    kaminoProgram: mk(),
    kaminoReserve: mk(),
    kaminoMarket: mk(),
    kaminoLma: mk(),
    kaminoLiquiditySupply: mk(),
    collateralMint: mk(),
    potVault: mk(),
    feeVault: mk(),
    currentTvlUi: '0',
    paused: false,
  };
}

const meta = (ix: { keys: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[] }) =>
  ix.keys.map((k) => [k.pubkey.toBase58(), k.isWritable, k.isSigner]);

describe('vaultV2 account-order pins', () => {
  let v2: typeof import('@/services/solana/vaultV2');
  beforeEach(async () => {
    vi.resetModules();
    getRecentPrioritizationFees.mockReset().mockResolvedValue([]);
    v2 = await import('@/services/solana/vaultV2');
  });

  it('open_lock_v2: 8 keys in the proven order', async () => {
    const config = syntheticConfig(v2);
    const tx = await v2.buildOpenLockTransaction(OWNER.toBase58(), 'test-kitchen', config);
    expect(tx.instructions).toHaveLength(1);
    const lock = await v2.deriveLockPda(OWNER.toBase58(), 'test-kitchen');
    const lockCollateral = getAssociatedTokenAddressSync(config.collateralMint, lock, true);
    expect(meta(tx.instructions[0])).toEqual([
      [config.configAddress.toBase58(), false, false],
      [lock.toBase58(), true, false],
      [OWNER.toBase58(), true, true],
      [config.collateralMint.toBase58(), false, false],
      [lockCollateral.toBase58(), true, false],
      [TOKEN_PROGRAM_ID.toBase58(), false, false],
      [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), false, false],
      [SystemProgram.programId.toBase58(), false, false],
    ]);
  });

  it('lock_funds_v2: [cu_limit, cu_price, deposit] with 14 keys in the proven order', async () => {
    const config = syntheticConfig(v2);
    const tx = await v2.buildDepositTransaction(OWNER.toBase58(), 'test-kitchen', 10_000_000n, config);
    expect(tx.instructions).toHaveLength(3); // cu limit + cu price + deposit
    const lock = await v2.deriveLockPda(OWNER.toBase58(), 'test-kitchen');
    const lockCollateral = getAssociatedTokenAddressSync(config.collateralMint, lock, true);
    const userUsdc = getAssociatedTokenAddressSync(config.usdcMint, OWNER);
    expect(meta(tx.instructions[2])).toEqual([
      [config.configAddress.toBase58(), true, false],
      [lock.toBase58(), true, false],
      [OWNER.toBase58(), true, true],
      [config.usdcMint.toBase58(), false, false],
      [userUsdc.toBase58(), true, false],
      [lockCollateral.toBase58(), true, false],
      [config.kaminoProgram.toBase58(), false, false],
      [config.kaminoReserve.toBase58(), true, false],
      [config.kaminoMarket.toBase58(), false, false],
      [config.kaminoLma.toBase58(), false, false],
      [config.kaminoLiquiditySupply.toBase58(), true, false],
      [config.collateralMint.toBase58(), true, false],
      [TOKEN_PROGRAM_ID.toBase58(), false, false],
      [SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(), false, false],
    ]);
  });

  it('claim_v2: [cu_limit, cu_price, create_ata_idempotent, ed25519, claim] with 19 keys in the proven order (devnet/mock: no refresh)', async () => {
    const config = syntheticConfig(v2);
    const lock = await v2.deriveLockPda(OWNER.toBase58(), 'test-kitchen');
    const voucher = {
      lock: lock.toBase58(),
      authorityPubkey: Keypair.generate().publicKey.toBase58(),
      bps: 10_000,
      expiry: 1_893_456_000,
      message: Buffer.alloc(91).toString('base64'),
      signature: Buffer.alloc(64).toString('base64'),
    };
    const tx = await v2.buildClaimTransaction(OWNER.toBase58(), 'test-kitchen', voucher, config);
    expect(tx.instructions).toHaveLength(5);
    // ix0/ix1 = compute budget (unit limit, unit price), ix2 =
    // create-ATA-idempotent for the owner's USDC account (the program declares
    // owner_usdc `mut` and never creates it, so a user who closed it could
    // otherwise never claim), ix3 = ed25519 precompile, ix4 = claim (mock
    // reserve → no refresh_reserve). verify_voucher scans all ixs, so ed25519
    // position is flexible; claim stays last.
    expect(tx.instructions[0].programId.toBase58()).toBe(
      'ComputeBudget111111111111111111111111111111',
    );
    expect(tx.instructions[1].programId.toBase58()).toBe(
      'ComputeBudget111111111111111111111111111111',
    );
    expect(tx.instructions[2].programId.toBase58()).toBe(
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    );
    expect(tx.instructions[3].programId.toBase58()).toBe(
      'Ed25519SigVerify111111111111111111111111111',
    );
    const lockLiquidity = getAssociatedTokenAddressSync(config.usdcMint, lock, true);
    const lockCollateral = getAssociatedTokenAddressSync(config.collateralMint, lock, true);
    const userUsdc = getAssociatedTokenAddressSync(config.usdcMint, OWNER);
    expect(meta(tx.instructions[4])).toEqual([
      [config.configAddress.toBase58(), true, false],
      [lock.toBase58(), true, false],
      [OWNER.toBase58(), true, true],
      [config.usdcMint.toBase58(), false, false],
      [userUsdc.toBase58(), true, false],
      [lockLiquidity.toBase58(), true, false],
      [lockCollateral.toBase58(), true, false],
      [config.potVault.toBase58(), true, false],
      [config.feeVault.toBase58(), true, false],
      [config.kaminoProgram.toBase58(), false, false],
      [config.kaminoReserve.toBase58(), true, false],
      [config.kaminoMarket.toBase58(), false, false],
      [config.kaminoLma.toBase58(), false, false],
      [config.kaminoLiquiditySupply.toBase58(), true, false],
      [config.collateralMint.toBase58(), true, false],
      [TOKEN_PROGRAM_ID.toBase58(), false, false],
      [SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(), false, false],
      [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), false, false],
      [SystemProgram.programId.toBase58(), false, false],
    ]);
  });

  it('real klend: deposit + claim inject refresh_reserve; devnet mock does not', async () => {
    const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
    const SCOPE = '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH';
    const config = { ...syntheticConfig(v2), kaminoProgram: new PublicKey(KLEND) };

    const dep = await v2.buildDepositTransaction(OWNER.toBase58(), 'test-kitchen', 25_000_000n, config);
    // [cu_limit, cu_price, refresh_reserve, lock_funds]
    expect(dep.instructions).toHaveLength(4);
    const refresh = dep.instructions[2];
    expect(refresh.programId.toBase58()).toBe(KLEND);
    expect(refresh.data).toEqual(Buffer.from([2, 218, 138, 235, 79, 201, 25, 102]));
    expect(refresh.keys).toHaveLength(6);
    // reserve(writable), market, pyth=KLEND, sbPrice=KLEND, sbTwap=KLEND, scope
    expect(meta(refresh)).toEqual([
      [config.kaminoReserve.toBase58(), true, false],
      [config.kaminoMarket.toBase58(), false, false],
      [KLEND, false, false],
      [KLEND, false, false],
      [KLEND, false, false],
      [SCOPE, false, false],
    ]);

    const voucher = {
      lock: (await v2.deriveLockPda(OWNER.toBase58(), 'test-kitchen')).toBase58(),
      authorityPubkey: Keypair.generate().publicKey.toBase58(),
      bps: 10_000,
      expiry: 1_893_456_000,
      message: Buffer.alloc(91).toString('base64'),
      signature: Buffer.alloc(64).toString('base64'),
    };
    const claim = await v2.buildClaimTransaction(OWNER.toBase58(), 'test-kitchen', voucher, config);
    // [cu_limit, cu_price, create_ata_idempotent, refresh_reserve, ed25519,
    // claim] — refresh_reserve still precedes the redeem CPI, which is the
    // ordering the surfpool mainnet fork proved.
    expect(claim.instructions).toHaveLength(6);
    expect(claim.instructions[2].programId.toBase58()).toBe(
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    );
    expect(claim.instructions[3].programId.toBase58()).toBe(KLEND);
    expect(claim.instructions[4].programId.toBase58()).toBe('Ed25519SigVerify111111111111111111111111111');
  });

  // Every money tx must bid a priority fee: at 0 micro-lamports the Kamino-CPI
  // deposits/claims are the first thing mainnet leaders drop under congestion.
  describe('priority fee', () => {
    // SetComputeUnitPrice = discriminant 3 || u64 LE micro-lamports.
    const priceOf = (ix: { programId: PublicKey; data: Buffer }) => {
      expect(ix.programId.toBase58()).toBe('ComputeBudget111111111111111111111111111111');
      expect(ix.data[0]).toBe(3);
      return Number(Buffer.from(ix.data).readBigUInt64LE(1));
    };
    const fees = (...vals: number[]) =>
      vals.map((prioritizationFee, slot) => ({ slot, prioritizationFee }));

    it('prices deposits from the recent-fee window, sampled over its writable accounts', async () => {
      getRecentPrioritizationFees.mockResolvedValue(fees(0, 50_000, 60_000, 200_000));
      const config = syntheticConfig(v2);
      const tx = await v2.buildDepositTransaction(OWNER.toBase58(), 'test-kitchen', 10_000_000n, config);
      // p75 of the non-zero samples [50k, 60k, 200k].
      expect(priceOf(tx.instructions[1])).toBe(200_000);

      const asked = getRecentPrioritizationFees.mock.calls[0][0] as {
        lockedWritableAccounts: PublicKey[];
      };
      const writable = asked.lockedWritableAccounts.map((k) => k.toBase58());
      expect(writable).toContain(config.kaminoReserve.toBase58());
      expect(writable).not.toContain(TOKEN_PROGRAM_ID.toBase58());
    });

    it('prices claims too, clamped to the ceiling when the network is spiking', async () => {
      getRecentPrioritizationFees.mockResolvedValue(fees(50_000_000, 90_000_000));
      const config = syntheticConfig(v2);
      const lock = await v2.deriveLockPda(OWNER.toBase58(), 'test-kitchen');
      const voucher = {
        lock: lock.toBase58(),
        authorityPubkey: Keypair.generate().publicKey.toBase58(),
        bps: 10_000,
        expiry: 1_893_456_000,
        message: Buffer.alloc(91).toString('base64'),
        signature: Buffer.alloc(64).toString('base64'),
      };
      const tx = await v2.buildClaimTransaction(OWNER.toBase58(), 'test-kitchen', voucher, config);
      expect(priceOf(tx.instructions[1])).toBe(1_000_000);
    });

    it('falls back to the floor when the RPC has no samples or rejects', async () => {
      const config = syntheticConfig(v2);
      getRecentPrioritizationFees.mockResolvedValue([]);
      const quiet = await v2.buildDepositTransaction(OWNER.toBase58(), 'test-kitchen', 1n, config);
      expect(priceOf(quiet.instructions[1])).toBe(10_000);

      getRecentPrioritizationFees.mockRejectedValue(new Error('429 rate limited'));
      const broken = await v2.buildDepositTransaction(OWNER.toBase58(), 'test-kitchen', 1n, config);
      expect(priceOf(broken.instructions[1])).toBe(10_000);
    });
  });

  it('rejects a voucher whose lock does not match the derived PDA', async () => {
    const config = syntheticConfig(v2);
    const voucher = {
      lock: Keypair.generate().publicKey.toBase58(), // wrong lock
      authorityPubkey: Keypair.generate().publicKey.toBase58(),
      bps: 10_000,
      expiry: 1_893_456_000,
      message: Buffer.alloc(91).toString('base64'),
      signature: Buffer.alloc(64).toString('base64'),
    };
    await expect(
      v2.buildClaimTransaction(OWNER.toBase58(), 'test-kitchen', voucher, config),
    ).rejects.toThrow('Voucher lock does not match');
  });
});
