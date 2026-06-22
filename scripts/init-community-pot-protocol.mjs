// Initialize the POT (community-pot) config on the merged `locked_in` program.
//
// Merged program (vault + pot under ONE program ID). This script calls the
// `initialize_pot` instruction:
//   * config PDA seed  = b"pot-protocol" (re-seeded to avoid colliding with
//                        the vault config PDA which uses b"vault-protocol")
//   * args             = stable_mint (pubkey)
//   * accounts         = [protocol_config (writable PDA), authority (signer,
//                        writable, pays rent + becomes config.authority),
//                        system_program]
//
// Env-driven (program ID, mint, RPC, authority keypair). No secrets hardcoded.
// The authority keypair (DEPLOYER_PRIVATE_KEY) IS the protocol/worker authority
// — it is stored on-chain as PotConfig.authority and is the ONLY signer allowed
// to record_redirect / close_distribution_window / distribute_window later.
import crypto from 'crypto';
import fs from 'fs';
import bs58Module from 'bs58';
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

const bs58 = bs58Module.decode ? bs58Module : bs58Module.default;

// Pot config PDA seed in the merged program (was b"protocol" pre-merge).
const POT_CONFIG_SEED = Buffer.from('pot-protocol');

// Anchor instruction discriminator = first 8 bytes of sha256("global:<name>").
function anchorDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function readEnvFile() {
  const contents = fs.readFileSync('.env', 'utf8');
  return Object.fromEntries(
    contents
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function requireEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

async function main() {
  const env = readEnvFile();
  const rpcUrl = env.EXPO_PUBLIC_SOLANA_RPC_URL || clusterApiUrl('devnet');
  const connection = new Connection(rpcUrl, 'confirmed');

  // Authority = deployer keypair; signs + becomes PotConfig.authority on-chain.
  const authority = Keypair.fromSecretKey(bs58.decode(requireEnv(env, 'DEPLOYER_PRIVATE_KEY')));

  // Merged program ID. Prefer the explicit merged var; fall back to the
  // canonical EXPO_PUBLIC_LOCK_VAULT_PROGRAM_ID (which, post-merge, holds the
  // single `locked_in` program ID used by BOTH the vault and pot domains).
  const programId = new PublicKey(
    env.EXPO_PUBLIC_LOCKED_IN_PROGRAM_ID || requireEnv(env, 'EXPO_PUBLIC_LOCK_VAULT_PROGRAM_ID'),
  );
  const stableMint = new PublicKey(requireEnv(env, 'EXPO_PUBLIC_LOCK_VAULT_USDC_MINT'));

  const [protocolConfig] = PublicKey.findProgramAddressSync([POT_CONFIG_SEED], programId);

  const existing = await connection.getAccountInfo(protocolConfig, 'confirmed');
  if (existing) {
    console.log(
      JSON.stringify(
        {
          programId: programId.toBase58(),
          protocolConfig: protocolConfig.toBase58(),
          stableMint: stableMint.toBase58(),
          status: 'already_initialized',
        },
        null,
        2,
      ),
    );
    return;
  }

  // args layout: stable_mint (32), Anchor `pubkey`.
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: protocolConfig, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([anchorDiscriminator('initialize_pot'), stableMint.toBuffer()]),
  });

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    feePayer: authority.publicKey,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction);

  const signature = await sendAndConfirmTransaction(connection, transaction, [authority], {
    commitment: 'confirmed',
  });

  console.log(
    JSON.stringify(
      {
        signature,
        programId: programId.toBase58(),
        protocolConfig: protocolConfig.toBase58(),
        authority: authority.publicKey.toBase58(),
        stableMint: stableMint.toBase58(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
