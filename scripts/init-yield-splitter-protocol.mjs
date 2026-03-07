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
const PROTOCOL_SEED = Buffer.from('protocol');

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

function encodeU16LE(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value, 0);
  return bytes;
}

async function main() {
  const env = readEnvFile();
  const rpcUrl = env.EXPO_PUBLIC_SOLANA_RPC_URL || clusterApiUrl('devnet');
  const connection = new Connection(rpcUrl, 'confirmed');
  const deployer = Keypair.fromSecretKey(bs58.decode(env.DEPLOYER_PRIVATE_KEY));
  const programId = new PublicKey(env.EXPO_PUBLIC_YIELD_SPLITTER_PROGRAM_ID);
  const stableMint = new PublicKey(env.EXPO_PUBLIC_LOCK_VAULT_USDC_MINT);
  const lockVaultProgramId = new PublicKey(env.EXPO_PUBLIC_LOCK_VAULT_PROGRAM_ID);
  const communityPotProgramId = new PublicKey(env.EXPO_PUBLIC_COMMUNITY_POT_PROGRAM_ID);
  const [protocolConfig] = PublicKey.findProgramAddressSync([PROTOCOL_SEED], programId);

  const existing = await connection.getAccountInfo(protocolConfig, 'confirmed');
  if (existing) {
    console.log(
      JSON.stringify(
        {
          protocolConfig: protocolConfig.toBase58(),
          stableMint: stableMint.toBase58(),
          lockVaultProgramId: lockVaultProgramId.toBase58(),
          communityPotProgramId: communityPotProgramId.toBase58(),
          status: 'already_initialized',
        },
        null,
        2,
      ),
    );
    return;
  }

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: protocolConfig, isSigner: false, isWritable: true },
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('initialize_protocol'),
      stableMint.toBuffer(),
      lockVaultProgramId.toBuffer(),
      communityPotProgramId.toBuffer(),
      encodeU16LE(1000),
    ]),
  });

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    feePayer: deployer.publicKey,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction);

  const signature = await sendAndConfirmTransaction(connection, transaction, [deployer], {
    commitment: 'confirmed',
  });

  console.log(
    JSON.stringify(
      {
        signature,
        protocolConfig: protocolConfig.toBase58(),
        stableMint: stableMint.toBase58(),
        lockVaultProgramId: lockVaultProgramId.toBase58(),
        communityPotProgramId: communityPotProgramId.toBase58(),
        platformFeeBps: 1000,
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
