import { PublicKey } from '@solana/web3.js';
import { badRequest, notFound, HttpError } from '../../lib/errors.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import { keyGenerator } from '../../plugins/rateKey.mjs';
import { hasPositionConfig, readLockPosition } from '../../lib/lockPosition.mjs';
import { hasDatabase, query, queryAsWallet } from '../../lib/db.mjs';
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

// The client's claim state machine, as it is allowed to report itself. An
// allowlist (rather than free text) keeps the support query "how many claims
// died at signing last night?" answerable; the DB column stays unconstrained
// so extending this list is a one-file change, not a migration.
const CLAIM_PHASES = new Set(['started', 'signed', 'submitted', 'confirmed', 'failed']);

// Long enough for a real wallet/RPC error, short enough that a hostile client
// cannot use the audit log as free storage.
const MAX_ERROR_MESSAGE_LENGTH = 1000;

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

  // Claim audit trail (mainnet hardening): executeClaim runs entirely in the
  // browser, so without this the server never learns that a user even TRIED to
  // get their money out — "my claim failed" was unanswerable. This is
  // best-effort telemetry and must never become a gate: a DB outage returns
  // { recorded: false } so the client keeps claiming.
  app.post(
    '/v1/locks/:courseId/claim-result',
    {
      preHandler: requireAccessAuth,
      config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator } },
    },
    async (request) => {
      const courseId = assertCourseIdParam(request);
      const walletAddress = request.auth.walletAddress;

      const phase = request.body?.phase;
      if (phase != null && (typeof phase !== 'string' || !CLAIM_PHASES.has(phase))) {
        throw badRequest(
          `phase must be one of: ${[...CLAIM_PHASES].join(', ')}`,
          'INVALID_CLAIM_PHASE',
        );
      }

      const rawSignature = request.body?.signature;
      if (rawSignature != null && typeof rawSignature !== 'string') {
        throw badRequest('signature must be a string', 'INVALID_SIGNATURE');
      }
      // A base58 Solana signature is 87-88 chars; anything longer is not one.
      if (typeof rawSignature === 'string' && rawSignature.length > 128) {
        throw badRequest('signature is not a transaction signature', 'INVALID_SIGNATURE');
      }

      const rawError = request.body?.errorMessage;
      if (rawError != null && typeof rawError !== 'string') {
        throw badRequest('errorMessage must be a string', 'INVALID_ERROR_MESSAGE');
      }
      // Truncate rather than reject: the whole point of this field is to
      // capture whatever the wallet threw, and a 400 here would lose it.
      const errorMessage = rawError ? rawError.slice(0, MAX_ERROR_MESSAGE_LENGTH) : null;

      if (!hasDatabase()) {
        return { recorded: false };
      }

      const course = await query('select 1 from lesson.courses where id = $1', [courseId]);
      if (course.rowCount === 0) {
        throw notFound(`Unknown course: ${courseId}`, 'COURSE_NOT_FOUND');
      }

      try {
        await queryAsWallet(
          walletAddress,
          `insert into lesson.claim_attempts
             (wallet_address, course_id, phase, signature, error_message)
           values ($1, $2, $3, $4, $5)`,
          [walletAddress, courseId, phase ?? 'unspecified', rawSignature ?? null, errorMessage],
        );
      } catch (error) {
        request.log.warn(
          {
            courseId,
            phase,
            error: error instanceof Error ? error.message : String(error),
          },
          'locks.claim_result.record_failed',
        );
        return { recorded: false };
      }

      request.log.info({ courseId, phase, signature: rawSignature ?? null }, 'locks.claim_result');
      return { recorded: true };
    },
  );

  // Deposit consent. Unlike the claim audit above this is a legal record, so
  // it fails loudly: if we cannot store the acceptance we must not tell the
  // client it was stored, and the deposit flow is already DB-gated by
  // /eligibility anyway. The FIRST acceptance of a version wins — a re-POST
  // must never rewrite when the user agreed.
  app.post(
    '/v1/locks/consent',
    {
      preHandler: requireAccessAuth,
      config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator } },
    },
    async (request) => {
      const walletAddress = request.auth.walletAddress;

      const termsVersion = request.body?.termsVersion;
      if (!termsVersion || typeof termsVersion !== 'string' || termsVersion.length > 64) {
        throw badRequest('termsVersion is required', 'MISSING_TERMS_VERSION');
      }

      const rawAcceptedAt = request.body?.acceptedAt;
      let acceptedAt = new Date();
      if (rawAcceptedAt != null) {
        const parsed = new Date(rawAcceptedAt);
        if (Number.isNaN(parsed.getTime())) {
          throw badRequest('acceptedAt must be an ISO timestamp', 'INVALID_ACCEPTED_AT');
        }
        // A skewed client clock must not be able to date a consent into the
        // future — the record would be indefensible.
        acceptedAt = parsed.getTime() > Date.now() ? new Date() : parsed;
      }

      if (!hasDatabase()) {
        throw new HttpError(503, 'Consent requires the database', 'DB_UNAVAILABLE');
      }

      await queryAsWallet(
        walletAddress,
        `insert into lesson.user_consents (wallet_address, terms_version, accepted_at)
         values ($1, $2, $3)
         on conflict (wallet_address, terms_version) do nothing`,
        [walletAddress, termsVersion, acceptedAt.toISOString()],
      );

      request.log.info({ termsVersion }, 'locks.consent.recorded');
      return { recorded: true, termsVersion };
    },
  );
}
