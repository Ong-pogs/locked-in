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

export async function withTransaction(work) {
  const currentPool = getPool();
  if (!currentPool) {
    throw new Error('DATABASE_URL is not configured');
  }

  const client = await currentPool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
