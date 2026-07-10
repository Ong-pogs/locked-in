// Live PROD smoke test of the v2 backend path, driven by a real funded devnet
// wallet + real wallet-signature auth (no browser/Privy needed). Proves the
// deployed enroll/eligibility/position/voucher endpoints work end-to-end
// against devnet RPC from Render, so a browser failure is isolated to the UI.
//
// Flow: on-chain deposit into a REAL course lock -> prod auth -> enroll ->
// position (ACTIVE) -> eligibility (lockable) -> voucher (403, not complete).
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, SystemProgram, ComputeBudgetProgram, SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAccount,
} from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58m from 'bs58';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const bs58 = bs58m.decode ? bs58m : bs58m.default;
const API = 'https://locked-in-backend-oetf.onrender.com';
const COURSE = 'blockchain-wallets'; // a real course with lessons
const RPC = 'https://api.devnet.solana.com';
const PROGRAM = new PublicKey('EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN');
const MOCK = new PublicKey('3kqzsQV7Ab8aakkNugM9aXBqQrgwnshF6a47HxJcfLtp');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const m = (pubkey, w, s = false) => ({ pubkey, isSigner: s, isWritable: w });
const load = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));

const conn = new Connection(RPC, 'confirmed');
const user = load('/Users/ongeeshen/Project/locked-in/.e2e/devnet-e2e.json');
const deployer = load(homedir() + '/.config/solana/id.json');
const courseHash = createHash('sha256').update(COURSE, 'utf8').digest();

const [config] = PublicKey.findProgramAddressSync([Buffer.from('vault-v2b')], PROGRAM);
const [lock] = PublicKey.findProgramAddressSync([Buffer.from('lock-v2'), user.publicKey.toBuffer(), courseHash], PROGRAM);
const [mockReserve] = PublicKey.findProgramAddressSync([Buffer.from('reserve'), USDC.toBuffer()], MOCK);
const [mockAuth] = PublicKey.findProgramAddressSync([Buffer.from('authority'), USDC.toBuffer()], MOCK);
const [mockCtoken] = PublicKey.findProgramAddressSync([Buffer.from('ctoken'), USDC.toBuffer()], MOCK);
const mockVault = getAssociatedTokenAddressSync(USDC, mockAuth, true);
const lockCollateral = getAssociatedTokenAddressSync(mockCtoken, lock, true);
const userUsdc = getAssociatedTokenAddressSync(USDC, user.publicKey);

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

console.log('user:', user.publicKey.toBase58(), '\ncourse:', COURSE, '\nlock:', lock.toBase58());

// 1. Ensure an ACTIVE lock on the real course (deposit 1 USDC if needed).
await getOrCreateAssociatedTokenAccount(conn, deployer, USDC, deployer.publicKey);
const lockAcc = await conn.getAccountInfo(lock);
const status = lockAcc ? lockAcc.data[88] : null;
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
      data: Buffer.concat([disc('lock_funds_v2'), courseHash, u64(1_000_000)]),
    })), [user], { commitment: 'confirmed' });
  console.log('deposited 1 USDC -> lock ACTIVE');
} else {
  console.log('lock already ACTIVE, principal', Number((await getAccount(conn, lockCollateral)).amount) / 1e6, 'shares');
}

// 2. Real wallet-signature auth against PROD.
const wallet = user.publicKey.toBase58();
const ch = await api('/v1/auth/challenge', { method: 'POST', body: { walletAddress: wallet } });
if (ch.status !== 200) throw new Error('challenge failed: ' + JSON.stringify(ch));
const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.json.message), user.secretKey));
const verify = await api('/v1/auth/verify', { method: 'POST', body: { walletAddress: wallet, challengeId: ch.json.challengeId, signature: sig } });
if (verify.status !== 200) throw new Error('verify failed: ' + JSON.stringify(verify));
const token = verify.json.accessToken;
console.log('\n✅ PROD AUTH OK (real wallet signature) — got JWT');

// 3. Exercise the v2 endpoints on PROD.
const elig = await api(`/v1/locks/${COURSE}/eligibility`, { token });
console.log(`eligibility: ${elig.status}`, JSON.stringify(elig.json));

const enroll = await api(`/v1/locks/${COURSE}/enroll`, { method: 'POST', token, body: { lockAddress: lock.toBase58() } });
console.log(`enroll: ${enroll.status}`, JSON.stringify(enroll.json));

const pos = await api(`/v1/locks/${COURSE}/position`, { token });
console.log(`position: ${pos.status}`, JSON.stringify(pos.json));

const voucher = await api(`/v1/progress/courses/${COURSE}/voucher`, { method: 'POST', token });
console.log(`voucher: ${voucher.status}`, JSON.stringify(voucher.json));

console.log('\n=== VERDICT ===');
const ok = elig.status === 200 && enroll.status === 200 && pos.json?.status === 'ACTIVE';
console.log(ok
  ? '✅ LIVE PROD v2 PATH WORKS: auth + eligibility + enroll + position(ACTIVE). Voucher correctly ' + (voucher.status === 403 ? '403 (course not complete)' : voucher.status)
  : '⚠️ something off — inspect the statuses above');
