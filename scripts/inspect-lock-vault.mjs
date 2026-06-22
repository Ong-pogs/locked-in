import fs from 'fs';
import crypto from 'crypto';
import {
  clusterApiUrl,
  Connection, PublicKey,
} from '@solana/web3.js';
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const LOCK_ACCOUNT_DISCRIMINATOR = Buffer.from('df40477cff5676c0', 'hex');
const LOCK_SEED = Buffer.from('lock');

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

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;

    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }
  return args;
}

function hashCourseId(courseId) {
  return crypto.createHash('sha256').update(courseId).digest();
}

function formatTokenAmount(amount, decimals) {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;

  if (fraction === 0n) {
    return whole.toString();
  }

  const paddedFraction = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${paddedFraction}`;
}

function timestampToIso(value) {
  if (value <= 0n) return null;
  const milliseconds = Number(value) * 1000;
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15) {
    return null;
  }

  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

function dayIndexToIsoDate(value) {
  if (value < 0n) return null;
  const milliseconds = Number(value) * 86_400_000;
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15) {
    return null;
  }

  try {
    return new Date(milliseconds).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function toJsonReady(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonReady(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, toJsonReady(entryValue)]),
    );
  }

  return value;
}

function decodeLockAccount(data) {
  let offset = 8;
  const readPubkey = () => {
    const value = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    return value.toBase58();
  };
  const readU64 = () => {
    const value = data.readBigUInt64LE(offset);
    offset += 8;
    return value;
  };
  const readI64 = () => {
    const value = data.readBigInt64LE(offset);
    offset += 8;
    return value;
  };
  const readU8 = () => {
    const value = data.readUInt8(offset);
    offset += 1;
    return value;
  };
  const readBool = () => readU8() === 1;
  const readU16 = () => {
    const value = data.readUInt16LE(offset);
    offset += 2;
    return value;
  };
  const readFixedHex = (size) => {
    const value = Buffer.from(data.subarray(offset, offset + size)).toString('hex');
    offset += size;
    return value;
  };

  // v4 custody-only LockAccount (130 bytes / 8 fields). Game state
  // (streak/fuel/ichor/savers) is off-chain; SKR was removed entirely.
  return {
    owner: readPubkey(),
    courseIdHash: readFixedHex(32),
    stableMint: readPubkey(),
    principalAmount: readU64(),
    lockStartTs: readI64(),
    lockEndTs: readI64(),
    status: readU8(),
    bump: readU8(),
  };
}

async function enrichDecodedLock(connection, decoded) {
  const stableMint = await fetchMintMetadata(connection, decoded.stableMint);

  return {
    ...decoded,
    principalAmountUi:
      stableMint?.decimals != null
        ? formatTokenAmount(decoded.principalAmount, stableMint.decimals)
        : decoded.principalAmount.toString(),
    lockStartDate: timestampToIso(decoded.lockStartTs),
    lockEndDate: timestampToIso(decoded.lockEndTs),
    stableMintMetadata: stableMint,
  };
}

async function fetchMintMetadata(connection, mintAddress) {
  const mintPubkey = new PublicKey(mintAddress);
  const accountInfo = await connection.getAccountInfo(mintPubkey, 'confirmed');
  if (!accountInfo) {
    return {
      address: mintAddress,
      found: false,
      error: 'Mint account not found',
    };
  }

  const tokenProgramId = accountInfo.owner;
  if (!tokenProgramId.equals(TOKEN_PROGRAM_ID) && !tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)) {
    return {
      address: mintAddress,
      found: false,
      ownerProgram: tokenProgramId.toBase58(),
      error: 'Account is not owned by an SPL token program',
    };
  }

  const mint = await getMint(connection, mintPubkey, 'confirmed', tokenProgramId);
  return {
    address: mintAddress,
    found: true,
    ownerProgram: tokenProgramId.toBase58(),
    decimals: mint.decimals,
    supply: mint.supply.toString(),
  };
}

async function inspectSpecificLock(connection, programId, walletAddress, courseId) {
  const owner = new PublicKey(walletAddress);
  const [lockAccount] = PublicKey.findProgramAddressSync(
    [LOCK_SEED, owner.toBuffer(), hashCourseId(courseId)],
    programId,
  );

  const accountInfo = await connection.getAccountInfo(lockAccount, 'confirmed');
  if (!accountInfo) {
    throw new Error(`No lock account found at ${lockAccount.toBase58()}`);
  }

  if (!accountInfo.data.subarray(0, 8).equals(LOCK_ACCOUNT_DISCRIMINATOR)) {
    throw new Error('Account exists but is not a LockAccount discriminator match.');
  }

  const decoded = decodeLockAccount(accountInfo.data);
  const enriched = await enrichDecodedLock(connection, decoded);

  console.log(
    JSON.stringify(
      toJsonReady({
        lockAccount: lockAccount.toBase58(),
        ...enriched,
        courseId,
      }),
      null,
      2,
    ),
  );
}

async function inspectAllLocks(connection, programId) {
  const accounts = await connection.getProgramAccounts(programId, 'confirmed');
  const lockAccounts = accounts.filter(({ account }) =>
    account.data.subarray(0, 8).equals(LOCK_ACCOUNT_DISCRIMINATOR),
  );

  const decodedLocks = await Promise.all(
    lockAccounts.map(async ({ pubkey, account }) => ({
      lockAccount: pubkey.toBase58(),
      ...(await enrichDecodedLock(connection, decodeLockAccount(account.data))),
    })),
  );

  console.log(JSON.stringify(toJsonReady(decodedLocks), null, 2));
}

async function main() {
  const env = readEnvFile();

  const args = parseArgs(process.argv.slice(2));
  const rpcUrl = env.EXPO_PUBLIC_SOLANA_RPC_URL || clusterApiUrl('devnet');
  const connection = new Connection(rpcUrl, 'confirmed');
  const programId = new PublicKey(env.EXPO_PUBLIC_LOCK_VAULT_PROGRAM_ID);

  if (args.wallet && args.course) {
    await inspectSpecificLock(connection, programId, args.wallet, args.course);
    return;
  }

  await inspectAllLocks(connection, programId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
