import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { getTestAuthHeaders, generateTestWallet } from '../../helpers/test-auth.mjs';

// 'solana-fundamentals' is seeded by sql/0002_seed_dev_release.sql.
const COURSE_ID = 'solana-fundamentals';

let app;
beforeAll(async () => {
  app = await createTestServer();
});
afterAll(async () => {
  await closeTestServer(app);
});

// Each test uses a fresh wallet, so the runtime row is created with
// defaults (fuel 0, ichor 0, savers 0-used, fire out). That makes every
// outcome here deterministic without seeding.
describe('brewery + shop routes — auth', () => {
  it('GET /v1/progress/brewery is 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/progress/brewery?courseId=${COURSE_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /v1/progress/brewery/feed is 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/progress/brewery/feed',
      payload: { courseId: COURSE_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /v1/progress/shop/buy-saver is 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/progress/shop/buy-saver',
      payload: { courseId: COURSE_ID },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('brewery + shop routes — fresh-wallet behaviour', () => {
  it('GET /v1/progress/brewery returns fresh fire-out state', async () => {
    const headers = await getTestAuthHeaders(generateTestWallet());
    const res = await app.inject({
      method: 'GET',
      url: `/v1/progress/brewery?courseId=${COURSE_ID}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fuelCounter).toBe(0);
    expect(body.fuelCap).toBe(7);
    expect(body.fireLitUntil).toBeNull();
    expect(body.isLit).toBe(false);
    expect(body.saversBanked).toBe(3);
    expect(body.currentYieldRedirectBps).toBe(0);
    expect(body.unclaimedYieldAmount).toBe('0');
    expect(Array.isArray(body.last7Days)).toBe(true);
    expect(body.last7Days.length).toBe(0);
  });

  it('feed with no fuel returns NO_FUEL', async () => {
    const headers = await getTestAuthHeaders(generateTestWallet());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/progress/brewery/feed',
      headers,
      payload: { courseId: COURSE_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(false);
    expect(body.reason).toBe('NO_FUEL');
  });

  it('claim with nothing accrued returns NOTHING_TO_CLAIM', async () => {
    const headers = await getTestAuthHeaders(generateTestWallet());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/progress/brewery/claim',
      headers,
      payload: { courseId: COURSE_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(false);
    expect(body.reason).toBe('NOTHING_TO_CLAIM');
    expect(body.claimedAmount).toBe('0');
  });

  it('buy-saver with full inventory (0 used) returns SAVERS_FULL', async () => {
    const headers = await getTestAuthHeaders(generateTestWallet());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/progress/shop/buy-saver',
      headers,
      payload: { courseId: COURSE_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(false);
    expect(body.reason).toBe('SAVERS_FULL');
  });

  it('feed/claim/buy-saver require courseId in the body', async () => {
    const headers = await getTestAuthHeaders(generateTestWallet());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/progress/brewery/feed',
      headers,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
