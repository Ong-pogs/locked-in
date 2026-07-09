import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import nacl from 'tweetnacl';
import bs58Module from 'bs58';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { getTestAuthHeaders, generateTestWallet } from '../../helpers/test-auth.mjs';
import { query } from '../../../src/lib/db.mjs';

const bs58 = bs58Module.decode ? bs58Module : bs58Module.default;

const COURSE_ID = 'test-kitchen'; // smallest seeded course (1 module, 3 lessons)
const PROGRAM_ID = process.env.VAULT_V2_PROGRAM_ID;
const WORKER_PUBKEY = new PublicKey(
  bs58.decode(process.env.LOCK_VAULT_WORKER_PRIVATE_KEY).slice(32),
).toBase58();
const LOCK_SEED = Buffer.from('lock-v2');
const VOUCHER_DOMAIN = 'lockedin:claim:v1';

// Client-side derivation the frontend uses — must match the backend byte-for-byte.
function clientCourseHash(courseId) {
  return createHash('sha256').update(courseId, 'utf8').digest();
}
function clientLockPda(owner, courseId) {
  const [pda] = PublicKey.findProgramAddressSync(
    [LOCK_SEED, new PublicKey(owner).toBuffer(), clientCourseHash(courseId)],
    new PublicKey(PROGRAM_ID),
  );
  return pda.toBase58();
}

async function seedCourseComplete(wallet, courseId) {
  const lessons = await query(
    `SELECT DISTINCT pl.lesson_id
       FROM lesson.published_modules pm
       JOIN lesson.published_lessons pl
         ON pl.module_id = pm.module_id AND pl.release_id = pm.release_id
      WHERE pm.course_id = $1`,
    [courseId],
  );
  for (const { lesson_id } of lessons.rows) {
    await query(
      `INSERT INTO lesson.user_lesson_progress (wallet_address, lesson_id, completed, completed_at, updated_at)
       VALUES ($1, $2, true, now(), now())
       ON CONFLICT (wallet_address, lesson_id)
       DO UPDATE SET completed = true, completed_at = now(), updated_at = now()`,
      [wallet, lesson_id],
    );
  }
  return lessons.rows.length;
}

async function setLapseCount(wallet, courseId, count) {
  await query(
    `INSERT INTO lesson.user_course_runtime_state (wallet_address, course_id, fuel_cap, lapse_count)
     VALUES ($1, $2, 7, $3)
     ON CONFLICT (wallet_address, course_id) DO UPDATE SET lapse_count = $3`,
    [wallet, courseId, count],
  );
}

let app;
beforeAll(async () => { app = await createTestServer(); });
afterAll(async () => { await closeTestServer(app); });

describe('POST /v1/progress/courses/:courseId/voucher', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/progress/courses/${COURSE_ID}/voucher`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown course', async () => {
    const headers = await getTestAuthHeaders(generateTestWallet());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/progress/courses/course-that-does-not-exist/voucher',
      headers,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('COURSE_NOT_FOUND');
  });

  it('refuses a voucher when the course is not complete', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/progress/courses/${COURSE_ID}/voucher`,
      headers,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('COURSE_NOT_COMPLETE');
  });

  it('issues an on-chain-valid voucher for a completed course (0 lapses -> 100%)', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    const n = await seedCourseComplete(wallet, COURSE_ID);
    expect(n).toBeGreaterThan(0);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/progress/courses/${COURSE_ID}/voucher`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const v = res.json();

    expect(v.bps).toBe(10_000);
    expect(v.lapseCount).toBe(0);
    expect(v.authorityPubkey).toBe(WORKER_PUBKEY);
    // Lock PDA must equal the client-derived PDA (identical course hash + seeds).
    expect(v.lock).toBe(clientLockPda(wallet, COURSE_ID));

    const message = Buffer.from(v.message, 'base64');
    const signature = Buffer.from(v.signature, 'base64');
    // The exact check the Ed25519 precompile performs on-chain.
    expect(
      nacl.sign.detached.verify(message, signature, new PublicKey(v.authorityPubkey).toBytes()),
    ).toBe(true);
    // Message must carry this program, this lock, and bps=10000.
    expect(message.subarray(0, 17).toString('utf8')).toBe(VOUCHER_DOMAIN);
    expect(message.subarray(17, 49).equals(new PublicKey(PROGRAM_ID).toBuffer())).toBe(true);
    expect(message.subarray(49, 81).equals(new PublicKey(v.lock).toBuffer())).toBe(true);
    expect(message.readUInt16LE(81)).toBe(10_000);
  });

  it('reflects the one-mercy lapse tiers (1 -> 50%, 2+ -> 0%)', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await seedCourseComplete(wallet, COURSE_ID);

    await setLapseCount(wallet, COURSE_ID, 1);
    let res = await app.inject({ method: 'POST', url: `/v1/progress/courses/${COURSE_ID}/voucher`, headers });
    expect(res.json().bps).toBe(5_000);

    await setLapseCount(wallet, COURSE_ID, 3);
    res = await app.inject({ method: 'POST', url: `/v1/progress/courses/${COURSE_ID}/voucher`, headers });
    expect(res.json().bps).toBe(0);
  });

  // Regression for the audit finding: the REAL miss handler (not a direct SQL
  // write) must advance lapse_count so the voucher tier drops. Fresh runtime
  // starts with 3 shields; 3 misses burn them, the 4th opens a lapse.
  it('the real miss handler feeds lapse_count -> voucher tier drops (audit HIGH)', async () => {
    const wallet = generateTestWallet();
    const headers = await getTestAuthHeaders(wallet);
    await seedCourseComplete(wallet, COURSE_ID);
    // Materialize the runtime row with default shields=3.
    await query(
      `INSERT INTO lesson.user_course_runtime_state (wallet_address, course_id, fuel_cap)
       VALUES ($1, $2, 7) ON CONFLICT (wallet_address, course_id) DO NOTHING`,
      [wallet, COURSE_ID],
    );

    let before = await app.inject({ method: 'POST', url: `/v1/progress/courses/${COURSE_ID}/voucher`, headers });
    expect(before.json().bps).toBe(10_000); // no lapses yet

    for (let i = 0; i < 4; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/internal/consequences/miss',
        headers: { 'x-scheduler-key': process.env.SCHEDULER_SECRET },
        payload: { walletAddress: wallet, courseId: COURSE_ID, missEventId: `miss-${i}`, missDay: `2026-08-0${i + 1}` },
      });
      expect(res.statusCode).toBe(200);
    }

    const row = await query(
      `SELECT shields, lapse_count FROM lesson.user_course_runtime_state WHERE wallet_address = $1 AND course_id = $2`,
      [wallet, COURSE_ID],
    );
    expect(Number(row.rows[0].shields)).toBe(0);
    expect(Number(row.rows[0].lapse_count)).toBe(1);

    const after = await app.inject({ method: 'POST', url: `/v1/progress/courses/${COURSE_ID}/voucher`, headers });
    expect(after.json().bps).toBe(5_000); // one lapse -> keep 50%
  });
});
