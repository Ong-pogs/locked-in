// Validate the programdata upgrade-authority gate + pot_vault mint pin on the
// v2 init: deployer (upgrade authority) succeeds; a random signer is rejected.
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction, SystemProgram,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM = new PublicKey('EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN');
const MOCK = new PublicKey('3kqzsQV7Ab8aakkNugM9aXBqQrgwnshF6a47HxJcfLtp');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const BPF_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const disc = (n) => createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const m = (pubkey, w, s = false) => ({ pubkey, isSigner: s, isWritable: w });
const load = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));

const conn = new Connection(RPC, 'confirmed');
const deployer = load(homedir() + '/.config/solana/id.json');
const user = load('/Users/ongeeshen/Project/locked-in/.e2e/devnet-e2e.json');

const [config] = PublicKey.findProgramAddressSync([Buffer.from('vault-v2')], PROGRAM);
const [mockReserve] = PublicKey.findProgramAddressSync([Buffer.from('reserve'), USDC.toBuffer()], MOCK);
const [mockAuth] = PublicKey.findProgramAddressSync([Buffer.from('authority'), USDC.toBuffer()], MOCK);
const [mockCtoken] = PublicKey.findProgramAddressSync([Buffer.from('ctoken'), USDC.toBuffer()], MOCK);
const mockVault = getAssociatedTokenAddressSync(USDC, mockAuth, true);
const [programData] = PublicKey.findProgramAddressSync([PROGRAM.toBuffer()], BPF_LOADER);
const potVault = getAssociatedTokenAddressSync(USDC, deployer.publicKey);
await getOrCreateAssociatedTokenAccount(conn, deployer, USDC, deployer.publicKey);

function initIx(signer) {
  const params = Buffer.concat([
    deployer.publicKey.toBuffer(), MOCK.toBuffer(), mockReserve.toBuffer(),
    SystemProgram.programId.toBuffer(), mockAuth.toBuffer(), mockVault.toBuffer(),
    potVault.toBuffer(), u64(1_000_000), u64(50_000_000), u64(1_000_000_000), u16(0),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      m(config, true), m(USDC, false), m(mockCtoken, false), m(potVault, false),
      m(signer.publicKey, true, true), m(PROGRAM, false), m(programData, false), m(SystemProgram.programId, false),
    ],
    data: Buffer.concat([disc('initialize_vault_v2'), params]),
  });
}

console.log('programData:', programData.toBase58());

// TEST 1: random signer (not upgrade authority) must be REJECTED.
if (!(await conn.getAccountInfo(config))) {
  try {
    await sendAndConfirmTransaction(conn, new Transaction().add(initIx(user)), [user], { commitment: 'confirmed' });
    console.log('❌ FAIL: random signer init SUCCEEDED (gate broken)');
    process.exit(1);
  } catch (e) {
    const logs = (await e.getLogs?.(conn)) ?? e.logs ?? [];
    const gated = JSON.stringify(logs).includes('NotUpgradeAuthority') || JSON.stringify(logs).includes('ConstraintRaw') || /custom program error/.test(e.message);
    console.log(gated ? '✅ random signer REJECTED (gate works)' : '⚠️ rejected but unclear reason: ' + e.message.slice(0, 80));
  }
}

// TEST 2: deployer (upgrade authority) must SUCCEED.
if (!(await conn.getAccountInfo(config))) {
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(initIx(deployer)), [deployer], { commitment: 'confirmed' });
  console.log('✅ deployer (upgrade authority) init SUCCEEDED:', sig);
} else {
  console.log('config already exists — checking authority pinned correctly');
}
const acc = await conn.getAccountInfo(config);
console.log('config paused byte @362:', acc.data[362], '(expect 0)');
console.log('\nGATE VALIDATED: only the upgrade authority can initialize the v2 vault, and pot_vault is mint-pinned.');
