import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { getTestAuthHeaders, generateTestWallet } from '../../helpers/test-auth.mjs';

let app;
beforeAll(async () => { app = await createTestServer(); });
afterAll(async () => { await closeTestServer(app); });

function createTestKeypair() {
  const keypair = nacl.sign.keyPair();
  const walletAddress = bs58.encode(keypair.publicKey);
  return { keypair, walletAddress };
}

function signMessage(message, secretKey) {
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return bs58.encode(signature);
}

async function authenticateWallet(server, keypair, walletAddress) {
  const challengeResponse = await server.inject({
    method: 'POST',
    url: '/v1/auth/challenge',
    payload: { walletAddress },
  });
  const challenge = challengeResponse.json();
  const signature = signMessage(challenge.message, keypair.secretKey);

  const verifyResponse = await server.inject({
    method: 'POST',
    url: '/v1/auth/verify',
    payload: {
      walletAddress,
      challengeId: challenge.challengeId,
      signature,
    },
  });
  return verifyResponse.json();
}

describe('progress routes - authentication required', () => {
  it('POST /v1/progress/lessons/:id/start returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/progress/lessons/test-lesson/start',
      payload: { attemptId: 'test-attempt' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /v1/progress/xp returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/progress/xp',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /v1/progress/leaderboard returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/progress/leaderboard',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /v1/progress/enrollments returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/progress/enrollments',
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('progress routes - with authentication', () => {
  it('POST /v1/progress/lessons/:id/start creates an attempt', async () => {
    const { keypair, walletAddress } = createTestKeypair();

    // Authenticate through the full flow
    const session = await authenticateWallet(app, keypair, walletAddress);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/progress/lessons/test-lesson-id/start',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
      },
      payload: {
        attemptId: 'test-attempt-001',
        startedAt: new Date().toISOString(),
      },
    });

    // Should succeed (200) or return an error related to DB state (not 401)
    expect(response.statusCode).not.toBe(401);
  });

  it('GET /v1/progress/xp returns xp data with valid auth', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/progress/xp',
      headers,
    });

    // Should not be 401 - auth passed
    expect(response.statusCode).not.toBe(401);
  });

  // Longer timeout: with no snapshot the leaderboard computes live with one
  // devnet RPC per runtime row, and parallel test files add rows to the
  // shared DB while this runs.
  it('GET /v1/progress/leaderboard returns data with valid auth', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/progress/leaderboard',
      headers,
    });

    expect(response.statusCode).not.toBe(401);
  }, 90_000);

  it('GET /v1/progress/enrollments returns data with valid auth', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/progress/enrollments',
      headers,
    });

    expect(response.statusCode).not.toBe(401);
  });
});
