// Initialize the community-pot PotConfig on MAINNET (audit H5). Creates the
// 'pot-protocol' PDA whose authority is the ops relay key — the ONLY signer
// allowed to record_redirect / close / distribute later. Run this BEFORE
// init-mainnet-vault.mjs so the pot vault (the protocol PDA's USDC ATA) can be
// wired as vault_v2's pot_vault, making forfeits auto-fund distribution.
//
//   MAINNET_RPC_URL=... POT_AUTHORITY_KEYPAIR=<ops-relay.json> \
//     node scripts/deploy/init-mainnet-pot.mjs
//
// POT_AUTHORITY_KEYPAIR MUST be the keypair whose bs58 secret is the backend's
// COMMUNITY_POT_WORKER_PRIVATE_KEY (the pot cycle refuses to run if PotConfig.
// authority != the relay signer). It pays rent and becomes PotConfig.authority.
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const req = (k) => { const v = process.env[k]; if (!v) { console.error(`ERROR: ${k} is required`); process.exit(1); } return v; };
const RPC = req('MAINNET_RPC_URL');
const conn = new Connection(RPC, 'confirmed');
const USDC = new PublicKey(process.env.LOCK_VAULT_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const POT_CONFIG_SEED = Buffer.from('pot-protocol');

const loadKp = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
const authority = loadKp(req('POT_AUTHORITY_KEYPAIR'));
const programKp = loadKp(process.env.PROGRAM_KEYPAIR || 'keys/mainnet/locked_in-mainnet-keypair.json');
const PROGRAM_ID = programKp.publicKey;

const disc = (n) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);

async function main() {
  const [protocolConfig] = PublicKey.findProgramAddressSync([POT_CONFIG_SEED], PROGRAM_ID);
  console.log('program        :', PROGRAM_ID.toBase58());
  console.log('PotConfig PDA  :', protocolConfig.toBase58());
  console.log('authority      :', authority.publicKey.toBase58(), '(= COMMUNITY_POT_WORKER_PRIVATE_KEY pubkey)');
  console.log('stable mint    :', USDC.toBase58());

  if (await conn.getAccountInfo(protocolConfig)) {
    console.log('\nPotConfig already initialized — nothing to do.');
    return;
  }

  // Front-run gate: initialize_pot now requires the program + its ProgramData
  // account, and constrains program_data.upgrade_authority == authority. So the
  // POT_AUTHORITY_KEYPAIR must be the program's UPGRADE AUTHORITY at init time.
  const BPF_UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_UPGRADEABLE_LOADER);
  console.log('program_data   :', programData.toBase58(), '(authority must be its upgrade_authority)');

  // initialize_pot(stable_mint):
  //   [protocol_config(w,pda), authority(signer,w), program, program_data, system_program]
  const data = Buffer.concat([disc('initialize_pot'), USDC.toBuffer()]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocolConfig, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: programData, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [authority]);
  console.log('\n✅ initialize_pot OK —', sig);
  console.log('next: init-mainnet-vault.mjs (pot vault auto-derives from this PDA)');
}

main().catch((e) => { console.error('\n❌ init-pot failed:', e.message); process.exit(1); });
