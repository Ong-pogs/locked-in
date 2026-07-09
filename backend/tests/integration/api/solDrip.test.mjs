import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet } from '../../helpers/test-auth.mjs';
import { query } from '../../../src/lib/db.mjs';
import { appConfig } from '../../../src/config.mjs';
import { __setTransferSolForTests } from '../../../src/lib/solDrip.mjs';

const SCHEDULER_HEADERS = { 'x-scheduler-key': process.env.SCHEDULER_SECRET };

let app;
const testWallets = [];

function trackedWallet() {
  const wallet = generateTestWallet();
  testWallets.push(wallet);
  return wallet;
}

beforeAll(async () => {
  app = await createTestServer();
});

afterAll(async () => {
  if (testWallets.length > 0) {
    await query(`DELETE FROM lesson.sol_drips WHERE wallet_address = ANY($1)`, [testWallets]);
  }
  await closeTestServer(app);
});

afterEach(() => {
  __setTransferSolForTests(null); // restore the real transfer
});

describe('POST /v1/internal/sol-drip', () => {
  it('rejects requests without a scheduler key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/sol-drip',
      payload: { walletAddress: trackedWallet() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with a wrong scheduler key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/sol-drip',
      headers: { 'x-scheduler-key': 'not-the-secret' },
      payload: { walletAddress: trackedWallet() },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_SCHEDULER_KEY');
  });

  it('rejects a missing wallet address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/sol-drip',
      headers: SCHEDULER_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed wallet address before touching the DB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/sol-drip',
      headers: SCHEDULER_HEADERS,
      payload: { walletAddress: 'definitely-not-base58!!!' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_WALLET_ADDRESS');
  });

  it('drips once, then returns already_dripped — transfer runs exactly once', async () => {
    const wallet = trackedWallet();
    const transfer = vi.fn(async () => ({ signature: 'mock-sig-123' }));
    __setTransferSolForTests(transfer);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/internal/sol-drip',
      headers: SCHEDULER_HEADERS,
      payload: { walletAddress: wallet },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: 'dripped', signature: 'mock-sig-123' });

    const second = await app.inject({
      method: 'POST',
      url: '/v1/internal/sol-drip',
      headers: SCHEDULER_HEADERS,
      payload: { walletAddress: wallet },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ status: 'already_dripped' });

    expect(transfer).toHaveBeenCalledTimes(1);
    expect(transfer).toHaveBeenCalledWith(wallet, appConfig.solDripLamports);

    // The row must carry the signature (a replayed crash can't re-pay).
    const row = await query(
      `SELECT signature, lamports FROM lesson.sol_drips WHERE wallet_address = $1`,
      [wallet],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].signature).toBe('mock-sig-123');
    expect(Number(row.rows[0].lamports)).toBe(appConfig.solDripLamports);
  });

  it('a failed transfer releases the reservation so the wallet can retry', async () => {
    const wallet = trackedWallet();
    __setTransferSolForTests(async () => {
      throw new Error('rpc down');
    });

    const failed = await app.inject({
      method: 'POST',
      url: '/v1/internal/sol-drip',
      headers: SCHEDULER_HEADERS,
      payload: { walletAddress: wallet },
    });
    expect(failed.statusCode).toBe(500);

    // No row left behind — the retry may pay.
    const rows = await query(`SELECT 1 FROM lesson.sol_drips WHERE wallet_address = $1`, [wallet]);
    expect(rows.rows).toHaveLength(0);

    __setTransferSolForTests(async () => ({ signature: 'retry-sig' }));
    const retried = await app.inject({
      method: 'POST',
      url: '/v1/internal/sol-drip',
      headers: SCHEDULER_HEADERS,
      payload: { walletAddress: wallet },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({ status: 'dripped', signature: 'retry-sig' });
  });

  it('refuses with cap_reached once the global row count hits the cap', async () => {
    const originalCap = appConfig.solDripMaxTotal;
    const filler = trackedWallet();
    const blocked = trackedWallet();
    const transfer = vi.fn(async () => ({ signature: 'cap-sig' }));
    __setTransferSolForTests(transfer);
    try {
      // Existing drips in the table (other tests, prior rows) + the filler
      // consume the whole cap; the next wallet must be refused.
      await app.inject({
        method: 'POST',
        url: '/v1/internal/sol-drip',
        headers: SCHEDULER_HEADERS,
        payload: { walletAddress: filler },
      });
      const { rows } = await query(`SELECT count(*)::int AS n FROM lesson.sol_drips`);
      appConfig.solDripMaxTotal = rows[0].n;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/internal/sol-drip',
        headers: SCHEDULER_HEADERS,
        payload: { walletAddress: blocked },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'cap_reached' });

      // The refused wallet must not leave a row behind.
      const leftover = await query(
        `SELECT 1 FROM lesson.sol_drips WHERE wallet_address = $1`,
        [blocked],
      );
      expect(leftover.rows).toHaveLength(0);
      expect(transfer).toHaveBeenCalledTimes(1); // only the filler paid
    } finally {
      appConfig.solDripMaxTotal = originalCap;
    }
  });
});
