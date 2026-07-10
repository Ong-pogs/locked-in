import { PublicKey } from '@solana/web3.js';
import { badRequest, HttpError } from '../../lib/errors.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import { hasPositionConfig, readLockPosition } from '../../lib/lockPosition.mjs';
import { hasDatabase, queryAsWallet } from '../../lib/db.mjs';
import {
  assertCourseLockable,
  enrollActiveLockServerSide,
  getStoredCompletionVoucher,
} from '../progress/repository.mjs';

// Lazy-heal throttle (enroll ruling R14): at most one heal attempt per
// `${wallet}:${courseId}` per 10 minutes, fired from the position reader when
// an ACTIVE lock has no enrollment row. The heal re-runs every enroll gate on
// a FRESH on-chain read — a cached position can trigger, but never decide, it.
const HEAL_THROTTLE_MS = 10 * 60 * 1000;
const healAttemptedAt = new Map();

function shouldAttemptHeal(walletAddress, courseId) {
  const key = `${walletAddress}:${courseId}`;
  const last = healAttemptedAt.get(key);
  if (last != null && Date.now() - last < HEAL_THROTTLE_MS) return false;
  healAttemptedAt.set(key, Date.now());
  return true;
}

function assertCourseIdParam(request) {
  const courseId = request.params?.courseId;
  if (!courseId || typeof courseId !== 'string') {
    throw badRequest('Missing path parameter: courseId');
  }
  return courseId;
}

export async function locksRoutes(app) {
  // Live lock position for the authenticated wallet (spec §4.2 position
  // reader). status is authoritative for the CLAIM CTA; liveValueUi is the
  // headline number on the course card (null when the rate is unreadable).
  //
  // Server lazy heal (enroll ruling R14): every course-card render of an
  // ACTIVE lock self-repairs a missing enrollment — fire-and-forget, never
  // blocking or failing the position response.
  app.get(
    '/v1/locks/:courseId/position',
    { preHandler: requireAccessAuth },
    async (request) => {
      const courseId = assertCourseIdParam(request);
      if (!hasPositionConfig()) {
        throw new HttpError(503, 'Position reader is not configured', 'POSITION_UNCONFIGURED');
      }
      const walletAddress = request.auth.walletAddress;
      const position = await readLockPosition(walletAddress, courseId);

      if (position?.status === 'ACTIVE' && hasDatabase()) {
        try {
          const enrolled = await queryAsWallet(
            walletAddress,
            `select 1 from lesson.user_course_enrollments
             where wallet_address = $1 and course_id = $2
             limit 1`,
            [walletAddress, courseId],
          );
          if (enrolled.rowCount === 0 && shouldAttemptHeal(walletAddress, courseId)) {
            enrollActiveLockServerSide(walletAddress, courseId, {
              log: request.log,
            }).catch((error) => {
              request.log.warn(
                {
                  walletAddress,
                  courseId,
                  error: error instanceof Error ? error.message : String(error),
                },
                'locks.enroll.heal_failed',
              );
            });
          }
        } catch (error) {
          request.log.warn(
            {
              walletAddress,
              courseId,
              error: error instanceof Error ? error.message : String(error),
            },
            'locks.enroll.heal_failed',
          );
        }
      }

      // Voucher embed (voucher-autoissue ruling R6): only an ACTIVE lock is
      // ever signed for — settled/absent locks get voucher:null with zero DB
      // work. A DB blip yields voucher:null, never a 500 on the course card.
      let voucher = null;
      if (position?.status === 'ACTIVE' && hasDatabase()) {
        try {
          voucher = await getStoredCompletionVoucher(walletAddress, courseId, {
            log: request.log,
          });
        } catch (error) {
          request.log.warn(
            {
              walletAddress,
              courseId,
              error: error instanceof Error ? error.message : String(error),
            },
            'locks.voucher.attach_failed',
          );
        }
      }

      // Spread — NEVER mutate the object held by lockPosition.mjs's 60s cache.
      return { ...position, voucher };
    },
  );

  // Eligibility pre-gate (enroll ruling R12): DepositV2 must receive
  // { eligible: true } BEFORE building any transaction — no positive answer,
  // no deposit. This is where spec item 21 protects the money; the POST
  // enroll gate is only the after-money backstop.
  app.get(
    '/v1/locks/:courseId/eligibility',
    { preHandler: requireAccessAuth },
    async (request) => {
      const courseId = assertCourseIdParam(request);
      if (!hasDatabase()) {
        throw new HttpError(503, 'Eligibility requires the database', 'DB_UNAVAILABLE');
      }
      try {
        await assertCourseLockable(request.auth.walletAddress, courseId, {
          log: request.log,
        });
        return { eligible: true };
      } catch (error) {
        if (
          error instanceof HttpError &&
          ['COURSE_NOT_FOUND', 'COURSE_NOT_LOCKABLE', 'COURSE_COMPLETED'].includes(error.code)
        ) {
          return { eligible: false, code: error.code };
        }
        throw error;
      }
    },
  );

  // Enroll-on-deposit (enroll ruling R1): server-authoritative enrollment of
  // an on-chain-verified ACTIVE lock. The wallet comes ONLY from the access
  // token; the body's lockAddress is a config-skew tripwire, never trusted.
  app.post(
    '/v1/locks/:courseId/enroll',
    { preHandler: requireAccessAuth },
    async (request, reply) => {
      const courseId = assertCourseIdParam(request);
      if (!hasDatabase()) {
        throw new HttpError(503, 'Enrollment requires the database', 'DB_UNAVAILABLE');
      }
      if (!hasPositionConfig()) {
        throw new HttpError(503, 'Position reader is not configured', 'POSITION_UNCONFIGURED');
      }

      const lockAddress = request.body?.lockAddress;
      if (!lockAddress || typeof lockAddress !== 'string') {
        throw badRequest('lockAddress is required', 'INVALID_LOCK_ADDRESS');
      }
      try {
        // Parse-only validation; also normalizes exotic base58 spellings.
        new PublicKey(lockAddress);
      } catch {
        throw badRequest('lockAddress is not a valid public key', 'INVALID_LOCK_ADDRESS');
      }

      try {
        return await enrollActiveLockServerSide(request.auth.walletAddress, courseId, {
          claimedLockAddress: lockAddress,
          log: request.log,
        });
      } catch (error) {
        if (error instanceof HttpError && error.code === 'ENROLL_RETRY') {
          // R6 contract: the client backs off and retries — surface the
          // machine-readable pacing fields alongside the error envelope.
          reply.status(409).send({
            message: error.message,
            code: error.code,
            retryable: true,
            retryAfterMs: error.retryAfterMs ?? 4000,
          });
          return reply;
        }
        throw error;
      }
    },
  );
}
