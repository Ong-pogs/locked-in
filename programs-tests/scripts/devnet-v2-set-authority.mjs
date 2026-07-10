// Rotate the v2 vault ops authority (spec §key-separation): the deployer
// (upgrade authority, cold) signs ONCE locally; the new authority is the
// backend's hot ops key, so voucher signing works on Render without the
// deployer key ever leaving this machine. Devnet only.
//
// Usage: node devnet-v2-set-authority.mjs <NEW_AUTHORITY_PUBKEY>
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const PROGRAM = new PublicKey('EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN');
const BPF_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const newAuthorityArg = process.argv[2];
if (!newAuthorityArg) {
  console.error('usage: node devnet-v2-set-authority.mjs <NEW_AUTHORITY_PUBKEY>');
  process.exit(1);
}
const NEW_AUTHORITY = new PublicKey(newAuthorityArg);

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(homedir() + '/.config/solana/id.json', 'utf8'))),
);
const [config] = PublicKey.findProgramAddressSync([Buffer.from('vault-v2b')], PROGRAM);
const [programData] = PublicKey.findProgramAddressSync([PROGRAM.toBuffer()], BPF_LOADER);
const disc = createHash('sha256').update('global:set_authority_v2').digest().subarray(0, 8);

const before = await conn.getAccountInfo(config);
console.log('authority before:', new PublicKey(before.data.subarray(8, 40)).toBase58());

const ix = new TransactionInstruction({
  programId: PROGRAM,
  keys: [
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
    { pubkey: PROGRAM, isSigner: false, isWritable: false },
    { pubkey: programData, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([disc, NEW_AUTHORITY.toBuffer()]),
});
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [deployer], {
  commitment: 'confirmed',
});
const after = await conn.getAccountInfo(config);
console.log('authority after :', new PublicKey(after.data.subarray(8, 40)).toBase58());
console.log('tx:', sig);
