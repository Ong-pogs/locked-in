// Authenticated mutation routes used to key their rate-limit bucket on the
// client IP — but many users share one NAT egress IP, so a single abuser could
// 429 everyone behind it. These routes now key on a sha256 of the bearer token
// (see src/plugins/rateKey.mjs), giving each session its own bucket. The
// keyGenerator runs in onRequest, BEFORE auth, so it reads the raw token from
// the header rather than request.auth. These tests pin the two properties that
// matter: distinct tokens get INDEPENDENT budgets, and the SAME token shares
// one. The consent route (20/min) is the cheapest to flood.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAccessToken } from '../../helpers/test-auth.mjs';

const CONSENT_URL = '/v1/locks/consent';
const CONSENT_LIMIT = 20;

let app;
beforeAll(async () => { app = await createTestServer(); });
afterAll(async () => { await closeTestServer(app); });

// A minimal well-formed consent body so the handler's 400 path (not a limiter
// 429) is the only reason a pre-limit request could fail — either way it still
// consumes the caller's budget, which is all we assert on.
function consentBody() {
  return { termsVersion: 'test-v1' };
}

async function post(token, payload = consentBody()) {
  return app.inject({
    method: 'POST',
    url: CONSENT_URL,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
}

async function floodUntilLimited(token, attempts = CONSENT_LIMIT * 3) {
  for (let i = 0; i < attempts; i += 1) {
    const response = await post(token);
    if (response.statusCode === 429) return response;
  }
  return null;
}

describe('per-session rate-limit keying on authenticated mutations', () => {
  it('gives two different bearer tokens independent buckets', async () => {
    const tokenA = await getTestAccessToken(generateTestWallet());
    const tokenB = await getTestAccessToken(generateTestWallet());

    // Exhaust A's bucket.
    const limitedA = await floodUntilLimited(tokenA);
    expect(limitedA, 'token A never rate limited').not.toBeNull();
    expect(limitedA.statusCode).toBe(429);

    // B has done nothing, so its first request must not be starved by A.
    const firstB = await post(tokenB);
    expect(firstB.statusCode).not.toBe(429);
  });

  it('shares one bucket across requests with the same bearer token', async () => {
    const token = await getTestAccessToken(generateTestWallet());

    // Every request under the limit accumulates in the one token bucket...
    for (let i = 0; i < CONSENT_LIMIT; i += 1) {
      const response = await post(token);
      expect(response.statusCode, `request ${i} tripped early`).not.toBe(429);
    }

    // ...so the request past the limit trips it.
    const overLimit = await post(token);
    expect(overLimit.statusCode).toBe(429);
  });
});
