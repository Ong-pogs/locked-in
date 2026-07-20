// Auth endpoints had ZERO rate limiting: the plugin is registered
// `global: false`, and only the faucet / check / yield routes opted in. That
// left /v1/auth/challenge, /verify, /privy-session and /refresh open to free
// brute-force (signature and refresh-token guessing) and free JWT-minting
// load. These tests pin that every auth route trips a limiter, and — because
// the error handler owns the 4xx passthrough — that the limiter's 429 and its
// Retry-After header actually reach the client.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet } from '../../helpers/test-auth.mjs';

let app;
beforeAll(async () => { app = await createTestServer(); });
afterAll(async () => { await closeTestServer(app); });

// Each route keys its own bucket, so hammering one never starves another.
async function floodUntilLimited(url, payload, attempts = 120) {
  for (let i = 0; i < attempts; i += 1) {
    const response = await app.inject({ method: 'POST', url, payload: payload() });
    if (response.statusCode === 429) return response;
  }
  return null;
}

describe('auth endpoints are rate limited', () => {
  it('limits POST /v1/auth/challenge', async () => {
    const limited = await floodUntilLimited(
      '/v1/auth/challenge',
      () => ({ walletAddress: generateTestWallet() }),
    );

    expect(limited, 'challenge never rate limited').not.toBeNull();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).not.toBe('INTERNAL_ERROR');
    expect(limited.headers).toHaveProperty('retry-after');
  });

  it('limits POST /v1/auth/verify', async () => {
    // Signature brute-force is the attack here; the bodies below never
    // validate, and an invalid body must still consume the caller's budget.
    const limited = await floodUntilLimited('/v1/auth/verify', () => ({
      walletAddress: generateTestWallet(),
      challengeId: 'a2a0b8f8-0000-4000-8000-000000000000',
      signature: 'not-a-real-signature',
    }));

    expect(limited, 'verify never rate limited').not.toBeNull();
    expect(limited.json().code).not.toBe('INTERNAL_ERROR');
  });

  it('limits POST /v1/auth/privy-session', async () => {
    const limited = await floodUntilLimited('/v1/auth/privy-session', () => ({
      walletAddress: generateTestWallet(),
      privyAccessToken: 'not-a-real-privy-token',
    }));

    expect(limited, 'privy-session never rate limited').not.toBeNull();
    expect(limited.json().code).not.toBe('INTERNAL_ERROR');
  });

  it('limits POST /v1/auth/refresh', async () => {
    const limited = await floodUntilLimited('/v1/auth/refresh', () => ({
      refreshToken: 'not-a-real-refresh-token',
    }));

    expect(limited, 'refresh never rate limited').not.toBeNull();
    expect(limited.json().code).not.toBe('INTERNAL_ERROR');
  });
});
