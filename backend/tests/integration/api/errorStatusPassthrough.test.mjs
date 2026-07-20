import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';

// Live-prod probe finding: the error handler only honored `HttpError` and
// discarded `error.statusCode` on everything else, so framework-generated 4xx
// became HTTP 500 with code INTERNAL_ERROR:
//   - @fastify/rate-limit's 429 (the faucet is 5/min — a user double-clicking
//     Claim saw "Internal Server Error" instead of a retryable rate-limit),
//   - the JSON body parser's 400 on malformed input.
// Both also logged at error level as "Unhandled server error", which pollutes
// logs and can trip alerting on ordinary client mistakes.

let app;
beforeAll(async () => {
  app = await createTestServer();
});
afterAll(async () => {
  await closeTestServer(app);
});

describe('error handler — framework status passthrough', () => {
  it('returns 400 (not 500) for a malformed JSON body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/challenge',
      headers: { 'content-type': 'application/json' },
      payload: '{"walletAddress": ',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).not.toBe('INTERNAL_ERROR');
    expect(body).toHaveProperty('message');
  });

  it('every error body carries a machine-readable code', async () => {
    // The client's auth fallback branches on `code`, so it must always exist.
    const malformed = await app.inject({
      method: 'POST',
      url: '/v1/auth/challenge',
      headers: { 'content-type': 'application/json' },
      payload: '{"walletAddress": ',
    });
    expect(malformed.json()).toHaveProperty('code');

    const missing = await app.inject({ method: 'GET', url: '/v1/definitely-not-a-route' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toHaveProperty('code');
  });

  it('answers a tripped rate limit with 429, not 500', async () => {
    // /v1/yield/strategy-info opts into the limiter at 60/min. Exhaust it and
    // assert the limiter's own status survives the error handler.
    let tripped = null;
    for (let i = 0; i < 75 && tripped === null; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/v1/yield/strategy-info' });
      if (res.statusCode !== 200) tripped = res;
    }

    expect(tripped, 'rate limit never tripped in 75 requests').not.toBeNull();
    expect(tripped.statusCode).toBe(429);
    expect(tripped.json().code).not.toBe('INTERNAL_ERROR');
    // The client needs this to back off correctly.
    expect(tripped.headers).toHaveProperty('retry-after');
  });
});
