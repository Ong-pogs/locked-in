// Adversarial cross-check: a voucher produced by src/lib/claimVoucher.mjs must
// verify on-chain through the deployed program's claim_v2. Fresh lock ->
// deposit -> BACKEND-signed voucher -> claim. If claim confirms, backend and
// on-chain agree byte-for-byte.
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, SystemProgram, Ed25519Program, ComputeBudgetProgram, SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID, getAccount,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { issueVoucher, deriveLockPda } from '../src/lib/claimVoucher.mjs';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM = new PublicKey('EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN');
const MOCK = new PublicKey('3kqzsQV7Ab8aakkNugM9aXBqQrgwnshF6a47HxJcfLtp');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const m = (pubkey, w, s = false) => ({ pubkey, isSigner: s, isWritable: w });
const load = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));

const conn = new Connection(RPC, 'confirmed');
const deployer = load(homedir() + '/.config/solana/id.json'); // = vault authority (voucher signer)
const user = load('/Users/ongeeshen/Project/locked-in/.e2e/devnet-e2e.json');

const [config] = PublicKey.findProgramAddressSync([Buffer.from('vault-v2b')], PROGRAM);
const [mockReserve] = PublicKey.findProgramAddressSync([Buffer.from('reserve'), USDC.toBuffer()], MOCK);
const [mockAuth] = PublicKey.findProgramAddressSync([Buffer.from('authority'), USDC.toBuffer()], MOCK);
const [mockCtoken] = PublicKey.findProgramAddressSync([Buffer.from('ctoken'), USDC.toBuffer()], MOCK);
const mockVault = getAssociatedTokenAddressSync(USDC, mockAuth, true);
const potVault = getAssociatedTokenAddressSync(USDC, deployer.publicKey);
const userUsdc = getAssociatedTokenAddressSync(USDC, user.publicKey);

const courseHash = createHash('sha256').update('backend-voucher-crosscheck').digest();
const lock = deriveLockPda(PROGRAM, user.publicKey, courseHash); // lib-derived PDA
const lockLiquidity = getAssociatedTokenAddressSync(USDC, lock, true);
const lockCollateral = getAssociatedTokenAddressSync(mockCtoken, lock, true);
console.log('lock (lib-derived):', lock.toBase58());

// open + deposit if lock not already ACTIVE.
const lockAcc = await conn.getAccountInfo(lock);
const status = lockAcc ? lockAcc.data[8 + 32 + 32 + 8 + 8] : null;
if (status !== 0) {
  if (!lockAcc) {
    await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
      programId: PROGRAM,
      keys: [m(config, false), m(lock, true), m(user.publicKey, true, true), m(mockCtoken, false),
        m(lockCollateral, true), m(TOKEN_PROGRAM_ID, false), m(ASSOCIATED_TOKEN_PROGRAM_ID, false), m(SystemProgram.programId, false)],
      data: Buffer.concat([disc('open_lock_v2'), courseHash]),
    })), [user], { commitment: 'confirmed' });
    console.log('opened lock');
  }
  await sendAndConfirmTransaction(conn, new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(new TransactionInstruction({
      programId: PROGRAM,
      keys: [m(config, true), m(lock, true), m(user.publicKey, true, true), m(USDC, false), m(userUsdc, true),
        m(lockCollateral, true), m(MOCK, false), m(mockReserve, true), m(SystemProgram.programId, false),
        m(mockAuth, false), m(mockVault, true), m(mockCtoken, true), m(TOKEN_PROGRAM_ID, false), m(SYSVAR_INSTRUCTIONS_PUBKEY, false)],
      data: Buffer.concat([disc('lock_funds_v2'), courseHash, u64(2_000_000)]),
    })), [user], { commitment: 'confirmed' });
  console.log('deposited 2 USDC');
}

// === THE CROSS-CHECK: sign the voucher with the BACKEND LIB ===
const voucher = issueVoucher({
  programId: PROGRAM.toBase58(),
  authoritySecretKey: bs58.encode(deployer.secretKey),
  owner: user.publicKey.toBase58(),
  courseIdHash: courseHash,
  lapseCount: 0, // -> bps 10000
  expiry: 1893456000,
});
console.log('backend voucher: bps', voucher.bps, '| authority', voucher.authorityPubkey);
if (voucher.lock !== lock.toBase58()) throw new Error('lib PDA mismatch');

// Build the Ed25519 precompile ix from the LIB's message + signature (not from the raw key).
const edIx = Ed25519Program.createInstructionWithPublicKey({
  publicKey: new PublicKey(voucher.authorityPubkey).toBytes(),
  message: Buffer.from(voucher.message, 'base64'),
  signature: Buffer.from(voucher.signature, 'base64'),
});

const claimIx = new TransactionInstruction({
  programId: PROGRAM,
  keys: [m(config, true), m(lock, true), m(user.publicKey, true, true), m(USDC, false), m(userUsdc, true),
    m(lockLiquidity, true), m(lockCollateral, true), m(potVault, true), m(potVault, true),
    m(MOCK, false), m(mockReserve, true), m(SystemProgram.programId, false), m(mockAuth, false),
    m(mockVault, true), m(mockCtoken, true), m(TOKEN_PROGRAM_ID, false), m(SYSVAR_INSTRUCTIONS_PUBKEY, false),
    m(ASSOCIATED_TOKEN_PROGRAM_ID, false), m(SystemProgram.programId, false)],
  data: Buffer.concat([disc('claim_v2'), u16(voucher.bps), i64(voucher.expiry)]),
});

const before = Number((await getAccount(conn, userUsdc)).amount);
const sig = await sendAndConfirmTransaction(conn,
  new Transaction().add(edIx).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })).add(claimIx),
  [user], { commitment: 'confirmed' });
const after = Number((await getAccount(conn, userUsdc)).amount);
console.log('\n✅ CLAIM WITH BACKEND-SIGNED VOUCHER CONFIRMED:', sig);
console.log('user USDC', before / 1e6, '->', after / 1e6, '(principal returned)');
console.log('BACKEND VOUCHER LIB VERIFIED ON-CHAIN — byte-for-byte agreement with voucher.rs.');
