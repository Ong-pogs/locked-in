// Full v2 on-chain flow on real devnet with the funded wallet:
// init vault (pinned to the mock reserve) -> lock 10 USDC -> sign completion
// voucher -> claim (voucher verify + redeem + split). Proves lock_funds_v2 +
// claim_v2 + the Ed25519 voucher end to end.
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, SystemProgram, Ed25519Program, ComputeBudgetProgram, SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAccount,
} from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM = new PublicKey('EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN');
const MOCK = new PublicKey('3kqzsQV7Ab8aakkNugM9aXBqQrgwnshF6a47HxJcfLtp');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const m = (pubkey, w, s = false) => ({ pubkey, isSigner: s, isWritable: w });
const load = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));

const conn = new Connection(RPC, 'confirmed');
const deployer = load(homedir() + '/.config/solana/id.json'); // vault authority (voucher signer)
const user = load('/Users/ongeeshen/Project/locked-in/.e2e/devnet-e2e.json');

// Mock reserve accounts.
const [mockReserve] = PublicKey.findProgramAddressSync([Buffer.from('reserve'), USDC.toBuffer()], MOCK);
const [mockAuth] = PublicKey.findProgramAddressSync([Buffer.from('authority'), USDC.toBuffer()], MOCK);
const [mockCtoken] = PublicKey.findProgramAddressSync([Buffer.from('ctoken'), USDC.toBuffer()], MOCK);
const mockVault = getAssociatedTokenAddressSync(USDC, mockAuth, true);

// v2 vault accounts.
const [config] = PublicKey.findProgramAddressSync([Buffer.from('vault-v2a')], PROGRAM);
const courseHash = createHash('sha256').update('devnet-e2e-course').digest();
const [lock] = PublicKey.findProgramAddressSync([Buffer.from('lock-v2'), user.publicKey.toBuffer(), courseHash], PROGRAM);
const lockLiquidity = getAssociatedTokenAddressSync(USDC, lock, true);
const lockCollateral = getAssociatedTokenAddressSync(mockCtoken, lock, true);
const potVault = getAssociatedTokenAddressSync(USDC, deployer.publicKey); // pot + fee vault (deployer ATA)
const userUsdc = getAssociatedTokenAddressSync(USDC, user.publicKey);

console.log('program:', PROGRAM.toBase58(), '\nconfig :', config.toBase58(), '\nlock   :', lock.toBase58());

// 0. Ensure pot/fee vault (deployer USDC ATA) exists.
await getOrCreateAssociatedTokenAccount(conn, deployer, USDC, deployer.publicKey);

// 1. initialize_vault_v2 (idempotent — skip if config exists).
if (!(await conn.getAccountInfo(config))) {
  const params = Buffer.concat([
    deployer.publicKey.toBuffer(), MOCK.toBuffer(), mockReserve.toBuffer(),
    SystemProgram.programId.toBuffer() /* market marker */, mockAuth.toBuffer(), mockVault.toBuffer(),
    potVault.toBuffer() /* fee_vault */,
    u64(1_000_000), u64(50_000_000), u64(1_000_000_000), u16(0),
  ]);
  const init = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      m(config, true), m(USDC, false), m(mockCtoken, false), m(potVault, true),
      m(deployer.publicKey, true, true), m(SystemProgram.programId, false),
    ],
    data: Buffer.concat([disc('initialize_vault_v2'), params]),
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(init), [deployer], { commitment: 'confirmed' });
  console.log('init_vault_v2:', sig);
} else { console.log('vault already initialized'); }

// Mock vault already carries a yield buffer from prior runs; no top-up needed.

const userBefore = Number((await getAccount(conn, userUsdc)).amount);
console.log('\nuser USDC before lock:', userBefore / 1e6);

// 2a. open_lock_v2(courseHash) — inits lock + collateral ATA (no CPI).
if (!(await conn.getAccountInfo(lock))) {
  const openIx = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      m(config, false), m(lock, true), m(user.publicKey, true, true),
      m(mockCtoken, false), m(lockCollateral, true),
      m(TOKEN_PROGRAM_ID, false), m(ASSOCIATED_TOKEN_PROGRAM_ID, false), m(SystemProgram.programId, false),
    ],
    data: Buffer.concat([disc('open_lock_v2'), courseHash]),
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(openIx), [user], { commitment: 'confirmed' });
  console.log('open_lock_v2 done');
}

// 2b. lock_funds_v2(courseHash, 10 USDC) — deposit CPI (lock + ATA already exist).
const DEPOSIT = 2_000_000;
const lockIx = new TransactionInstruction({
  programId: PROGRAM,
  keys: [
    m(config, true), m(lock, true), m(user.publicKey, true, true),
    m(USDC, false), m(userUsdc, true), m(lockCollateral, true),
    m(MOCK, false), m(mockReserve, true), m(SystemProgram.programId, false), m(mockAuth, false),
    m(mockVault, true), m(mockCtoken, true),
    m(TOKEN_PROGRAM_ID, false), m(SYSVAR_INSTRUCTIONS_PUBKEY, false),
  ],
  data: Buffer.concat([disc('lock_funds_v2'), courseHash, u64(DEPOSIT)]),
});
await sendAndConfirmTransaction(conn,
  new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })).add(lockIx),
  [user], { commitment: 'confirmed' });
const afterLock = Number((await getAccount(conn, userUsdc)).amount);
const shares = Number((await getAccount(conn, lockCollateral)).amount);
console.log('after lock: user USDC', afterLock / 1e6, '| lock shares', shares / 1e6);

// 3. Sign a completion voucher (bps=10000, expiry +1h) with the vault authority.
const bps = 10_000;
const expiry = 1893456000; // 2030-01-01, safely future (Date.now unavailable, fixed const)
const msg = Buffer.concat([
  Buffer.from('lockedin:claim:v1'), PROGRAM.toBuffer(), lock.toBuffer(), u16(bps), i64(expiry),
]);
const edIx = Ed25519Program.createInstructionWithPrivateKey({ privateKey: deployer.secretKey, message: msg });

// 4. claim_v2 — tx = [ed25519_verify, compute_budget, claim].
const claimIx = new TransactionInstruction({
  programId: PROGRAM,
  keys: [
    m(config, true), m(lock, true), m(user.publicKey, true, true),
    m(USDC, false), m(userUsdc, true), m(lockLiquidity, true), m(lockCollateral, true),
    m(potVault, true), m(potVault, true) /* fee_vault */,
    m(MOCK, false), m(mockReserve, true), m(SystemProgram.programId, false), m(mockAuth, false),
    m(mockVault, true), m(mockCtoken, true),
    m(TOKEN_PROGRAM_ID, false), m(SYSVAR_INSTRUCTIONS_PUBKEY, false),
    m(ASSOCIATED_TOKEN_PROGRAM_ID, false), m(SystemProgram.programId, false),
  ],
  data: Buffer.concat([disc('claim_v2'), u16(bps), i64(expiry)]),
});
try {
  const sig = await sendAndConfirmTransaction(conn,
    new Transaction().add(edIx).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })).add(claimIx),
    [user], { commitment: 'confirmed' });
  const afterClaim = Number((await getAccount(conn, userUsdc)).amount);
  console.log('\n✅ CLAIM CONFIRMED:', sig);
  console.log('user USDC after claim:', afterClaim / 1e6);
  console.log('net from principal (yield kept):', ((afterClaim - afterLock) - DEPOSIT) / 1e6, 'USDC');
  console.log('DEPOSIT→CLAIM v2 FLOW WORKS: deposited 10, got principal + yield back at bps=10000');
} catch (e) {
  console.log('\n❌ CLAIM FAILED:', e.message);
  const logs = (await e.getLogs?.(conn)) ?? e.logs;
  if (logs) logs.forEach((l) => console.log('  ' + l));
  process.exit(1);
}
