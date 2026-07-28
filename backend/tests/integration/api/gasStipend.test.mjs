import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';
import { query } from '../../../src/lib/db.mjs';
import { appConfig } from '../../../src/config.mjs';
import { __setTransferSolForTests } from '../../../src/lib/solDrip.mjs';

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
  __setTransferSolForTests(null);
});

describe('POST /v1/wallet/gas-stipend', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/wallet/gas-stipend' });
    expect(res.statusCode).toBe(401);
  });

  it('drips to the SESSION wallet and ignores any wallet in the body', async () => {
    const sessionWallet = trackedWallet();
    const attackerTarget = trackedWallet();
    const transfer = vi.fn().mockResolvedValue({ signature: 'test-sig-1' });
    __setTransferSolForTests(transfer);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/wallet/gas-stipend',
      headers: await getTestAuthHeaders(sessionWallet),
      payload: { walletAddress: attackerTarget },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('dripped');
    // The transfer went to the JWT wallet, never the body's address.
    expect(transfer).toHaveBeenCalledWith(sessionWallet, appConfig.solDripLamports);
    const rows = await query(`SELECT wallet_address FROM lesson.sol_drips WHERE wallet_address = $1`, [
      attackerTarget,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('is idempotent — second call reports already_dripped without a second transfer', async () => {
    const wallet = trackedWallet();
    const transfer = vi.fn().mockResolvedValue({ signature: 'test-sig-2' });
    __setTransferSolForTests(transfer);
    const headers = await getTestAuthHeaders(wallet);

    const first = await app.inject({ method: 'POST', url: '/v1/wallet/gas-stipend', headers });
    expect(first.json().status).toBe('dripped');

    const second = await app.inject({ method: 'POST', url: '/v1/wallet/gas-stipend', headers });
    expect(second.json().status).toBe('already_dripped');
    expect(transfer).toHaveBeenCalledTimes(1);
  });

  it('fails closed with 503 when the drip is unconfigured', async () => {
    const wallet = trackedWallet();
    const original = appConfig.lockVaultWorkerPrivateKey;
    appConfig.lockVaultWorkerPrivateKey = '';
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/wallet/gas-stipend',
        headers: await getTestAuthHeaders(wallet),
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('GAS_STIPEND_UNCONFIGURED');
    } finally {
      appConfig.lockVaultWorkerPrivateKey = original;
    }
  });
});
