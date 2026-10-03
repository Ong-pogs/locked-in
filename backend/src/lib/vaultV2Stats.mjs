import { createHash } from 'node:crypto';
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { appConfig } from '../config.mjs';

// Keep the private connection/seed pattern in lockPosition.mjs in sync.
const CONFIG_SEED = Buffer.from('vault-v2b');
const LOCK_DISCRIMINATOR = createHash('sha256').update('account:LockV2').digest().subarray(0, 8);
const CONFIG_DISCRIMINATOR = createHash('sha256').update('account:VaultV2Config').digest().subarray(0, 8);
// Anchor discriminator, owner, course hash, principal, start time, status, bump.
const LOCK_SIZE = 8 + 32 + 32 + 8 + 8 + 1 + 1;
const PRINCIPAL_OFFSET = 8 + 32 + 32;
const STATUS_OFFSET = PRINCIPAL_OFFSET + 8 + 8;
const ACTIVE = 0;
// VaultV2Config has ten pubkeys and three u64 fields before current_tvl.
const TVL_OFFSET = 8 + 10 * 32 + 3 * 8;
const RPC_TIMEOUT_MS = 6_000;

let connection = null;
function getConnection() {
  if (!connection) connection = new Connection(appConfig.solanaRpcUrl, 'confirmed');
  return connection;
}

async function withRpcTimeout(read) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('STATS_RPC_TIMEOUT')), RPC_TIMEOUT_MS);
  });
  try {
    return await Promise.race([read(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// usdcLocked stays in bigint base units until the repository formats the API.
export async function getVaultV2Stats() {
  const unavailable = { usdcLocked: null, activeLocks: null, learnersEarningYield: null };
  try {
    if (!appConfig.vaultV2ProgramId) return unavailable;
    const programId = new PublicKey(appConfig.vaultV2ProgramId);
    const conn = getConnection();
    try {
      const accounts = await withRpcTimeout(() => conn.getProgramAccounts(programId, {
        filters: [
          { dataSize: LOCK_SIZE },
          { memcmp: { offset: 0, bytes: bs58.encode(LOCK_DISCRIMINATOR) } },
          { memcmp: { offset: STATUS_OFFSET, bytes: bs58.encode(Buffer.from([ACTIVE])) } },
        ],
      }));
      let usdcLocked = 0n;
      let activeLocks = 0;
      const owners = new Set();
      for (const { account } of accounts) {
        const { data } = account;
        if (data.length !== LOCK_SIZE || !data.subarray(0, 8).equals(LOCK_DISCRIMINATOR) || !account.owner.equals(programId)) {
          throw new Error('INVALID_LOCK_V2_ACCOUNT');
        }
        if (data[STATUS_OFFSET] !== ACTIVE) continue;
        usdcLocked += data.readBigUInt64LE(PRINCIPAL_OFFSET);
        activeLocks += 1;
        owners.add(new PublicKey(data.subarray(8, 40)).toBase58());
      }
      return { usdcLocked, activeLocks, learnersEarningYield: owners.size };
    } catch {
      // Some RPC providers disable account scans. Config still exposes TVL.
      const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
      const account = await withRpcTimeout(() => conn.getAccountInfo(configPda));
      if (!account || account.data.length < TVL_OFFSET + 8 ||
          !account.data.subarray(0, 8).equals(CONFIG_DISCRIMINATOR) || !account.owner.equals(programId)) {
        return unavailable;
      }
      return { ...unavailable, usdcLocked: account.data.readBigUInt64LE(TVL_OFFSET) };
    }
  } catch {
    return unavailable;
  }
}
