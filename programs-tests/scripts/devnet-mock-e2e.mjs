// Proves the devnet mock reserve on real devnet with the funded E2E wallet:
// init the reserve for devnet USDC, deposit as the user, redeem, check balances.
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction, SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAccount,
} from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const RPC = 'https://api.devnet.solana.com';
const MOCK = new PublicKey('3kqzsQV7Ab8aakkNugM9aXBqQrgwnshF6a47HxJcfLtp');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const SYSVAR_IX = new PublicKey('Sysvar1nstructions1111111111111111111111111');

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const meta = (pubkey, w, s = false) => ({ pubkey, isSigner: s, isWritable: w });
const load = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));

const conn = new Connection(RPC, 'confirmed');
const deployer = load(homedir() + '/.config/solana/id.json');
const user = load('/Users/ongeeshen/Project/locked-in/.e2e/devnet-e2e.json');
console.log('deployer:', deployer.publicKey.toBase58());
console.log('user    :', user.publicKey.toBase58());

const [reserve] = PublicKey.findProgramAddressSync([Buffer.from('reserve'), USDC.toBuffer()], MOCK);
const [authority] = PublicKey.findProgramAddressSync([Buffer.from('authority'), USDC.toBuffer()], MOCK);
const [ctoken] = PublicKey.findProgramAddressSync([Buffer.from('ctoken'), USDC.toBuffer()], MOCK);
const vault = getAssociatedTokenAddressSync(USDC, authority, true);
console.log('reserve :', reserve.toBase58(), '| ctoken:', ctoken.toBase58());

// 1. init_reserve if it does not exist yet (deployer pays).
if (!(await conn.getAccountInfo(reserve))) {
  const init = new TransactionInstruction({
    programId: MOCK,
    keys: [
      meta(reserve, true), meta(authority, false), meta(USDC, false),
      meta(ctoken, true), meta(vault, true), meta(deployer.publicKey, true, true),
      meta(TOKEN_PROGRAM_ID, false), meta(ASSOCIATED_TOKEN_PROGRAM_ID, false), meta(SystemProgram.programId, false),
    ],
    data: Buffer.concat([disc('init_reserve'), u16(800)]),
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(init), [deployer], { commitment: 'confirmed' });
  console.log('init_reserve:', sig);
} else {
  console.log('reserve already initialized');
}

// 2. User ATAs.
const userUsdc = getAssociatedTokenAddressSync(USDC, user.publicKey);
const userCtoken = (await getOrCreateAssociatedTokenAccount(conn, user, ctoken, user.publicKey)).address;
const before = Number((await getAccount(conn, userUsdc)).amount);
console.log('\nuser USDC before:', before / 1e6);

const DEPOSIT = 10_000_000; // 10 USDC
const deposit = new TransactionInstruction({
  programId: MOCK,
  keys: [
    meta(user.publicKey, false, true), meta(reserve, true), meta(reserve, false), meta(authority, false),
    meta(USDC, false), meta(vault, true), meta(ctoken, true),
    meta(userUsdc, true), meta(userCtoken, true),
    meta(TOKEN_PROGRAM_ID, false), meta(TOKEN_PROGRAM_ID, false), meta(SYSVAR_IX, false),
  ],
  data: Buffer.concat([disc('deposit_reserve_liquidity'), u64(DEPOSIT)]),
});
await sendAndConfirmTransaction(conn, new Transaction().add(deposit), [user], { commitment: 'confirmed' });
const cbal = Number((await getAccount(conn, userCtoken)).amount);
const afterDep = Number((await getAccount(conn, userUsdc)).amount);
console.log('after deposit: USDC', afterDep / 1e6, '| cUSDC (shares)', cbal / 1e6);

// 3. Redeem all shares.
const redeem = new TransactionInstruction({
  programId: MOCK,
  keys: [
    meta(user.publicKey, false, true), meta(reserve, false), meta(reserve, true), meta(authority, false),
    meta(USDC, false), meta(ctoken, true), meta(vault, true),
    meta(userCtoken, true), meta(userUsdc, true),
    meta(TOKEN_PROGRAM_ID, false), meta(TOKEN_PROGRAM_ID, false), meta(SYSVAR_IX, false),
  ],
  data: Buffer.concat([disc('redeem_reserve_collateral'), u64(cbal)]),
});
await sendAndConfirmTransaction(conn, new Transaction().add(redeem), [user], { commitment: 'confirmed' });
const afterRedeem = Number((await getAccount(conn, userUsdc)).amount);
console.log('after redeem : USDC', afterRedeem / 1e6);

console.log('\n✅ DEVNET MOCK DEPOSIT+REDEEM WORKS');
console.log('   deposited 10 USDC, got', cbal / 1e6, 'shares, redeemed for', (afterRedeem - afterDep) / 1e6, 'USDC (principal, no elapsed yield same-block)');
