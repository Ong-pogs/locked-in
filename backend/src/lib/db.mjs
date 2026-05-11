import pg from 'pg';
import { appConfig } from '../config.mjs';

const { Pool } = pg;

let pool = null;

export function hasDatabase() {
  return Boolean(appConfig.databaseUrl);
}

export function getPool() {
  if (!hasDatabase()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: appConfig.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      // Managed Postgres providers (Render, Supabase, Heroku, RDS) all serve
      // self-signed certs over the encrypted channel — there's no CA chain
      // to verify against. rejectUnauthorized:false keeps TLS on (the wire
      // is encrypted) but skips chain validation, which matches the standard
      // pattern for these platforms. If you ever move to a DB with a public
      // CA, swap to `ssl: { ca: <pem> }`.
      ssl: { rejectUnauthorized: false },
    });
    // Without this listener, an idle-client error (e.g. Supabase pooler dropping
    // an idle connection, EADDRNOTAVAIL during a network blip) becomes an
    // unhandled 'error' event on the Pool and crashes the Node process.
    pool.on('error', (err) => {
      console.error('[db.pool] idle client error:', err?.message ?? err);
    });
  }

  return pool;
}

export async function query(text, params = []) {
  const currentPool = getPool();
  if (!currentPool) {
    throw new Error('DATABASE_URL is not configured');
  }
  return currentPool.query(text, params);
}

async function setWalletClaim(client, walletAddress) {
  await client.query(
    `select set_config('request.jwt.claim.wallet_address', $1, true)`,
    [walletAddress],
  );
}

export async function withTransaction(work) {
  const currentPool = getPool();
  if (!currentPool) {
    throw new Error('DATABASE_URL is not configured');
  }

  const client = await currentPool.connect();
  let releaseError;
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch (rollbackErr) {
      // Rollback failed → connection state is unknown. Capture the rollback
      // error so release(err) discards the client instead of returning it to
      // the pool, but throw the original error (it's the actually useful one).
      releaseError = rollbackErr;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export async function queryAsWallet(walletAddress, text, params = []) {
  return withTransaction(async (client) => {
    await setWalletClaim(client, walletAddress);
    return client.query(text, params);
  });
}

export async function withTransactionAsWallet(walletAddress, work) {
  return withTransaction(async (client) => {
    await setWalletClaim(client, walletAddress);
    return work(client);
  });
}
