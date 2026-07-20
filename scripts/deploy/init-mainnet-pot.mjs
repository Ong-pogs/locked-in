// Initialize the community-pot PotConfig on MAINNET (audit H5). Creates the
// 'pot-protocol' PDA. Run this BEFORE init-mainnet-vault.mjs so the pot vault
// (the protocol PDA's USDC ATA) can be wired as vault_v2's pot_vault, making
// forfeits auto-fund distribution.
//
//   MAINNET_RPC_URL=... DEPLOY_KEYPAIR=<upgrade-authority.json> \
//     POT_AUTHORITY_PUBKEY=<ops-relay pubkey> \
//     node scripts/deploy/init-mainnet-pot.mjs
//
// Two distinct keys (mirrors init-mainnet-vault.mjs):
//   - DEPLOY_KEYPAIR signs + pays rent. The on-chain front-run gate requires
//     the signer to be the program's UPGRADE AUTHORITY at init time.
//   - POT_AUTHORITY_PUBKEY is STORED as PotConfig.authority — it must be the
//     pubkey of the backend's COMMUNITY_POT_WORKER_PRIVATE_KEY (the pot cycle
//     preflight refuses to run if PotConfig.authority != the relay signer),
//     so the crons never need the deploy key hot.
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
const deployer = loadKp(req('DEPLOY_KEYPAIR'));
const potAuthority = new PublicKey(req('POT_AUTHORITY_PUBKEY'));
// The stored authority is an unchecked pubkey (no signature proves possession)
// and PotConfig is an init-once singleton — a paste error would strand the pot
// crons until a set_pot_authority rotation. Require the key twice.
if (process.env.CONFIRM_POT_AUTHORITY !== potAuthority.toBase58()) {
  console.error(
    'ERROR: set CONFIRM_POT_AUTHORITY to the SAME base58 pubkey as ' +
      'POT_AUTHORITY_PUBKEY (double-entry check against paste errors). ' +
      'It must be the pubkey of COMMUNITY_POT_WORKER_PRIVATE_KEY.',
  );
  process.exit(1);
}
if (potAuthority.equals(PublicKey.default)) {
  console.error('ERROR: POT_AUTHORITY_PUBKEY must not be the default pubkey.');
  process.exit(1);
}
const programKp = loadKp(process.env.PROGRAM_KEYPAIR || 'keys/mainnet/locked_in-mainnet-keypair.json');
const PROGRAM_ID = programKp.publicKey;

const disc = (n) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);

async function main() {
  const [protocolConfig] = PublicKey.findProgramAddressSync([POT_CONFIG_SEED], PROGRAM_ID);
  console.log('program        :', PROGRAM_ID.toBase58());
  console.log('PotConfig PDA  :', protocolConfig.toBase58());
  console.log('signer (deploy):', deployer.publicKey.toBase58(), '(must be the upgrade authority)');
  console.log('pot authority  :', potAuthority.toBase58(), '(= COMMUNITY_POT_WORKER_PRIVATE_KEY pubkey)');
  console.log('stable mint    :', USDC.toBase58());

  if (await conn.getAccountInfo(protocolConfig)) {
    console.log('\nPotConfig already initialized — nothing to do.');
    return;
  }

  // Front-run gate: initialize_pot requires the program + its ProgramData
  // account and constrains program_data.upgrade_authority == signer.
  const BPF_UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_UPGRADEABLE_LOADER);
  console.log('program_data   :', programData.toBase58());

  // initialize_pot(stable_mint, authority):
  //   [protocol_config(w,pda), authority(signer,w), program, program_data, system_program]
  const data = Buffer.concat([disc('initialize_pot'), USDC.toBuffer(), potAuthority.toBuffer()]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocolConfig, isSigner: false, isWritable: true },
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: programData, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [deployer]);
  console.log('\n✅ initialize_pot OK —', sig);
  console.log('PotConfig.authority =', potAuthority.toBase58());
  console.log('next: init-mainnet-vault.mjs (pot vault auto-derives from this PDA)');
}

main().catch((e) => { console.error('\n❌ init-pot failed:', e.message); process.exit(1); });
