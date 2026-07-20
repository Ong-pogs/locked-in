// Real-money support trail. Before this, executeClaim was 100% client-side and
// lesson.completion_vouchers only recorded the voucher we ISSUED — so "my claim
// failed" was unanswerable, and "I never agreed to those terms" was unfalsifiable.
// POST /v1/locks/:courseId/claim-result records every claim attempt (phase,
// signature, error) and POST /v1/locks/consent records deposit consent.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { getTestAuthHeaders, generateTestWallet } from '../../helpers/test-auth.mjs';
import { query } from '../../../src/lib/db.mjs';

const COURSE_ID = 'test-kitchen';

let app;
beforeAll(async () => { app = await createTestServer(); });
afterAll(async () => { await closeTestServer(app); });

async function attemptRows(wallet) {
  const res = await query(
    `select phase, signature, error_message from lesson.claim_attempts
     where wallet_address = $1 order by created_at`,
    [wallet],
  );
  return res.rows;
}

async function consentRows(wallet) {
  const res = await query(
    `select terms_version, accepted_at from lesson.user_consents
     where wallet_address = $1`,
    [wallet],
  );
  return res.rows;
}

describe('POST /v1/locks/:courseId/claim-result', () => {
  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/claim-result`,
      payload: { phase: 'submitted' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('records a submitted attempt with its signature', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    const signature = '5'.repeat(88);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/claim-result`,
      headers,
      payload: { phase: 'submitted', signature },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recorded: true });

    const rows = await attemptRows(wallet);
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe('submitted');
    expect(rows[0].signature).toBe(signature);
  });

  it('records a failure with its error message', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/claim-result`,
      headers,
      payload: { phase: 'failed', errorMessage: 'Wallet error 4100: unauthorized signer' },
    });

    const rows = await attemptRows(wallet);
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe('failed');
    expect(rows[0].error_message).toContain('4100');
  });

  it('rejects an unknown phase', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/claim-result`,
      headers,
      payload: { phase: 'whatever' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_CLAIM_PHASE');
    expect(await attemptRows(wallet)).toHaveLength(0);
  });

  it('rejects an unknown course', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/locks/no-such-course/claim-result',
      headers,
      payload: { phase: 'started' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('COURSE_NOT_FOUND');
  });

  it('truncates an oversized error message instead of failing the claim flow', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/claim-result`,
      headers,
      payload: { phase: 'failed', errorMessage: 'x'.repeat(5000) },
    });

    expect(response.statusCode).toBe(200);
    const rows = await attemptRows(wallet);
    expect(rows[0].error_message.length).toBeLessThanOrEqual(1000);
  });

  it('records the wallet from the token, never one supplied in the body', async () => {
    const wallet = generateTestWallet();
    const impersonated = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    await app.inject({
      method: 'POST',
      url: `/v1/locks/${COURSE_ID}/claim-result`,
      headers,
      payload: { phase: 'started', walletAddress: impersonated },
    });

    expect(await attemptRows(wallet)).toHaveLength(1);
    expect(await attemptRows(impersonated)).toHaveLength(0);
  });
});

describe('POST /v1/locks/consent', () => {
  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/locks/consent',
      payload: { termsVersion: '2026-07-20' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('records the accepted terms version', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    const acceptedAt = '2026-07-19T10:00:00.000Z';

    const response = await app.inject({
      method: 'POST',
      url: '/v1/locks/consent',
      headers,
      payload: { termsVersion: '2026-07-20', acceptedAt },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recorded: true, termsVersion: '2026-07-20' });

    const rows = await consentRows(wallet);
    expect(rows).toHaveLength(1);
    expect(rows[0].terms_version).toBe('2026-07-20');
    expect(new Date(rows[0].accepted_at).toISOString()).toBe(acceptedAt);
  });

  it('is idempotent and keeps the FIRST acceptance timestamp', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    const first = '2026-07-19T10:00:00.000Z';

    await app.inject({
      method: 'POST',
      url: '/v1/locks/consent',
      headers,
      payload: { termsVersion: '2026-07-20', acceptedAt: first },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/locks/consent',
      headers,
      payload: { termsVersion: '2026-07-20', acceptedAt: '2026-07-20T11:00:00.000Z' },
    });

    expect(second.statusCode).toBe(200);
    const rows = await consentRows(wallet);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].accepted_at).toISOString()).toBe(first);
  });

  it('rejects a missing termsVersion', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/locks/consent',
      headers,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('MISSING_TERMS_VERSION');
  });

  it('rejects an unparseable acceptedAt', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/locks/consent',
      headers,
      payload: { termsVersion: '2026-07-20', acceptedAt: 'yesterday' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_ACCEPTED_AT');
  });

  it('clamps a future acceptedAt to server time (client clock skew)', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    const future = new Date(Date.now() + 86_400_000).toISOString();

    await app.inject({
      method: 'POST',
      url: '/v1/locks/consent',
      headers,
      payload: { termsVersion: '2026-07-20', acceptedAt: future },
    });

    const rows = await consentRows(wallet);
    expect(new Date(rows[0].accepted_at).getTime()).toBeLessThan(new Date(future).getTime());
  });
});

describe('audit endpoints are rate limited', () => {
  it('limits POST /v1/locks/consent', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);

    let limited = null;
    for (let i = 0; i < 60 && limited === null; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/locks/consent',
        headers,
        payload: { termsVersion: `flood-${i}` },
      });
      if (response.statusCode === 429) limited = response;
    }

    expect(limited, 'consent never rate limited').not.toBeNull();
    expect(limited.json().code).not.toBe('INTERNAL_ERROR');
  });
});
