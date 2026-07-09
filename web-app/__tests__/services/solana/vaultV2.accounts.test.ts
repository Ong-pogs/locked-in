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

vi.mock('@/services/solana/connection', () => ({
  connection: { getAccountInfo: vi.fn().mockResolvedValue(null) },
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

  it('lock_funds_v2: [compute_budget, deposit] with 14 keys in the proven order', async () => {
    const config = syntheticConfig(v2);
    const tx = await v2.buildDepositTransaction(OWNER.toBase58(), 'test-kitchen', 10_000_000n, config);
    expect(tx.instructions).toHaveLength(2); // compute budget + deposit
    const lock = await v2.deriveLockPda(OWNER.toBase58(), 'test-kitchen');
    const lockCollateral = getAssociatedTokenAddressSync(config.collateralMint, lock, true);
    const userUsdc = getAssociatedTokenAddressSync(config.usdcMint, OWNER);
    expect(meta(tx.instructions[1])).toEqual([
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

  it('claim_v2: [ed25519, compute_budget, claim] with 19 keys in the proven order', async () => {
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
    expect(tx.instructions).toHaveLength(3);
    // ix0 = ed25519 precompile, ix1 = compute budget, ix2 = claim
    expect(tx.instructions[0].programId.toBase58()).toBe(
      'Ed25519SigVerify111111111111111111111111111',
    );
    const lockLiquidity = getAssociatedTokenAddressSync(config.usdcMint, lock, true);
    const lockCollateral = getAssociatedTokenAddressSync(config.collateralMint, lock, true);
    const userUsdc = getAssociatedTokenAddressSync(config.usdcMint, OWNER);
    expect(meta(tx.instructions[2])).toEqual([
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
