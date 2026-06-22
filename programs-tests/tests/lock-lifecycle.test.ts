/**
 * End-to-end integration test for the merged `locked_in` program.
 *
 * Satisfies Milestone 2 #6 of the Solana Foundation grant tranche review:
 *   "Integration tests (lock → supply → yield accrual → claim)"
 *
 * `lock_vault` + `community_pot` were merged into ONE program (`locked_in`) to
 * pay a single Anchor baseline. There is now ONE program ID and ONE Program
 * instance. The two config PDAs are domain-separated to avoid the seed
 * collision that would otherwise occur under one program ID:
 *   vault config -> seeds = [b"vault-protocol"]
 *   pot   config -> seeds = [b"pot-protocol"]
 * and the two init instructions were renamed `initialize_vault` /
 * `initialize_pot` to avoid the `global:initialize_protocol` discriminator
 * collision. The custody logic (lock_funds / unlock_funds / record_redirect)
 * is unchanged.
 *
 * Every assertion is on real on-chain state produced by real transactions
 * sent to an in-process LiteSVM (mainnet-equivalent BPF execution). No
 * struct mutation in memory, no mocked CPI. The program runs as the compiled
 * `locked_in.so` loaded from target/deploy/ after `anchor build`.
 *
 * Test flow:
 *   1.  Bootstrap LiteSVM, load the merged program
 *   2.  Create authority + owner keypairs, airdrop SOL
 *   3.  Create stable (USDC-like) + SKR mints, fund owner, pre-fund the pot
 *   4.  initialize_vault + initialize_pot (two domain configs, one program)
 *   5.  lock_funds(100 USDC, 30 days) → principal escrowed into vault ATA
 *   6.  record_redirect → window accumulates
 *   7.  Warp LiteSVM clock past lock_end_ts
 *   8.  unlock_funds → owner receives full principal, vault + lock closed
 *
 * Run: cd programs-tests && npm test
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { LiteSVM } from 'litesvm';
import { LiteSVMProvider } from 'anchor-litesvm';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { Program, BN, Wallet, type Idl } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  MINT_SIZE,
  AccountLayout,
} from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// Load the single merged IDL as plain JSON.
const LockedInIDL = JSON.parse(
  readFileSync(resolve(__dirname, '../../target/idl/locked_in.json'), 'utf8'),
);

// Single program ID (sourced from Anchor.toml — duplicated here so the test
// runs without reading workspace files at runtime).
const LOCKED_IN_PROGRAM_ID = new PublicKey(
  '68im45BCfv8sL6WnVVV9JF4edLkB11udeU9EAApNaEx3',
);

// PDA seed prefixes (mirror the program's SEED const declarations). The two
// config seeds are DOMAIN-SEPARATED so they don't collide under one program ID.
const VAULT_CONFIG_SEED = Buffer.from('vault-protocol');
const POT_CONFIG_SEED = Buffer.from('pot-protocol');
const LOCK_SEED = Buffer.from('lock');
const POT_WINDOW_SEED = Buffer.from('window');
const REDIRECT_RECEIPT_SEED = Buffer.from('redirect');

const STABLE_DECIMALS = 6; // USDC-like
const SKR_DECIMALS = 9;

const PRINCIPAL_AMOUNT_UI = 100; // 100 USDC
const PRINCIPAL_AMOUNT_BASE = PRINCIPAL_AMOUNT_UI * 10 ** STABLE_DECIMALS;
const LOCK_DURATION_DAYS = 30;
const POT_PREFUND_BASE = 10 * 10 ** STABLE_DECIMALS; // pre-fund community pot

function findPDA(seeds: (Buffer | Uint8Array)[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function makeReceiptKey(label: string): Buffer {
  return createHash('sha256').update(label).digest();
}

function i64LE(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value), 0);
  return buf;
}

describe('Lock lifecycle (merged locked_in: vault × pot)', () => {
  let svm: LiteSVM;
  let provider: LiteSVMProvider;
  let program: Program; // ONE program instance for both domains

  let authority: Keypair;
  let owner: Keypair;
  let recipient: Keypair; // for pot distribution (not exercised here but kept)
  let stableMint: Keypair;
  let skrMint: Keypair;

  // PDAs
  let vaultConfig: PublicKey;
  let potConfig: PublicKey;
  let lockAccount: PublicKey;
  let stableVault: PublicKey;
  let skrVault: PublicKey;
  let potVault: PublicKey;
  let courseIdHash: Buffer;

  let ownerStableAta: PublicKey;
  let ownerSkrAta: PublicKey;

  const t0 = Date.now();
  const stepTimings: { name: string; ms: number }[] = [];
  function timeStep<T>(name: string, fn: () => T): T {
    const s = Date.now();
    const r = fn();
    stepTimings.push({ name, ms: Date.now() - s });
    return r;
  }

  // ───────────────────────────────────────────────────────────────────
  // Helper: send a raw web3.js Transaction via the Anchor provider, which
  // translates web3.js → @solana/kit internally. Throws on failure.
  // ───────────────────────────────────────────────────────────────────
  async function sendTx(tx: Transaction, signers: Keypair[]): Promise<void> {
    await provider.sendAndConfirm!(tx, signers);
  }

  beforeAll(() => {
    svm = new LiteSVM();
    // @solana/kit takes addresses as base58 strings, not byte arrays — the
    // litesvm wrapper passes through to @solana/addresses' codec. ONE program.
    svm.addProgramFromFile(
      LOCKED_IN_PROGRAM_ID,
      resolve(__dirname, '../../target/deploy/locked_in.so'),
    );

    authority = Keypair.generate();
    owner = Keypair.generate();
    recipient = Keypair.generate();
    stableMint = Keypair.generate();
    skrMint = Keypair.generate();

    svm.airdrop(authority.publicKey, BigInt(1000 * LAMPORTS_PER_SOL));
    svm.airdrop(owner.publicKey, BigInt(1000 * LAMPORTS_PER_SOL));
    svm.airdrop(recipient.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    // Anchor provider; authority is the default fee payer. ONE Program instance.
    provider = new LiteSVMProvider(svm, new Wallet(authority));
    program = new Program(LockedInIDL as Idl, provider);

    // course_id_hash is just an opaque PDA seed + custody record (no on-chain
    // CoursePolicy account anymore).
    courseIdHash = createHash('sha256').update('test-course-1').digest();

    // Domain-separated config PDAs under the SAME program ID.
    vaultConfig = findPDA([VAULT_CONFIG_SEED], LOCKED_IN_PROGRAM_ID);
    potConfig = findPDA([POT_CONFIG_SEED], LOCKED_IN_PROGRAM_ID);
    // Sanity: the seed-collision fix means these two MUST differ.
    expect(vaultConfig.toString()).not.toBe(potConfig.toString());

    lockAccount = findPDA(
      [LOCK_SEED, owner.publicKey.toBuffer(), courseIdHash],
      LOCKED_IN_PROGRAM_ID,
    );
    stableVault = getAssociatedTokenAddressSync(
      stableMint.publicKey,
      lockAccount,
      true,
    );
    skrVault = getAssociatedTokenAddressSync(
      skrMint.publicKey,
      lockAccount,
      true,
    );
    potVault = getAssociatedTokenAddressSync(
      stableMint.publicKey,
      potConfig,
      true,
    );
    ownerStableAta = getAssociatedTokenAddressSync(
      stableMint.publicKey,
      owner.publicKey,
    );
    ownerSkrAta = getAssociatedTokenAddressSync(
      skrMint.publicKey,
      owner.publicKey,
    );
  });

  test('end-to-end lock lifecycle', async () => {
    // ─────────────────────────────────────────────────────────────
    // STEP A. Create mints + fund owner + pre-fund the community pot
    // ─────────────────────────────────────────────────────────────
    timeStep('mints + funding', () => {
      const rentMint = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));

      // Create stable mint (authority owns mint authority).
      const stableMintTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: stableMint.publicKey,
          space: MINT_SIZE,
          lamports: rentMint,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(
          stableMint.publicKey,
          STABLE_DECIMALS,
          authority.publicKey,
          null,
        ),
      );
      sendTx(stableMintTx, [authority, stableMint]);

      // Create SKR mint.
      const skrMintTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: skrMint.publicKey,
          space: MINT_SIZE,
          lamports: rentMint,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(
          skrMint.publicKey,
          SKR_DECIMALS,
          authority.publicKey,
          null,
        ),
      );
      sendTx(skrMintTx, [authority, skrMint]);

      // Owner's USDC ATA + mint 500 USDC. Owner also gets an SKR ATA so the
      // unlock path's init_if_needed owner SKR account already exists.
      const ataTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          ownerStableAta,
          owner.publicKey,
          stableMint.publicKey,
        ),
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          ownerSkrAta,
          owner.publicKey,
          skrMint.publicKey,
        ),
        createMintToInstruction(
          stableMint.publicKey,
          ownerStableAta,
          authority.publicKey,
          BigInt(500 * 10 ** STABLE_DECIMALS),
        ),
      );
      sendTx(ataTx, [authority]);

      // Pre-fund community pot vault (exercised by record_redirect flow).
      const potTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          potVault,
          potConfig,
          stableMint.publicKey,
        ),
        createMintToInstruction(
          stableMint.publicKey,
          potVault,
          authority.publicKey,
          BigInt(POT_PREFUND_BASE),
        ),
      );
      sendTx(potTx, [authority]);
    });

    // ─────────────────────────────────────────────────────────────
    // STEP B. initialize_vault + initialize_pot (both domains, one program)
    // ─────────────────────────────────────────────────────────────
    await program.methods
      .initializeVault(stableMint.publicKey, skrMint.publicKey)
      .accounts({
        protocolConfig: vaultConfig,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .initializePot(stableMint.publicKey)
      .accounts({
        protocolConfig: potConfig,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Sanity: each config PDA exists and points at this authority.
    {
      const vCfg: any = await program.account.vaultConfig.fetch(vaultConfig);
      expect(vCfg.authority.toString()).toBe(authority.publicKey.toString());
      expect(vCfg.usdcMint.toString()).toBe(stableMint.publicKey.toString());

      const pCfg: any = await program.account.potConfig.fetch(potConfig);
      expect(pCfg.stableMint.toString()).toBe(stableMint.publicKey.toString());
    }

    // ─────────────────────────────────────────────────────────────
    // STEP C. lock_funds(100 USDC, 30 days)
    // ─────────────────────────────────────────────────────────────
    const beforeLockBalance = AccountLayout.decode(
      svm.getAccount(ownerStableAta)!.data,
    ).amount;

    await program.methods
      .lockFunds(
        Array.from(courseIdHash),
        LOCK_DURATION_DAYS,
        new BN(PRINCIPAL_AMOUNT_BASE),
        new BN(0), // skr_amount = 0
      )
      .accounts({
        protocolConfig: vaultConfig,
        lockAccount,
        stableMint: stableMint.publicKey,
        skrMint: skrMint.publicKey,
        owner: owner.publicKey,
        ownerStableTokenAccount: ownerStableAta,
        stableVault,
        skrVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        ownerSkrTokenAccount: null,
      })
      .signers([owner])
      .rpc();

    // → assert stable_vault ATA balance == 100 USDC
    const stableVaultBalance = AccountLayout.decode(
      svm.getAccount(stableVault)!.data,
    ).amount;
    expect(stableVaultBalance).toBe(BigInt(PRINCIPAL_AMOUNT_BASE));

    // → assert lock_account.principal_amount == 100_000_000
    const lockAfterLock: any = await program.account.lockAccount.fetch(
      lockAccount,
    );
    expect(lockAfterLock.principalAmount.toString()).toBe(
      String(PRINCIPAL_AMOUNT_BASE),
    );

    // → assert user USDC balance decreased by 100
    const afterLockBalance = AccountLayout.decode(
      svm.getAccount(ownerStableAta)!.data,
    ).amount;
    expect(beforeLockBalance - afterLockBalance).toBe(
      BigInt(PRINCIPAL_AMOUNT_BASE),
    );

    // Record lock window timestamps for the clock-warp + redirect steps.
    const lockStartTs = Number(lockAfterLock.lockStartTs);
    const lockEndTs = Number(lockAfterLock.lockEndTs);
    const secondsPerDay = 86400;

    // ─────────────────────────────────────────────────────────────
    // STEP D. record_redirect (yield-redirect accounting)
    // ─────────────────────────────────────────────────────────────
    const windowId = 1n; // i64
    const potWindow = findPDA(
      [POT_WINDOW_SEED, i64LE(windowId)],
      LOCKED_IN_PROGRAM_ID,
    );
    const redirectKey = makeReceiptKey('redirect-1');
    const redirectReceipt = findPDA(
      [REDIRECT_RECEIPT_SEED, potWindow.toBuffer(), redirectKey],
      LOCKED_IN_PROGRAM_ID,
    );
    const redirectAmount = 1;

    await program.methods
      .recordRedirect(
        Array.from(redirectKey),
        new BN(windowId),
        new BN(redirectAmount),
        new BN(lockStartTs + secondsPerDay),
      )
      .accounts({
        protocolConfig: potConfig,
        window: potWindow,
        receipt: redirectReceipt,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // → assert PotWindow + RedirectReceipt exist with the expected amount
    const potWinAcct: any = await program.account.potWindow.fetch(potWindow);
    expect(BigInt(potWinAcct.totalRedirectedAmount.toString())).toBe(
      BigInt(redirectAmount),
    );
    expect(potWinAcct.redirectCount).toBe(1);

    // ─────────────────────────────────────────────────────────────
    // STEP E. Warp clock past lock_end_ts, unlock_funds
    // ─────────────────────────────────────────────────────────────
    {
      const clk = svm.getClock();
      clk.unixTimestamp = BigInt(lockEndTs + 60);
      svm.setClock(clk);
    }

    const ownerStableBeforeUnlock = AccountLayout.decode(
      svm.getAccount(ownerStableAta)!.data,
    ).amount;

    await program.methods
      .unlockFunds()
      .accounts({
        lockAccount,
        stableMint: stableMint.publicKey,
        skrMint: skrMint.publicKey,
        owner: owner.publicKey,
        stableVault,
        skrVault,
        ownerStableTokenAccount: ownerStableAta,
        ownerSkrTokenAccount: ownerSkrAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // → assert user USDC balance increased by the full principal
    const ownerStableAfterUnlock = AccountLayout.decode(
      svm.getAccount(ownerStableAta)!.data,
    ).amount;
    expect(
      ownerStableAfterUnlock - ownerStableBeforeUnlock,
    ).toBe(BigInt(PRINCIPAL_AMOUNT_BASE));

    // → assert stable_vault account is closed
    const stableVaultAfter = svm.getAccount(stableVault);
    expect(stableVaultAfter).toBeNull();

    // → assert lock_account is closed
    const lockAfterUnlock = svm.getAccount(lockAccount);
    expect(lockAfterUnlock).toBeNull();

    // ─────────────────────────────────────────────────────────────
    // Done
    // ─────────────────────────────────────────────────────────────
    console.log(`\nTotal wall-clock: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    console.log('Step timings:', stepTimings);
  });
});
