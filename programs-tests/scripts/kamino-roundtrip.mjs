// Proves the on-chain kamino CPI wrappers deposit into and redeem from the real
// Kamino klend USDC reserve, against a surfpool mainnet fork.
//
// Prereqs: surfpool fork on :8899, program deployed at PROGRAM_ID, payer =
// ~/.config/solana/id.json (auto-funded by the fork).
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const RPC = 'http://127.0.0.1:8899';
const PROGRAM_ID = new PublicKey('EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN');
const KLEND = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const SYSVAR_IX = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const SYS = new PublicKey('11111111111111111111111111111111');

// ACTIVE main-market USDC reserve (status=0, ~$13M avail). The reserve returned
// by getReserveBySymbol('USDC') (5xXxt9uV) is DEPRECATED (status=2, depLimit=0).
const RESERVE = new PublicKey('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59');
const MARKET = new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');
const LMA = new PublicKey('9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const LIQ_SUPPLY = new PublicKey('Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6');
const CUSDC = new PublicKey('B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D');
const SCOPE = new PublicKey('3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH');

const disc = (name) => createHash('sha256').update('global:' + name).digest().subarray(0, 8);
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(method + ': ' + JSON.stringify(j.error));
  return j.result;
}

const conn = new Connection(RPC, 'confirmed');
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(homedir() + '/.config/solana/id.json', 'utf8'))),
);

const [probe] = PublicKey.findProgramAddressSync([Buffer.from('kamino-probe')], PROGRAM_ID);
const probeUsdc = getAssociatedTokenAddressSync(USDC, probe, true);
const probeCusdc = getAssociatedTokenAddressSync(CUSDC, probe, true);

console.log('program :', PROGRAM_ID.toBase58());
console.log('probe   :', probe.toBase58());
console.log('usdc ata:', probeUsdc.toBase58());
console.log('cusdc ata:', probeCusdc.toBase58());

const DEPOSIT = 25_000_000; // 25 USDC
// Fund the probe's USDC ATA and create an empty cUSDC ATA via cheatcode.
await rpc('surfnet_setTokenAccount', [probe.toBase58(), USDC.toBase58(), { amount: DEPOSIT }]);
await rpc('surfnet_setTokenAccount', [probe.toBase58(), CUSDC.toBase58(), { amount: 0 }]);
console.log('funded probe USDC ATA with', DEPOSIT / 1e6, 'USDC; created empty cUSDC ATA');

const meta = (pubkey, isWritable, isSigner = false) => ({ pubkey, isSigner, isWritable });

// refresh_reserve (klend requires a fresh reserve before deposit/redeem).
// None oracles use the KLEND program id as the sentinel (Anchor optional-account
// convention), NOT the system program — verified against the SDK's own builder.
const refresh = new TransactionInstruction({
  programId: KLEND,
  keys: [
    meta(RESERVE, true), meta(MARKET, false),
    meta(KLEND, false), meta(KLEND, false), meta(KLEND, false), // pyth/sbPrice/sbTwap = None
    meta(SCOPE, false),
  ],
  data: Buffer.from(disc('refresh_reserve')),
});

// kamino_roundtrip on our program — account order mirrors KaminoRoundtrip struct
const roundtrip = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    meta(KLEND, false),
    meta(probe, false),        // probe_authority (PDA, signs via CPI seeds)
    meta(probeUsdc, true),     // probe_liquidity
    meta(probeCusdc, true),    // probe_collateral
    meta(RESERVE, true),
    meta(MARKET, false),
    meta(LMA, false),
    meta(USDC, false),         // reserve_liquidity_mint
    meta(LIQ_SUPPLY, true),
    meta(CUSDC, true),         // reserve_collateral_mint
    meta(TOKEN_PROGRAM_ID, false),
    meta(TOKEN_PROGRAM_ID, false),
    meta(SYSVAR_IX, false),
  ],
  data: Buffer.concat([disc('kamino_roundtrip'), u64le(DEPOSIT)]),
});

const tx = new Transaction().add(refresh).add(roundtrip);
try {
  const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' });
  console.log('\n✅ ROUNDTRIP CONFIRMED:', sig);
  const parsed = await conn.getParsedTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  console.log('logs:');
  (parsed?.meta?.logMessages ?? []).filter((l) => /Program log|Program data|RoundtripDone|deposited|collateral/i.test(l)).forEach((l) => console.log('  ' + l));
} catch (e) {
  console.log('\n❌ FAILED:', e.message);
  const logs = e.logs ?? e.transactionLogs;
  if (logs) { console.log('program logs:'); logs.forEach((l) => console.log('  ' + l)); }
  process.exit(1);
}
