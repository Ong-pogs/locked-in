#!/usr/bin/env node
// v2 pot funding bridge — LOCAL OPERATOR SCRIPT (pot-cycle ruling 2026-07-10,
// R3). This is the ONLY component that ever touches the deployer key, and it
// NEVER runs on Render (R13: DEPLOYER_PRIVATE_KEY / the G6em keypair must
// never be in Render env).
//
// Why it exists: the live devnet v2 config has pot_vault == fee_vault ==
// GCWEHFyJ… — the deployer's own canonical USDC ATA, permanently commingled
// (set_config_v2 cannot repoint either vault, and SetAuthority rotation of
// that ATA is forbidden). Forfeits therefore land in the deployer's ATA while
// distribute_window pays from a DIFFERENT account: the merged program's
// pot-protocol PDA ATA. This script moves exactly the event-derived shortfall
// (never a balance sweep — that would sweep platform fees into the pot).
//
// Amount = max(0, required - current PDA-vault balance), where required is
// the SUM over all known window ids (settle events UNION distribution
// snapshots UNION harvest receipts) of PotWindow.total_redirected_amount
// minus DistributionWindow.distributed_amount when the DistributionWindow
// exists (the same formula as runPotCycle's solvency preflight).
//
// Usage (from the repo root, with backend/.env or env vars present):
//   node scripts/bridge-v2-pot-transfer.mjs             # dry-run (default)
//   node scripts/bridge-v2-pot-transfer.mjs --execute   # move the USDC
//
// Signer: ~/.config/solana/id.json — MUST be the deployer key
// G6emPd5DtiK2Dnoc9zw2xL215Y7nqppBkvTqCw2S6QeG; anything else aborts.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve dependencies from backend/node_modules (the repo root has no
// package.json since the PWA pivot).
const require = createRequire(
  new URL('../backend/package.json', import.meta.url),
);
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} = require('@solana/spl-token');
const pg = require('pg');

// --- pinned facts (verified live on devnet during the pot-cycle ruling) ----
const DEPLOYER_PUBKEY = 'G6emPd5DtiK2Dnoc9zw2xL215Y7nqppBkvTqCw2S6QeG';
// Source: the commingled ops vault (v2 pot_vault == fee_vault == the
// deployer's canonical USDC ATA).
const SOURCE_OPS_ATA = 'GCWEHFyJPS3ARfXk9V3jnfsZfaFCe8xmQfPKknjMM3yJ';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_DECIMALS = 6;
// Destination: the MERGED locked_in program's pot vault. NOTE: do NOT reuse
// scripts/fund-community-pot-vault.mjs — it derives with the OLD standalone
// seed 'protocol', which is the WRONG PDA for the merged program.
const MERGED_PROGRAM_ID = '3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav';
const POT_PROTOCOL_SEED = Buffer.from('pot-protocol');
const WINDOW_SEED = Buffer.from('window');
const DISTRIBUTION_SEED = Buffer.from('distribution');

const POT_WINDOW_DISCRIMINATOR = createHash('sha256')
  .update('account:PotWindow')
  .digest()
  .subarray(0, 8);
const DISTRIBUTION_WINDOW_DISCRIMINATOR = createHash('sha256')
  .update('account:DistributionWindow')
  .digest()
  .subarray(0, 8);

function readBackendEnvFile() {
  const envPath = join(fileURLToPath(new URL('../backend', import.meta.url)), '.env');
  if (!existsSync(envPath)) {
    return {};
  }
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function encodeI64LE(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(BigInt(value), 0);
  return buffer;
}

function loadDeployerKeypair() {
  const keypairPath = join(homedir(), '.config', 'solana', 'id.json');
  const secret = Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8')));
  const keypair = Keypair.fromSecretKey(secret);
  if (keypair.publicKey.toBase58() !== DEPLOYER_PUBKEY) {
    console.error(
      `bridge-v2-pot-transfer: ${keypairPath} is ${keypair.publicKey.toBase58()}, ` +
        `not the deployer ${DEPLOYER_PUBKEY}. Refusing to run.`,
    );
    process.exit(1);
  }
  return keypair;
}

async function readPotWindowTotal(connection, programId, windowId) {
  const [windowAccount] = PublicKey.findProgramAddressSync(
    [WINDOW_SEED, encodeI64LE(windowId)],
    programId,
  );
  const info = await connection.getAccountInfo(windowAccount, 'confirmed');
  if (!info) {
    return null;
  }
  if (!info.data.subarray(0, 8).equals(POT_WINDOW_DISCRIMINATOR)) {
    throw new Error(`Account at window ${windowId} is not a PotWindow.`);
  }
  // PotWindow: disc(8) protocol_config(32) window_id i64(8) total u64(8) ...
  return info.data.readBigUInt64LE(8 + 32 + 8);
}

async function readDistributionWindowDistributed(connection, programId, windowId) {
  const [distributionWindow] = PublicKey.findProgramAddressSync(
    [DISTRIBUTION_SEED, encodeI64LE(windowId)],
    programId,
  );
  const info = await connection.getAccountInfo(distributionWindow, 'confirmed');
  if (!info) {
    return null;
  }
  if (!info.data.subarray(0, 8).equals(DISTRIBUTION_WINDOW_DISCRIMINATOR)) {
    throw new Error(`Account at window ${windowId} is not a DistributionWindow.`);
  }
  // DistributionWindow: disc(8) protocol_config(32) pot_window(32)
  // window_id i64(8) total_redirected u64(8) total_weight u64(8)
  // eligible_recipient_count u32(4) distributed_amount u64(8) ...
  return info.data.readBigUInt64LE(8 + 32 + 32 + 8 + 8 + 8 + 4);
}

async function main() {
  const executeFlag = process.argv.includes('--execute');
  const env = { ...readBackendEnvFile(), ...process.env };

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('bridge-v2-pot-transfer: DATABASE_URL is required (backend/.env or env).');
    process.exit(1);
  }
  const rpcUrl = env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

  const deployer = loadDeployerKeypair();
  const connection = new Connection(rpcUrl, 'confirmed');
  const programId = new PublicKey(MERGED_PROGRAM_ID);
  const stableMint = new PublicKey(USDC_MINT);

  // Sanity: the source really is the deployer's canonical USDC ATA.
  const derivedDeployerAta = getAssociatedTokenAddressSync(
    stableMint,
    deployer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  if (derivedDeployerAta.toBase58() !== SOURCE_OPS_ATA) {
    console.error(
      `bridge-v2-pot-transfer: derived deployer USDC ATA ${derivedDeployerAta.toBase58()} ` +
        `!= expected source ${SOURCE_OPS_ATA}. Refusing to run.`,
    );
    process.exit(1);
  }

  // Destination: merged-program PDA pot vault (seed 'pot-protocol').
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [POT_PROTOCOL_SEED],
    programId,
  );
  const potVault = getAssociatedTokenAddressSync(
    stableMint,
    protocolConfig,
    true, // allowOwnerOffCurve — the owner is a PDA
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // All known window ids (R3's union).
  const isLocalDb = /@(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(databaseUrl);
  const db = new pg.Client({
    connectionString: databaseUrl,
    ssl: isLocalDb ? false : { rejectUnauthorized: false },
  });
  await db.connect();
  let windowIds;
  try {
    const result = await db.query(`
      select window_id from (
        select distinct window_id from lesson.v2_pot_settle_events
        union
        select distinct window_id from lesson.community_pot_distribution_snapshots
        union
        select distinct community_pot_window_id from lesson.harvest_result_receipts
        where community_pot_window_id is not null
      ) windows
      where window_id is not null
      order by window_id asc
    `);
    windowIds = result.rows.map((row) => Number(row.window_id));
  } finally {
    await db.end();
  }

  let required = 0n;
  const breakdown = [];
  for (const windowId of windowIds) {
    const total = await readPotWindowTotal(connection, programId, windowId);
    if (total == null) {
      breakdown.push({ windowId, potWindow: 'absent', outstandingAtomic: '0' });
      continue;
    }
    const distributed =
      (await readDistributionWindowDistributed(connection, programId, windowId)) ?? 0n;
    const outstanding = total > distributed ? total - distributed : 0n;
    required += outstanding;
    breakdown.push({
      windowId,
      totalRedirectedAtomic: total.toString(),
      distributedAtomic: distributed.toString(),
      outstandingAtomic: outstanding.toString(),
    });
  }

  const vaultBalanceResult = await connection
    .getTokenAccountBalance(potVault, 'confirmed')
    .catch(() => null);
  const vaultBalance = BigInt(vaultBalanceResult?.value?.amount ?? 0);
  const transferAmount = required > vaultBalance ? required - vaultBalance : 0n;

  const sourceBalanceResult = await connection
    .getTokenAccountBalance(new PublicKey(SOURCE_OPS_ATA), 'confirmed')
    .catch(() => null);
  const sourceBalance = BigInt(sourceBalanceResult?.value?.amount ?? 0);

  const summary = {
    mode: executeFlag ? 'EXECUTE' : 'DRY-RUN (pass --execute to move funds)',
    rpcUrl,
    deployer: DEPLOYER_PUBKEY,
    source: SOURCE_OPS_ATA,
    destinationPotVault: potVault.toBase58(),
    potProtocolPda: protocolConfig.toBase58(),
    windowBreakdown: breakdown,
    requiredAtomic: required.toString(),
    vaultBalanceAtomic: vaultBalance.toString(),
    sourceBalanceAtomic: sourceBalance.toString(),
    transferAtomic: transferAmount.toString(),
    transferUi: (Number(transferAmount) / 10 ** USDC_DECIMALS).toFixed(USDC_DECIMALS),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!executeFlag) {
    return; // dry-run: ZERO sends of any kind.
  }
  if (transferAmount === 0n) {
    console.log('bridge-v2-pot-transfer: PDA pot vault already covers the requirement — nothing to move.');
    return;
  }
  if (sourceBalance < transferAmount) {
    console.error(
      `bridge-v2-pot-transfer: source ${SOURCE_OPS_ATA} holds ${sourceBalance} < ` +
        `required transfer ${transferAmount}. Refusing.`,
    );
    process.exit(1);
  }

  const instructions = [
    // Idempotent: creates the pot-vault ATA only if missing.
    createAssociatedTokenAccountIdempotentInstruction(
      deployer.publicKey,
      potVault,
      protocolConfig,
      stableMint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      new PublicKey(SOURCE_OPS_ATA),
      stableMint,
      potVault,
      deployer.publicKey,
      transferAmount,
      USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  ];

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    feePayer: deployer.publicKey,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(...instructions);

  const signature = await sendAndConfirmTransaction(connection, transaction, [deployer], {
    commitment: 'confirmed',
  });
  const after = await connection.getTokenAccountBalance(potVault, 'confirmed');
  console.log(
    JSON.stringify(
      {
        signature,
        transferredAtomic: transferAmount.toString(),
        potVault: potVault.toBase58(),
        potVaultBalanceUi: after.value.uiAmountString,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('bridge-v2-pot-transfer FAILED:', error?.message ?? error);
  process.exit(1);
});
