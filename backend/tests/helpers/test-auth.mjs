import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';

export function generateTestWallet() {
  const bytes = randomBytes(32);
  return bs58.encode(bytes);
}

export async function getTestAuthHeaders(walletAddress) {
  // Import dynamically so env.mjs has run first
  const { signAccessToken } = await import('../../src/lib/jwt.mjs');
  const token = await signAccessToken(walletAddress);
  return {
    authorization: `Bearer ${token}`,
  };
}

export async function getTestAccessToken(walletAddress) {
  const { signAccessToken } = await import('../../src/lib/jwt.mjs');
  return signAccessToken(walletAddress);
}

/**
 * Enroll a wallet on a course for tests.
 *
 * Lessons are gated on a staked course (assertLessonStakeAccess): in
 * production, lesson.user_course_enrollments is written ONLY by
 * enrollActiveLockServerSide after verifying an ACTIVE on-chain lock. Tests
 * that exercise the lesson path must therefore establish the same
 * precondition — this helper is the test-side stand-in for "the user
 * deposited", and it is the only place tests should write that row.
 */
export async function enrollWalletForTest(query, walletAddress, courseId) {
  await query(
    `insert into lesson.user_course_enrollments (wallet_address, course_id)
     values ($1, $2)
     on conflict (wallet_address, course_id) do nothing`,
    [walletAddress, courseId],
  );
}
