// Initialize the v2 vault config on MAINNET. Creates distinct pot + fee USDC
// vaults and calls initialize_vault_v2 with the real Kamino reserve accounts.
// Fail-closed: every authority is explicit; no silent defaults for money-moving
// roles. Run AFTER deploy-mainnet.sh, and AFTER resolving reserve accounts:
//
//   node backend/scripts/resolve-kamino-usdc-reserve.mjs $MAINNET_RPC_URL /tmp/reserve.json
//   MAINNET_RPC_URL=... DEPLOY_KEYPAIR=... VAULT_AUTHORITY=<ops pubkey> \
//   POT_VAULT_OWNER=<squads vault> FEE_VAULT_OWNER=<squads vault> \
//   RESERVE_JSON=/tmp/reserve.json \
//     node scripts/deploy/init-mainnet-vault.mjs
//
// Caps default to the beta ($10 min / $50 max / $1,000 global / 0% fee).
// The payer (DEPLOY_KEYPAIR) MUST be the program's current upgrade authority.
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const req = (k) => { const v = process.env[k]; if (!v) { console.error(`ERROR: ${k} is required`); process.exit(1); } return v; };
const RPC = req('MAINNET_RPC_URL');
const conn = new Connection(RPC, 'confirmed');
const BPF_LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const CONFIG_SEED = Buffer.from('vault-v2b');

const loadKp = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
const deployer = loadKp(req('DEPLOY_KEYPAIR'));
const programKp = loadKp(process.env.PROGRAM_KEYPAIR || 'keys/mainnet/locked_in-mainnet-keypair.json');
const PROGRAM_ID = programKp.publicKey;
const authority = new PublicKey(req('VAULT_AUTHORITY'));       // voucher/ops signer
const feeOwner = new PublicKey(req('FEE_VAULT_OWNER'));        // platform-fee dest (e.g. Squads vault)
const R = JSON.parse(readFileSync(req('RESERVE_JSON'), 'utf8'));

// The pot vault IS the community-pot distribution vault: config.pot_vault =
// ATA(USDC, pot-protocol PDA). Then v2 settle sends forfeited yield straight
// into the vault distribute_window pays from — no separate funding bridge
// needed (audit H4). Requires init-mainnet-pot.mjs to have run first.
const POT_CONFIG_SEED = Buffer.from('pot-protocol');
const [potProtocolPda] = PublicKey.findProgramAddressSync([POT_CONFIG_SEED], programKp.publicKey);

const MIN = BigInt(process.env.CAP_MIN ?? 10_000_000);         // $10
const MAX = BigInt(process.env.CAP_MAX ?? 50_000_000);         // $50
const GLOBAL = BigInt(process.env.CAP_GLOBAL ?? 1_000_000_000);// $1,000
const FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? 0);

const USDC = new PublicKey(R.usdcMint);
const KLEND = new PublicKey(R.kaminoProgram);
const RESERVE = new PublicKey(R.kaminoReserve);
const MARKET = new PublicKey(R.kaminoMarket);
const LMA = new PublicKey(R.kaminoLma);
const LIQ_SUPPLY = new PublicKey(R.kaminoLiquiditySupply);
const COLL_MINT = new PublicKey(R.kaminoCollateralMint);

const disc = (n) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
const m = (pk, w = false, s = false) => ({ pubkey: new PublicKey(pk), isSigner: s, isWritable: w });
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

async function main() {
  if (KLEND.toBase58() !== 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD') {
    throw new Error(`RESERVE_JSON kaminoProgram is not real klend: ${KLEND.toBase58()}`);
  }
  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID);
  const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE);
  // pot vault = the community-pot distribution vault (ATA of the pot-protocol
  // PDA). fee vault = a distinct account for platform fees.
  const potVault = getAssociatedTokenAddressSync(USDC, potProtocolPda, true);
  const feeVault = getAssociatedTokenAddressSync(USDC, feeOwner, true);

  console.log('program    :', PROGRAM_ID.toBase58());
  console.log('config PDA :', config.toBase58());
  console.log('authority  :', authority.toBase58());
  console.log('pot vault  :', potVault.toBase58(), '(pot-protocol PDA', potProtocolPda.toBase58() + ') — forfeits auto-fund distribution');
  console.log('fee vault  :', feeVault.toBase58(), '(owner', feeOwner.toBase58() + ')');
  console.log('reserve    :', RESERVE.toBase58());
  console.log('caps       : min', Number(MIN) / 1e6, 'max', Number(MAX) / 1e6, 'global', Number(GLOBAL) / 1e6, 'fee_bps', FEE_BPS);
  if (potVault.equals(feeVault)) throw new Error('pot and fee vaults collided — FEE_VAULT_OWNER must not be the pot-protocol PDA');

  // PotConfig must exist first (init-mainnet-pot.mjs) — else the pot vault ATA
  // has no owning program state and the pot cycle can never distribute.
  if (!(await conn.getAccountInfo(potProtocolPda))) {
    throw new Error('PotConfig (pot-protocol PDA) does not exist — run scripts/deploy/init-mainnet-pot.mjs first.');
  }

  const existing = await conn.getAccountInfo(config);
  if (existing) { console.log('\nconfig already initialized — nothing to do.'); return; }

  // Create pot + fee vaults if absent (idempotent).
  const ixs = [];
  for (const [ata, owner] of [[potVault, potProtocolPda], [feeVault, feeOwner]]) {
    if (!(await conn.getAccountInfo(ata))) {
      ixs.push(createAssociatedTokenAccountInstruction(deployer.publicKey, ata, owner, USDC));
    }
  }
  if (ixs.length) {
    await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [deployer]);
    console.log('created pot/fee vault ATA(s)');
  }

  const initData = Buffer.concat([
    disc('initialize_vault_v2'),
    authority.toBuffer(), KLEND.toBuffer(), RESERVE.toBuffer(), MARKET.toBuffer(),
    LMA.toBuffer(), LIQ_SUPPLY.toBuffer(), feeVault.toBuffer(),
    u64(MIN), u64(MAX), u64(GLOBAL), u16(FEE_BPS),
  ]);
  const initIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      m(config, true), m(USDC), m(COLL_MINT), m(potVault), m(deployer.publicKey, true, true),
      m(PROGRAM_ID), m(programData), m(SystemProgram.programId),
    ],
    data: initData,
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(initIx), [deployer]);
  console.log('\n✅ initialize_vault_v2 OK —', sig);
  console.log('config:', config.toBase58());
}

main().catch((e) => { console.error('\n❌ init failed:', e.message); process.exit(1); });
