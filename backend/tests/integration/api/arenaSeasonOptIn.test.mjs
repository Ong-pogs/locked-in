// Opt-in guards. Every one of these protects a user from a stake that could
// never be collected, or from being staked without a live position.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';
import { __setLockV2FreshReadOverride } from '../../../src/lib/lockPosition.mjs';

let app;
let db;

const COURSE = 'test-kitchen';
const LOCK = 'Lock1111111111111111111111111111111111111';
const SEASON = 101;

const activeLock = (over = {}) => ({
  mismatch: false,
  status: 'ACTIVE',
  principal: 10_000_000n,
  lockStartTs: 0,
  lockAddress: LOCK,
  ...over,
});

// Exactly one season may be OPEN (arena_seasons_single_open_idx), and the suite
// shares one database with the sweep and the other season tests — so close
// whatever else is open before claiming the slot.
async function openOurSeason() {
  await db.query(`update arena.seasons set status = 'SETTLED' where status = 'OPEN' and id <> $1`, [SEASON]);
  await db.query(
    `insert into arena.seasons (id, starts_at, ends_at, status)
     values ($1, now() - interval '1 day', now() + interval '29 days', 'OPEN')
     on conflict (id) do update set status = 'OPEN',
       starts_at = excluded.starts_at, ends_at = excluded.ends_at`,
    [SEASON],
  );
}

async function stake(wallet, body) {
  return app.inject({
    method: 'POST',
    url: '/v1/arena/stake',
    headers: await getTestAuthHeaders(wallet),
    payload: body,
  });
}

beforeAll(async () => {
  app = await createTestServer();
  db = await import('../../../src/lib/db.mjs');
});

afterAll(async () => {
  __setLockV2FreshReadOverride(null);
  await closeTestServer(app);
});

beforeEach(openOurSeason);

describe('POST /v1/arena/stake', () => {
  it('refuses a wallet with no live lock', async () => {
    __setLockV2FreshReadOverride(async () => null);
    const res = await stake(generateTestWallet(), { courseId: COURSE, consentVersion: 'v1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ARENA_STAKE_NO_LOCK');
  });

  it('refuses a CLOSED lock', async () => {
    __setLockV2FreshReadOverride(async () => activeLock({ status: 'CLOSED' }));
    const res = await stake(generateTestWallet(), { courseId: COURSE, consentVersion: 'v1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ARENA_STAKE_NO_LOCK');
  });

  it('refuses a lock with zero principal', async () => {
    __setLockV2FreshReadOverride(async () => activeLock({ principal: 0n }));
    const res = await stake(generateTestWallet(), { courseId: COURSE, consentVersion: 'v1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ARENA_STAKE_NO_LOCK');
  });

  it('refuses a lock whose on-chain owner does not match', async () => {
    __setLockV2FreshReadOverride(async () => ({ mismatch: true, reason: 'LOCK_OWNER_MISMATCH' }));
    const res = await stake(generateTestWallet(), { courseId: COURSE, consentVersion: 'v1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ARENA_STAKE_NO_LOCK');
  });

  it('accepts an ACTIVE lock and binds immediately', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    const res = await stake(generateTestWallet(), { courseId: COURSE, consentVersion: 'v1' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.created).toBe(true);
    expect(body.entry.outcome).toBe('PENDING');
    expect(body.entry.lockAddress).toBe(LOCK);
    // Binding is at opt-in, not after N matches: zero matches played and the
    // entry already exists and is PENDING.
    expect(body.season.id).toBe(SEASON);
  });

  it('is idempotent — a second opt-in returns the same entry', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    const wallet = generateTestWallet();
    const first = await stake(wallet, { courseId: COURSE, consentVersion: 'v1' });
    const second = await stake(wallet, { courseId: COURSE, consentVersion: 'v1' });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().created).toBe(false);
    expect(second.json().entry.optedInAt).toBe(first.json().entry.optedInAt);
  });

  it('refuses a course that is already complete', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    const wallet = generateTestWallet();
    await db.query(
      `insert into lesson.user_course_runtime_state (wallet_address, course_id, fuel_cap, course_completed_at)
       values ($1, $2, 7, now())
       on conflict (wallet_address, course_id) do update set course_completed_at = now()`,
      [wallet, COURSE],
    );
    const res = await stake(wallet, { courseId: COURSE, consentVersion: 'v1' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ARENA_STAKE_COURSE_SETTLED');
  });

  it('requires a consent version', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    const res = await stake(generateTestWallet(), { courseId: COURSE });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CONSENT_VERSION_REQUIRED');
  });

  it('requires a course id', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    const res = await stake(generateTestWallet(), { consentVersion: 'v1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('COURSE_ID_REQUIRED');
  });

  it('refuses when no season is open', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    await db.query(`update arena.seasons set status = 'SETTLED' where status = 'OPEN'`);
    const res = await stake(generateTestWallet(), { courseId: COURSE, consentVersion: 'v1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ARENA_SEASON_CLOSED');
  });
});

describe('GET /v1/arena/stake', () => {
  it('is null for a wallet that never staked', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/arena/stake',
      headers: await getTestAuthHeaders(generateTestWallet()),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('reports a live zero delta for a staked wallet that has played nothing', async () => {
    __setLockV2FreshReadOverride(async () => activeLock());
    const wallet = generateTestWallet();
    await stake(wallet, { courseId: COURSE, consentVersion: 'v1' });

    const res = await app.inject({
      method: 'GET', url: '/v1/arena/stake', headers: await getTestAuthHeaders(wallet),
    });
    const body = res.json();
    expect(body.outcome).toBe('PENDING');
    // Zero is safe: playing nothing must never look like losing.
    expect(body.stakedDelta).toBe(0);
    expect(body.matchesCounted).toBe(0);
    expect(body.courseId).toBe(COURSE);
  });
});

describe('GET /v1/arena/season', () => {
  it('serves the open season without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/arena/season' });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(SEASON);
    expect(res.json().status).toBe('OPEN');
  });
});
