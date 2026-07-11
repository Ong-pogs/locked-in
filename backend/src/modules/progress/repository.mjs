import { createHash, randomUUID } from 'node:crypto';
import { badRequest, notFound, HttpError } from '../../lib/errors.mjs';
import { appConfig, CLUSTER } from '../../config.mjs';
import {
  hasDatabase,
  query,
  queryAsWallet,
  withTransaction,
  withTransactionAsWallet,
} from '../../lib/db.mjs';
import {
  hasLockVaultReadConfig,
  inspectUnlockTransaction,
  listRecentLockVaultProgramSignatures,
  readLockAccountSnapshot,
  verifyUnlockTransaction,
} from '../../lib/lockVault.mjs';
import {
  closeCommunityPotDistributionWindow,
  deriveCommunityPotWindowId,
  distributeCommunityPotWindow,
  hasCommunityPotRelayConfig,
  publishRedirectToCommunityPot,
  readCommunityPotVaultBalance,
  readCommunityPotDistributionWindow,
  readCommunityPotWindow,
} from '../../lib/communityPot.mjs';
import {
  enhanceValidatorFeedback,
  gradeSubjectiveAnswerWithLlm,
} from '../../lib/answerValidator.mjs';
import { issueVoucher, yieldBpsForLapses } from '../../lib/claimVoucher.mjs';
import { applyLessonDay, applyMissDay, userYieldBps } from '../../lib/shieldLapseEngine.mjs';
import { autoMissEventId } from '../../lib/missEvents.mjs';
import {
  deriveLockPdaServer,
  primeLockPositionCache,
  readLockV2AccountFresh,
  readVaultV2ConfigAuthority,
} from '../../lib/lockPosition.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUBJECTIVE_VALIDATOR_VERSION = 'rubric-v1';

// XP progression — cosmetic, non-grindable milestones only
const XP_LESSON_FIRST_COMPLETE = 100;
const XP_MODULE_COMPLETE = 500;
const XP_COURSE_COMPLETE = 2000;
const XP_LEVEL_THRESHOLDS = [0, 500, 1500, 3500, 7000, 12000, 20000];

function xpToLevel(xpTotal) {
  for (let i = XP_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xpTotal >= XP_LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

export async function getUserXp(walletAddress) {
  if (!hasDatabase()) return { xpTotal: 0, xpLevel: 1, levelThresholds: XP_LEVEL_THRESHOLDS };
  const result = await query(
    `SELECT xp_total as "xpTotal", xp_level as "xpLevel" FROM lesson.user_xp WHERE wallet_address = $1`,
    [walletAddress],
  );
  const row = result.rows[0] ?? { xpTotal: 0, xpLevel: 1 };
  return { ...row, levelThresholds: XP_LEVEL_THRESHOLDS };
}

async function ensureUserXp(client, walletAddress) {
  await client.query(
    `INSERT INTO lesson.user_xp (wallet_address) VALUES ($1) ON CONFLICT DO NOTHING`,
    [walletAddress],
  );
  const result = await client.query(
    `SELECT xp_total as "xpTotal", xp_level as "xpLevel" FROM lesson.user_xp WHERE wallet_address = $1`,
    [walletAddress],
  );
  return result.rows[0];
}

async function awardXp(client, walletAddress, amount, source, sourceId = null) {
  if (amount <= 0) return null;

  // Fast-path: skip if this exact event was already recorded. NOT the
  // correctness mechanism — the ON CONFLICT below (backed by 0044's partial
  // unique index) is what makes concurrent double-submits award once.
  if (sourceId) {
    const existing = await client.query(
      `SELECT 1 FROM lesson.user_xp_events WHERE wallet_address = $1 AND source = $2 AND source_id = $3 LIMIT 1`,
      [walletAddress, source, sourceId],
    );
    if (existing.rowCount > 0) return null;
  }

  const inserted = await client.query(
    `INSERT INTO lesson.user_xp_events (wallet_address, xp_amount, source, source_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (wallet_address, source, source_id) WHERE source_id IS NOT NULL
     DO NOTHING`,
    [walletAddress, amount, source, sourceId],
  );
  if (inserted.rowCount === 0) return null;

  const result = await client.query(
    `UPDATE lesson.user_xp SET xp_total = xp_total + $2, xp_level = $3, updated_at = now()
     WHERE wallet_address = $1
     RETURNING xp_total as "xpTotal", xp_level as "xpLevel"`,
    [walletAddress, amount, xpToLevel(0)], // level recalculated below
  );

  if (result.rowCount > 0) {
    const newTotal = result.rows[0].xpTotal;
    const newLevel = xpToLevel(newTotal);
    await client.query(
      `UPDATE lesson.user_xp SET xp_level = $2 WHERE wallet_address = $1`,
      [walletAddress, newLevel],
    );
    return { xpTotal: newTotal, xpLevel: newLevel, xpAwarded: amount };
  }
  return null;
}

async function checkAndAwardMilestoneXp(client, walletAddress, courseId, lessonId) {
  await ensureUserXp(client, walletAddress);
  let totalAwarded = 0;

  // 1. First-time lesson completion: +100 XP
  const lessonXp = await awardXp(client, walletAddress, XP_LESSON_FIRST_COMPLETE, 'lesson_complete', lessonId);
  if (lessonXp) totalAwarded += XP_LESSON_FIRST_COMPLETE;

  // 2. Check module completion
  const moduleCheck = await client.query(
    `SELECT pm.module_id,
            count(DISTINCT pl.lesson_id) as total_lessons,
            count(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed) as completed_lessons
     FROM lesson.published_modules pm
     JOIN lesson.published_lessons pl ON pl.module_id = pm.module_id AND pl.release_id = pm.release_id
     LEFT JOIN lesson.user_lesson_progress ulp ON ulp.lesson_id = pl.lesson_id AND ulp.wallet_address = $1
     WHERE pm.course_id = $2
     GROUP BY pm.module_id`,
    [walletAddress, courseId],
  );

  for (const mod of moduleCheck.rows) {
    if (mod.total_lessons > 0 && mod.completed_lessons >= mod.total_lessons) {
      const moduleXp = await awardXp(client, walletAddress, XP_MODULE_COMPLETE, 'module_complete', mod.module_id);
      if (moduleXp) totalAwarded += XP_MODULE_COMPLETE;
    }
  }

  // 3. Check course completion (all modules done)
  const allModulesDone = moduleCheck.rows.length > 0 &&
    moduleCheck.rows.every((mod) => mod.total_lessons > 0 && mod.completed_lessons >= mod.total_lessons);

  if (allModulesDone) {
    const courseXp = await awardXp(client, walletAddress, XP_COURSE_COMPLETE, 'course_complete', courseId);
    if (courseXp) totalAwarded += XP_COURSE_COMPLETE;
  }

  // Read final state
  const final = await client.query(
    `SELECT xp_total as "xpTotal", xp_level as "xpLevel" FROM lesson.user_xp WHERE wallet_address = $1`,
    [walletAddress],
  );

  return {
    xpTotal: final.rows[0]?.xpTotal ?? 0,
    xpLevel: final.rows[0]?.xpLevel ?? 1,
    xpAwarded: totalAwarded,
    // Practice-mode ruling R5: the completing submit uses this to freeze the
    // engine (course_completed_at) in the same transaction.
    courseComplete: allModulesDone,
  };
}

// SHA-256(utf8(courseId)). MUST match the client's hashCourseId in
// web-app/services/solana/lockVault.ts so the lock PDA the backend signs a
// voucher for is byte-identical to the on-chain lock the user opened. A
// mismatch here yields a voucher for the wrong PDA and claim_v2 fails.
function courseIdHashBytes(courseId) {
  return createHash('sha256').update(String(courseId), 'utf8').digest();
}

// Per-module completion counts for a (wallet, course). Single source for the
// voucher gate AND the snapshot's voucherAvailable hint so they cannot drift.
// `run` is any client/pool with .query.
async function fetchModuleCompletion(run, walletAddress, courseId) {
  const result = await run.query(
    `SELECT pm.module_id,
            count(DISTINCT pl.lesson_id) as total_lessons,
            count(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed) as completed_lessons
     FROM lesson.published_modules pm
     JOIN lesson.published_lessons pl ON pl.module_id = pm.module_id AND pl.release_id = pm.release_id
     LEFT JOIN lesson.user_lesson_progress ulp ON ulp.lesson_id = pl.lesson_id AND ulp.wallet_address = $1
     WHERE pm.course_id = $2
     GROUP BY pm.module_id`,
    [walletAddress, courseId],
  );
  return result.rows;
}

// True only when the backend can actually sign a voucher — mirrors the 503
// gates in issueCourseCompletionVoucher so an unarmed deploy never advertises
// a CLAIM it cannot honor.
function voucherSigningConfigured() {
  return Boolean(appConfig.vaultV2ProgramId) && Boolean(appConfig.lockVaultWorkerPrivateKey);
}

// Pure: is every module in the course fully complete? Mirrors the
// course-complete gate in checkAndAwardMilestoneXp. Rows are
// {total_lessons, completed_lessons} (Postgres count() returns strings).
export function isCourseComplete(moduleRows) {
  return (
    Array.isArray(moduleRows) &&
    moduleRows.length > 0 &&
    moduleRows.every(
      (m) =>
        Number(m.total_lessons) > 0 &&
        Number(m.completed_lessons) >= Number(m.total_lessons),
    )
  );
}

/**
 * Issue a signed completion voucher for a fully-completed course. The client
 * embeds the returned Ed25519 message+signature in a precompile instruction
 * placed before claim_v2 in the same transaction; the program verifies the
 * signer is the vault authority and the message matches the one it rebuilds.
 *
 * Fails closed: no DB, unconfigured signer/program, unknown course, or an
 * incomplete course all reject rather than mint an unearned voucher.
 */
export async function issueCourseCompletionVoucher(walletAddress, courseId) {
  if (!hasDatabase()) {
    throw new HttpError(503, 'Completion vouchers require the database', 'DB_UNAVAILABLE');
  }
  const programId = appConfig.vaultV2ProgramId;
  const authoritySecretKey = appConfig.lockVaultWorkerPrivateKey;
  if (!programId || !authoritySecretKey) {
    throw new HttpError(
      503,
      'Voucher signing is not configured',
      'VOUCHER_SIGNING_UNCONFIGURED',
    );
  }

  const moduleRows = await fetchModuleCompletion({ query }, walletAddress, courseId);

  if (moduleRows.length === 0) {
    throw notFound(`Unknown course: ${courseId}`, 'COURSE_NOT_FOUND');
  }
  if (!isCourseComplete(moduleRows)) {
    throw new HttpError(403, 'Course not yet complete', 'COURSE_NOT_COMPLETE');
  }

  const lapseRow = await query(
    `SELECT coalesce(lapse_count, 0) as "lapseCount"
       FROM lesson.user_course_runtime_state
      WHERE wallet_address = $1 AND course_id = $2 LIMIT 1`,
    [walletAddress, courseId],
  );
  const lapseCount = Number(lapseRow.rows[0]?.lapseCount ?? 0);

  const expiry = Math.floor(Date.now() / 1000) + appConfig.voucherTtlSeconds;

  const voucher = issueVoucher({
    programId,
    authoritySecretKey,
    owner: walletAddress,
    courseIdHash: courseIdHashBytes(courseId),
    lapseCount,
    expiry,
  });

  // Fail closed on a signer/authority mismatch: claim_v2 verifies the voucher
  // against the on-chain VaultV2Config.authority, so if LOCK_VAULT_WORKER_
  // PRIVATE_KEY does not match it, EVERY voucher we mint is unclaimable. Catch
  // the misconfig here rather than after the user has finished the course and
  // hits a cryptic on-chain failure (audit M11). A null read (RPC hiccup /
  // config not found) does not block issuance — the on-chain check still guards.
  // Gated to non-devnet: devnet is already proven-matching, and this keeps the
  // RPC read out of the devnet/local test path.
  if (CLUSTER !== 'devnet') {
    const onchainAuthority = await readVaultV2ConfigAuthority(programId);
    if (onchainAuthority && onchainAuthority !== voucher.authorityPubkey) {
      throw new HttpError(
        503,
        'Voucher signer does not match the on-chain vault authority',
        'VOUCHER_AUTHORITY_MISMATCH',
      );
    }
  }

  return { courseId, lapseCount, ...voucher };
}

/**
 * UPSERT the full signed voucher (voucher-autoissue ruling R5). Pool-based —
 * NEVER call from inside the submit transaction (ruling R3). Last-write-wins
 * is acceptable: every signed voucher is user-favorable by construction, the
 * lock PDA is deterministic per (owner, courseHash), and re-lock of a
 * completed course is blocked by the COURSE_COMPLETED eligibility gate.
 */
export async function persistCompletionVoucher(walletAddress, courseId, voucher) {
  await query(
    `INSERT INTO lesson.completion_vouchers
       (wallet_address, course_id, lock_address, lapse_count, bps, expiry,
        authority_pubkey, message, signature, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (wallet_address, course_id) DO UPDATE SET
       lock_address = excluded.lock_address,
       lapse_count = excluded.lapse_count,
       bps = excluded.bps,
       expiry = excluded.expiry,
       authority_pubkey = excluded.authority_pubkey,
       message = excluded.message,
       signature = excluded.signature,
       issued_at = now()`,
    [
      walletAddress,
      courseId,
      voucher.lock,
      voucher.lapseCount,
      voucher.bps,
      voucher.expiry,
      voucher.authorityPubkey,
      voucher.message,
      voucher.signature,
    ],
  );
}

// pg returns bigint (expiry) as a string and the client claim builder needs
// numbers (web-app types.ts declares them) — the Number() casts are mandatory
// (voucher-autoissue ruling R7).
function voucherRowToResponse(courseId, row) {
  return {
    courseId,
    lapseCount: Number(row.voucher_lapse_count),
    lock: row.lock_address,
    authorityPubkey: row.authority_pubkey,
    bps: Number(row.bps),
    expiry: Number(row.expiry),
    message: row.message,
    signature: row.signature,
  };
}

/**
 * Read (and lazily heal) the stored completion voucher for the position
 * endpoint (voucher-autoissue ruling R7). Pool-based. Decision table:
 *   (a) no runtime row OR course_completed_at IS NULL -> null, sign nothing;
 *   (b) stored + unexpired -> return it (on bps drift vs the frozen
 *       lapse_count, log at ERROR and STILL return it unchanged — the GET
 *       never re-signs on drift: silent re-signing could only cut a finished
 *       user's yield);
 *   (c) stored + expired + signing configured -> re-issue + persist + return
 *       (frozen lapse_count makes the bps identical);
 *   (d) no stored row + completed + signing configured -> issue + persist +
 *       return — the mandatory heal for every pre-0047 completer (the 0043
 *       backfill guarantees their course_completed_at stamp);
 *   (e) signing unconfigured -> stored row if unexpired else null; the 503
 *       never escapes this helper.
 */
export async function getStoredCompletionVoucher(walletAddress, courseId, { log = null } = {}) {
  const result = await query(
    `SELECT v.lock_address,
            v.lapse_count AS voucher_lapse_count,
            v.bps,
            v.expiry,
            v.authority_pubkey,
            v.message,
            v.signature,
            v.issued_at,
            coalesce(r.lapse_count, 0) AS runtime_lapse_count,
            r.course_completed_at
       FROM lesson.user_course_runtime_state r
       LEFT JOIN lesson.completion_vouchers v
         ON v.wallet_address = r.wallet_address AND v.course_id = r.course_id
      WHERE r.wallet_address = $1 AND r.course_id = $2
      LIMIT 1`,
    [walletAddress, courseId],
  );
  const row = result.rows[0];

  // (a) not a completed course — never sign, never store.
  if (!row || row.course_completed_at == null) {
    return null;
  }

  const hasStoredVoucher = row.signature != null;
  if (hasStoredVoucher) {
    const unexpired = Number(row.expiry) * 1000 > Date.now();
    if (unexpired) {
      // (b) lapse_count is frozen at completion, so a stored-bps mismatch is
      // by definition a bug — log loudly, serve the stored voucher unchanged.
      const expectedBps = yieldBpsForLapses(Number(row.runtime_lapse_count));
      if (Number(row.bps) !== expectedBps) {
        log?.error?.(
          {
            walletAddress,
            courseId,
            storedBps: Number(row.bps),
            expectedBps,
          },
          'voucher.bps_drift',
        );
      }
      return voucherRowToResponse(courseId, row);
    }
    // (c) expired — re-issue at the (frozen) current tier.
    if (voucherSigningConfigured()) {
      const voucher = await issueCourseCompletionVoucher(walletAddress, courseId);
      await persistCompletionVoucher(walletAddress, courseId, voucher);
      return voucher;
    }
    // (e) expired and unarmed — nothing servable.
    return null;
  }

  // (d) completed but never stored (pre-0047 completer, or a crash between
  // commit and persist) — the mandatory lazy heal.
  if (voucherSigningConfigured()) {
    const voucher = await issueCourseCompletionVoucher(walletAddress, courseId);
    await persistCompletionVoucher(walletAddress, courseId, voucher);
    return voucher;
  }

  // (e) unarmed env — behave exactly like today.
  return null;
}
const LESSON_ACCEPTANCE_THRESHOLD = 55;

function assertAttemptId(attemptId) {
  if (!attemptId || typeof attemptId !== 'string' || !UUID_RE.test(attemptId)) {
    throw badRequest('attemptId must be a valid UUID', 'INVALID_ATTEMPT_ID');
  }
  return attemptId;
}

function normalizeAnswerText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeKeyword(value) {
  return normalizeAnswerText(value).replace(/[^a-z0-9 ]/g, '').trim();
}

function tokenizeNormalized(value) {
  return normalizeKeyword(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

// English stopwords filtered from auto-generated rubric keywords. Author-
// supplied keyword lists are NOT filtered through this — if an author
// explicitly added "of" to a criterion, that was intentional. This list
// only applies when we tokenize a model answer into keywords ourselves.
const RUBRIC_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'do',
  'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i',
  'if', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'she', 'so',
  'than', 'that', 'the', 'their', 'them', 'then', 'they', 'this', 'to',
  'too', 'was', 'we', 'were', 'when', 'where', 'which', 'who', 'will',
  'with', 'would', 'you', 'your',
]);

function tokenizeMeaningful(value) {
  return tokenizeNormalized(value).filter((token) => !RUBRIC_STOPWORDS.has(token));
}

// What fraction of a criterion's keywords must match for it to count
// as passed. Lowered from 1.0 (every keyword required) so that learners
// can rephrase using synonyms and still pass — e.g. answering "validators
// stake tokens" for a model answer of "validators stake tokens to secure
// the network" should not fail on the missing "to secure the network"
// words. 0.6 is a starting point — increase if cheating becomes a thing.
const RUBRIC_KEYWORD_MATCH_RATIO = 0.4;
// Auto-generated rubric (when an author did not supply explicit criteria)
// uses this lower acceptance threshold to match the relaxed keyword rule.
// Author rubrics keep whatever acceptThreshold they declared.
const AUTO_RUBRIC_ACCEPT_THRESHOLD = 45;

function diffDays(fromDay, toDay) {
  const from = new Date(`${fromDay}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDay}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

// UTC-day arithmetic on 'YYYY-MM-DD' strings (shared by the submit-time
// catch-up loop and the lapse sweep — same day-fold everywhere).
export function addUtcDays(dayText, delta) {
  const date = new Date(`${dayText}T00:00:00.000Z`);
  return new Date(date.getTime() + delta * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function toUtcDayString(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function maxUtcDay(...days) {
  return days.filter(Boolean).sort().at(-1) ?? null;
}

function percentageOfAmount(amount, bps) {
  return Math.floor((Number(amount) * Number(bps)) / 10_000);
}

function unixTimestampSecondsToIso(value) {
  if (value == null || Number(value) <= 0) {
    return null;
  }

  return new Date(Number(value) * 1000).toISOString();
}

function formatAtomicUsdcUi(value) {
  const amount = BigInt(value ?? 0);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

function formatCommunityPotWindowLabel(windowId) {
  const numeric = Number(windowId);
  const year = Math.floor(numeric / 100);
  const monthIndex = (numeric % 100) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    return String(windowId);
  }

  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function mapDistributionWindowStatus(rawStatus) {
  if (Number(rawStatus) === 2) return 'DISTRIBUTED';
  if (Number(rawStatus) === 1) return 'CLOSED';
  return 'OPEN';
}

function mapRecipientStatus(rawStatus) {
  if (rawStatus === 'distributed') return 'DISTRIBUTED';
  if (rawStatus === 'failed') return 'FAILED';
  if (rawStatus === 'publishing') return 'PUBLISHING';
  if (rawStatus === 'pending') return 'PENDING';
  return 'NONE';
}

function assertAnswers(answers) {
  if (!Array.isArray(answers)) {
    throw badRequest('answers must be an array', 'INVALID_ANSWERS');
  }

  const answerMap = new Map();

  for (const answer of answers) {
    if (!answer || typeof answer !== 'object') {
      throw badRequest('Each answer must be an object', 'INVALID_ANSWER_ITEM');
    }

    const questionId = answer.questionId;
    const answerText = answer.answerText;

    if (!questionId || typeof questionId !== 'string') {
      throw badRequest('Each answer requires questionId', 'MISSING_QUESTION_ID');
    }

    if (typeof answerText !== 'string') {
      throw badRequest('Each answer requires answerText', 'MISSING_ANSWER_TEXT');
    }

    if (answerMap.has(questionId)) {
      throw badRequest(
        `Duplicate answer for question ${questionId}`,
        'DUPLICATE_QUESTION_ANSWER',
      );
    }

    answerMap.set(questionId, answerText);
  }

  return answerMap;
}

async function getPublishedLessonVersion(client, lessonId) {
  const result = await client.query(
    `
      select id::text as "lessonVersionId"
      from lesson.lesson_versions
      where lesson_id = $1
        and state = 'published'
      order by published_at desc nulls last
      limit 1
    `,
    [lessonId],
  );

  if (result.rowCount === 0) {
    throw notFound('Lesson not found', 'LESSON_NOT_FOUND');
  }

  return result.rows[0];
}

async function readAttempt(client, walletAddress, lessonId, attemptId) {
  const result = await client.query(
    `
      select
        id::text as "attemptId",
        wallet_address as "walletAddress",
        lesson_id as "lessonId",
        lesson_version_id::text as "lessonVersionId",
        started_at as "startedAt",
        submitted_at as "submittedAt",
        score,
        accepted
      from lesson.user_lesson_attempts
      where id = $1::uuid
    `,
    [attemptId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const attempt = result.rows[0];
  if (attempt.walletAddress !== walletAddress || attempt.lessonId !== lessonId) {
    throw badRequest('attemptId is already bound to a different lesson', 'ATTEMPT_ID_CONFLICT');
  }

  return attempt;
}

async function ensureAttempt(
  client,
  walletAddress,
  lessonId,
  attemptId,
  lessonVersionId,
  startedAt = null,
) {
  await client.query(
    `
      insert into lesson.user_lesson_attempts (
        id,
        wallet_address,
        lesson_id,
        lesson_version_id,
        started_at
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4::uuid,
        coalesce($5::timestamptz, now())
      )
      on conflict (id) do nothing
    `,
    [attemptId, walletAddress, lessonId, lessonVersionId, startedAt],
  );

  const attempt = await readAttempt(client, walletAddress, lessonId, attemptId);
  if (!attempt) {
    throw notFound('Lesson attempt not found', 'ATTEMPT_NOT_FOUND');
  }

  return attempt;
}

async function listLessonQuestions(client, lessonVersionId) {
  const result = await client.query(
    `
      select
        q.id,
        q.question_type as "questionType",
        q.prompt,
        q.correct_answer as "correctAnswer",
        q.metadata,
        coalesce(
          json_agg(
            jsonb_build_object(
              'id', qo.id::text,
              'text', qo.option_text
            )
            order by qo.option_order
          ) filter (where qo.id is not null),
          '[]'::json
        ) as options
      from lesson.questions q
      left join lesson.question_options qo on qo.question_id = q.id
      where q.lesson_version_id = $1::uuid
      group by q.id, q.question_type, q.prompt, q.correct_answer, q.metadata, q.question_order
      order by q.question_order asc
    `,
    [lessonVersionId],
  );

  return result.rows;
}

async function getCourseIdForPublishedLesson(client, lessonId, lessonVersionId) {
  const result = await client.query(
    `
      select (payload->>'courseId') as "courseId"
      from lesson.published_lessons
      where lesson_id = $1
        and lesson_version_id = $2::uuid
      limit 1
    `,
    [lessonId, lessonVersionId],
  );

  if (result.rowCount === 0 || !result.rows[0].courseId) {
    throw notFound('Published lesson context not found', 'LESSON_CONTEXT_NOT_FOUND');
  }

  return result.rows[0].courseId;
}

// All WRITERS must pass { forUpdate: true } so the (wallet_address, course_id)
// row lock serializes concurrent engine transitions (practice ruling R11 /
// sweep ruling R10). Read-only snapshot paths stay unlocked. Single-row lock
// ordering — no deadlock surface.
async function ensureCourseRuntimeState(
  client,
  walletAddress,
  courseId,
  { forUpdate = false } = {},
) {
  // Legacy-deletion ruling: the INSERT carries only the primary key — the
  // doomed legacy columns (fuel/ichor/gauntlet/saver) are never referenced,
  // read or write, so the deferred column DROP can promote safely.
  await client.query(
    `
      insert into lesson.user_course_runtime_state (
        wallet_address,
        course_id
      )
      values ($1, $2)
      on conflict (wallet_address, course_id) do nothing
    `,
    [walletAddress, courseId],
  );

  const result = await client.query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        current_streak as "currentStreak",
        longest_streak as "longestStreak",
        current_yield_redirect_bps as "currentYieldRedirectBps",
        extension_days as "extensionDays",
        last_completed_day::text as "lastCompletedDay",
        last_miss_day::text as "lastMissDay",
        coalesce(shields, 3) as "shields",
        coalesce(lapse_count, 0) as "lapseCount",
        coalesce(lapse_open, false) as "lapseOpen",
        coalesce(consecutive_lesson_days, 0) as "consecutiveLessonDays",
        last_fuel_credit_day::text as "lastFuelCreditDay",
        last_brewer_burn_ts as "lastBrewerBurnTs",
        fire_lit_until as "fireLitUntil",
        course_completed_at as "courseCompletedAt",
        lock_account_address as "lockAccountAddress",
        lock_start_at as "lockStartAt"
      from lesson.user_course_runtime_state
      where wallet_address = $1
        and course_id = $2
      limit 1
      ${forUpdate ? 'for update' : ''}
    `,
    [walletAddress, courseId],
  );

  return result.rows[0];
}

// Advance the v2 shield/lapse state (spec §4.2) for one UTC day and persist
// the engine columns INCLUDING current_streak — the engine output is
// authoritative for the streak (practice ruling R12; the old diffDays
// recompute reset a shield-paused streak). `kind` is 'lesson' (a first-time
// lesson-day) or 'miss'. This is the ONLY writer of lapse_count — the
// completion voucher's yield-kept bps derives from it, so it must be
// maintained here, not just read. Exported for the lapse sweep (sweep ruling
// R9): reimplementing this writer anywhere is forbidden. Callers must hold
// the runtime row lock (ensureCourseRuntimeState with forUpdate: true).
export async function applyShieldLapseTransition(client, state, kind) {
  const before = {
    streak: state.currentStreak,
    shields: state.shields,
    lapseCount: state.lapseCount,
    lapseOpen: state.lapseOpen,
    consecutiveLessonDays: state.consecutiveLessonDays,
  };
  const next = kind === 'miss' ? applyMissDay(before) : applyLessonDay(before);
  await client.query(
    `
      update lesson.user_course_runtime_state
      set shields = $3,
          lapse_count = $4,
          lapse_open = $5,
          consecutive_lesson_days = $6,
          current_streak = $7,
          updated_at = now()
      where wallet_address = $1
        and course_id = $2
    `,
    [
      state.walletAddress,
      state.courseId,
      next.shields,
      next.lapseCount,
      next.lapseOpen,
      next.consecutiveLessonDays,
      next.streak,
    ],
  );
  return next;
}

// The caller must run inside withTransactionAsWallet — this function takes the
// runtime row lock (R11), settles any unprocessed dark days BEFORE the
// lesson-day transition (R13: fail closed in the money direction — a
// completion may not advance the streak or leave lapse_count understated for
// the voucher while gap days are unjudged), then applies the engine
// lesson-day. Completions never touch saver_count / saver_recovery_mode /
// current_yield_redirect_bps (R12 deleted the dormant saver-recovery block).
async function applyVerifiedCompletionToCourseRuntime(
  client,
  walletAddress,
  courseId,
  completionDay,
  rewardUnits,
) {
  let state = await ensureCourseRuntimeState(client, walletAddress, courseId, {
    forUpdate: true,
  });
  const sameDay = state.lastCompletedDay === completionDay;

  if (!sameDay) {
    // R13 catch-up: judge every fully-elapsed UTC day between the last known
    // day (last lesson, last miss, or the day before lock-up) and this
    // completion. Day-keyed receipts (0045) make this idempotent against the
    // worker and the sweep. Cap 200 iterations; skip when there is no anchor.
    const lockStartDay = toUtcDayString(state.lockStartAt);
    const baseDay = maxUtcDay(
      state.lastCompletedDay,
      state.lastMissDay,
      lockStartDay ? addUtcDays(lockStartDay, -1) : null,
    );
    if (baseDay != null) {
      let day = addUtcDays(baseDay, 1);
      let iterations = 0;
      while (day < completionDay && iterations < 200) {
        await applyMissConsequenceLocked(
          client,
          state,
          day,
          autoMissEventId(walletAddress, courseId, day),
        );
        state = await ensureCourseRuntimeState(client, walletAddress, courseId);
        day = addUtcDays(day, 1);
        iterations += 1;
      }
    }
  }

  let currentStreak = state.currentStreak;
  let longestStreak = state.longestStreak;

  if (!sameDay) {
    // First completion of a new UTC day = a v2 lesson-day: grow the streak,
    // regen shields, clear an open lapse. Maintains lapse_count for the
    // voucher. The ENGINE output is the streak (R12) — a shield-paused streak
    // resumes at N+1 instead of resetting to 1.
    const next = await applyShieldLapseTransition(client, state, 'lesson');
    currentStreak = next.streak;
    longestStreak = Math.max(state.longestStreak, currentStreak);
  }

  // Legacy-deletion ruling: gauntlet/fuel/ichor writes are gone — the
  // completion writes exactly day + streak. last_completed_day stays HERE:
  // it is what makes sameDay true and prevents +1-streak-per-lesson
  // inflation of pot weight and leaderboard. Saver/redirect columns are
  // deliberately absent — completions must never touch yield routing (R12).
  await client.query(
    `
      update lesson.user_course_runtime_state
      set current_streak = $3,
          longest_streak = $4,
          last_completed_day = $5::date,
          updated_at = now()
      where wallet_address = $1
        and course_id = $2
    `,
    [
      walletAddress,
      courseId,
      currentStreak,
      longestStreak,
      completionDay,
    ],
  );

  // Return shape kept (legacy keys as coalesced zero/default passthroughs)
  // so stale service-worker-cached clients reading the submit response's
  // courseRuntime don't crash. The legacy columns are no longer selected,
  // so these coalesce to their post-deletion constants.
  return {
    courseId,
    currentStreak,
    longestStreak,
    gauntletActive: state.gauntletActive ?? false,
    gauntletDay: state.gauntletDay ?? 1,
    saverCount: state.saverCount ?? 0,
    saverRecoveryMode: state.saverRecoveryMode ?? false,
    currentYieldRedirectBps: state.currentYieldRedirectBps,
    extensionDays: state.extensionDays,
    fuelCounter: state.fuelCounter ?? 0,
    fuelCap: state.fuelCap ?? 7,
    lastFuelCreditDay: state.lastFuelCreditDay ?? null,
    lastBrewerBurnTs: state.lastBrewerBurnTs ?? null,
    fuelAwarded: 0,
    ichorCounter: Number(state.ichorCounter ?? 0),
    ichorLifetimeTotal: Number(state.ichorLifetimeTotal ?? 0),
    ichorReward: 0,
    fuelEarnStatus: 'AVAILABLE',
  };
}

function extractRubricConfig(question) {
  const validator = question.metadata?.validator;
  if (
    validator &&
    validator.mode === 'rubric_v1' &&
    Array.isArray(validator.criteria) &&
    validator.criteria.length > 0
  ) {
    return {
      mode: 'rubric_v1',
      acceptThreshold: Number(validator.acceptThreshold ?? 70),
      criteria: validator.criteria.map((criterion, index) => ({
        id: criterion.id ?? `criterion-${index + 1}`,
        label: criterion.label ?? `Criterion ${index + 1}`,
        kind: criterion.kind === 'exact' ? 'exact' : 'keywords',
        keywords: Array.isArray(criterion.keywords) ? criterion.keywords : [],
        expected: typeof criterion.expected === 'string' ? criterion.expected : null,
        weight: Number(criterion.weight ?? 0),
        required: criterion.required !== false,
        feedbackPass:
          typeof criterion.feedbackPass === 'string' ? criterion.feedbackPass : null,
        feedbackMiss:
          typeof criterion.feedbackMiss === 'string' ? criterion.feedbackMiss : null,
      })),
    };
  }

  const meaningfulTokens = tokenizeMeaningful(question.correctAnswer);
  // Single-word answers stay strict — there's nothing to be lenient about.
  // Fall back to all-tokens if stopword filtering left nothing meaningful.
  if (meaningfulTokens.length <= 1) {
    return {
      mode: 'rubric_v1',
      acceptThreshold: 100,
      criteria: [
        {
          id: 'exact-answer',
          label: 'Exact answer match',
          kind: 'exact',
          expected: question.correctAnswer,
          keywords: [],
          weight: 100,
          required: true,
          feedbackPass: 'Matched the expected answer.',
          feedbackMiss: `Use the exact expected answer: ${question.correctAnswer}.`,
        },
      ],
    };
  }

  return {
    mode: 'rubric_v1',
    acceptThreshold: AUTO_RUBRIC_ACCEPT_THRESHOLD,
    criteria: [
      {
        id: 'key-concepts',
        label: 'Includes the key concepts',
        kind: 'keywords',
        expected: null,
        keywords: meaningfulTokens,
        weight: 100,
        required: true,
        feedbackPass: 'Covered the expected key concepts.',
        feedbackMiss: `Try to mention concepts like: ${meaningfulTokens.join(', ')}.`,
      },
    ],
  };
}

function buildIntegrityFlags(answerText, startedAt, completedAt) {
  const flags = [];
  const trimmed = answerText.trim();

  if (trimmed.length > 1000) {
    flags.push({
      code: 'ANSWER_TOO_LONG',
      severity: 'block',
      message: 'Answer exceeded the allowed validator length.',
    });
  }

  if (startedAt && completedAt) {
    const started = new Date(startedAt).getTime();
    const completed = new Date(completedAt).getTime();
    const durationMs = completed - started;
    if (Number.isFinite(durationMs) && durationMs >= 0 && durationMs < 2000 && trimmed.length > 40) {
      flags.push({
        code: 'IMPOSSIBLE_SPEED',
        severity: 'block',
        message: 'Answer arrived too quickly for its length.',
      });
    }
  }

  return flags;
}

function evaluateRubricCriterion(criterion, answerText) {
  const normalizedAnswer = normalizeKeyword(answerText);
  if (criterion.kind === 'exact') {
    const expected = normalizeKeyword(criterion.expected ?? '');
    const passed = expected.length > 0 && normalizedAnswer === expected;
    return {
      criterionId: criterion.id,
      label: criterion.label,
      weight: criterion.weight,
      passed,
      matchRatio: passed ? 1 : 0, // exact criteria are all-or-nothing
      matched: passed ? [criterion.expected] : [],
      feedback:
        passed
          ? criterion.feedbackPass ?? `Correctly satisfied ${criterion.label}.`
          : criterion.feedbackMiss ?? `Missing ${criterion.label}.`,
    };
  }

  const answerTokens = new Set(tokenizeNormalized(answerText));
  const matched = criterion.keywords.filter((keyword) => answerTokens.has(normalizeKeyword(keyword)));
  // A criterion now passes when a meaningful fraction of its keywords are
  // present in the answer, not when every single one is. This lets a
  // learner rephrase using synonyms and still get credit for the concept.
  const matchRatio =
    criterion.keywords.length > 0 ? matched.length / criterion.keywords.length : 0;
  const passed = matchRatio >= RUBRIC_KEYWORD_MATCH_RATIO;
  return {
    criterionId: criterion.id,
    label: criterion.label,
    weight: criterion.weight,
    passed,
    matchRatio, // fraction of keywords present — drives partial credit
    matched,
    feedback:
      passed
        ? criterion.feedbackPass ?? `Correctly satisfied ${criterion.label}.`
        : criterion.feedbackMiss ?? `Missing ${criterion.label}.`,
  };
}

function buildFeedbackSummary(criteriaBreakdown, accepted, integrityFlags) {
  const passed = criteriaBreakdown.filter((criterion) => criterion.passed).map((criterion) => criterion.label);
  const missed = criteriaBreakdown.filter((criterion) => !criterion.passed).map((criterion) => criterion.label);

  const parts = [];
  if (passed.length > 0) {
    parts.push(`What was correct: ${passed.join(', ')}.`);
  }
  if (missed.length > 0) {
    parts.push(`Key concept missing: ${missed.join(', ')}.`);
  }
  if (integrityFlags.length > 0) {
    parts.push(`Integrity flag: ${integrityFlags.map((flag) => flag.message).join(' ')}`);
  }
  if (accepted) {
    parts.push('How to improve: keep the same core concept coverage and add one precise example next time.');
  } else {
    parts.push('How to improve: answer in one short sentence using the missing key concept words.');
  }

  return parts.join(' ');
}

function buildValidatorDecisionHash(questionId, answerText, validatorResult) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        questionId,
        answerText,
        accepted: validatorResult.accepted,
        score: validatorResult.score,
        validatorMode: validatorResult.validatorMode,
        validatorVersion: validatorResult.validatorVersion,
        criteriaBreakdown: validatorResult.criteriaBreakdown,
        integrityFlags: validatorResult.integrityFlags,
        feedbackSummary: validatorResult.feedbackSummary,
      }),
    )
    .digest('hex');
}

export async function evaluateSubjectiveAnswer(question, answerText, startedAt, completedAt) {
  const rubric = extractRubricConfig(question);
  const integrityFlags = buildIntegrityFlags(answerText, startedAt, completedAt);
  const criteriaBreakdown = rubric.criteria.map((criterion) =>
    evaluateRubricCriterion(criterion, answerText),
  );
  const totalWeight = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  // Partial credit: each criterion earns weight × its keyword match ratio, not
  // all-or-nothing. So an answer with 3 of 7 key concepts scores ~43, not 0 —
  // the granular per-question grade the lesson total averages.
  const achievedWeight = criteriaBreakdown.reduce(
    (sum, criterion) => sum + criterion.weight * (criterion.matchRatio ?? (criterion.passed ? 1 : 0)),
    0,
  );
  const score = totalWeight > 0 ? Math.round((achievedWeight / totalWeight) * 100) : 0;
  const requiredCriteriaMet = rubric.criteria
    .filter((criterion) => criterion.required)
    .every((criterion) =>
      criteriaBreakdown.find((result) => result.criterionId === criterion.id)?.passed === true,
    );
  const hasBlockingIntegrityFlag = integrityFlags.some((flag) => flag.severity === 'block');
  const accepted =
    answerText.trim().length > 0 &&
    !hasBlockingIntegrityFlag &&
    requiredCriteriaMet &&
    score >= rubric.acceptThreshold;
  const baseResult = {
    accepted,
    score,
    criteriaBreakdown,
    feedbackSummary: buildFeedbackSummary(criteriaBreakdown, accepted, integrityFlags),
    validatorVersion: SUBJECTIVE_VALIDATOR_VERSION,
    validatorMode: rubric.mode,
    rubricSnapshot: rubric,
    integrityFlags,
  };
  // Feedback can be upgraded by the model, but acceptance must stay rubric-deterministic.
  const enhancedFeedback = await enhanceValidatorFeedback({
    prompt: question.prompt,
    learnerAnswer: answerText,
    criteriaBreakdown,
    integrityFlags,
    accepted,
    rubricMode: rubric.mode,
  });
  const validatorResult = enhancedFeedback
    ? {
        ...baseResult,
        feedbackSummary: enhancedFeedback.feedbackSummary,
        validatorVersion: enhancedFeedback.validatorVersion,
        validatorMode: enhancedFeedback.validatorMode,
      }
    : baseResult;

  return {
    ...validatorResult,
    decisionHash: buildValidatorDecisionHash(question.id, answerText, validatorResult),
  };
}

// Shape the per-question review data returned in the (post-commit) submit
// response. Every question is included — the previous version filtered to
// `validatorResult` present, which silently dropped all MCQs, so after the
// answer key stopped shipping in the lesson payload the result page could no
// longer show which MCQs were right or reveal their answers.
export function buildQuestionResults(attempts) {
  return attempts.map((attempt) => ({
    questionId: attempt.questionId,
    prompt: attempt.prompt,
    isCorrect: attempt.isCorrect,
    correctAnswer: attempt.correctAnswer ?? null,
    accepted: attempt.validatorResult ? attempt.validatorResult.accepted : attempt.isCorrect,
    // Uniform 0-100 partial score for every question (MCQ = 0/100, short-text
    // = keyword-match %), so the result page can show per-question credit.
    questionScore: attempt.questionScore ?? (attempt.isCorrect ? 100 : 0),
    score: attempt.validatorResult ? attempt.validatorResult.score : null,
    feedbackSummary: attempt.validatorResult ? attempt.validatorResult.feedbackSummary : null,
    validatorVersion: attempt.validatorResult ? attempt.validatorResult.validatorVersion : null,
    decisionHash: attempt.validatorResult ? attempt.validatorResult.decisionHash : null,
  }));
}

async function gradeAnswers(questions, submittedAnswers, startedAt = null, completedAt = null) {
  const questionIds = new Set(questions.map((question) => question.id));
  for (const questionId of submittedAnswers.keys()) {
    if (!questionIds.has(questionId)) {
      throw badRequest(
        `Answer was provided for an unknown question: ${questionId}`,
        'UNKNOWN_QUESTION_ID',
      );
    }
  }

  const attempts = await Promise.all(questions.map(async (question) => {
    const answerText = submittedAnswers.get(question.id) ?? '';
    let validatorResult = null;
    let isCorrect = false;

    let questionScore = 0; // 0-100 partial credit toward the lesson total
    if (question.questionType === 'mcq') {
      const normalizedAnswer = normalizeAnswerText(answerText);
      const normalizedCorrectAnswer = normalizeAnswerText(question.correctAnswer);
      isCorrect =
        normalizedAnswer.length > 0 && normalizedAnswer === normalizedCorrectAnswer;
      questionScore = isCorrect ? 100 : 0;
    } else {
      // Non-MCQ answers: LLM semantic grader when configured, else the
      // deterministic rubric grader (keyword match from the answer key) so
      // short-text lessons still grade + still gate funds when the LLM is
      // off/unavailable, instead of a hard "grader unavailable" that blocks
      // completion entirely.
      const llmConfigured =
        appConfig.answerValidatorHybridEnabled && Boolean(appConfig.openaiApiKey);
      validatorResult = llmConfigured
        ? await gradeSubjectiveAnswerWithLlm({ question, answerText, startedAt, completedAt })
        : await evaluateSubjectiveAnswer(question, answerText, startedAt, completedAt);
      isCorrect = validatorResult.accepted;
      // Partial credit: use the grader's 0-100 quality score, NOT a binary
      // pass/fail. A short-text answer that covers most of the key concepts
      // (e.g. 70% keyword match) now contributes 70 toward the lesson instead
      // of a hard 0 — so one imperfect answer no longer tanks the lesson.
      questionScore = Math.max(0, Math.min(100, Number(validatorResult.score) || 0));
    }

    return {
      questionId: question.id,
      prompt: question.prompt,
      answerText: answerText.trim().length > 0 ? answerText.trim() : null,
      isCorrect,
      questionScore,
      // The answer key never ships in the lesson payload (it gates real funds),
      // but the graded submit response — which the user only sees AFTER
      // committing — may reveal it so the result page can show what was correct.
      correctAnswer: question.correctAnswer ?? null,
      validatorResult,
    };
  }));

  const correctAnswers = attempts.filter((attempt) => attempt.isCorrect).length;
  const totalQuestions = questions.length;
  // Lesson score = AVERAGE of per-question partial scores (each question is an
  // equal slice — 4 questions => each worth 25 points, graded 0-25, summed).
  // Previously binary correct-count/total, which zeroed a whole question for a
  // near-miss subjective answer.
  const score =
    totalQuestions === 0
      ? 0
      : Math.round(attempts.reduce((sum, a) => sum + a.questionScore, 0) / totalQuestions);

  return {
    attempts,
    correctAnswers,
    totalQuestions,
    score,
  };
}

async function persistAnswerValidationDecisions(client, attemptId, questionAttempts) {
  for (const attempt of questionAttempts) {
    if (!attempt.validatorResult) {
      continue;
    }

    await client.query(
      `
        insert into lesson.answer_validation_decisions (
          lesson_attempt_id,
          question_id,
          validator_mode,
          validator_version,
          accepted,
          score,
          prompt_snapshot,
          learner_answer,
          rubric_snapshot,
          criteria_breakdown,
          integrity_flags,
          feedback_summary,
          decision_hash,
          updated_at
        )
        values (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9::jsonb,
          $10::jsonb,
          $11::jsonb,
          $12,
          $13,
          now()
        )
        on conflict (lesson_attempt_id, question_id)
        do update set
          validator_mode = excluded.validator_mode,
          validator_version = excluded.validator_version,
          accepted = excluded.accepted,
          score = excluded.score,
          prompt_snapshot = excluded.prompt_snapshot,
          learner_answer = excluded.learner_answer,
          rubric_snapshot = excluded.rubric_snapshot,
          criteria_breakdown = excluded.criteria_breakdown,
          integrity_flags = excluded.integrity_flags,
          feedback_summary = excluded.feedback_summary,
          decision_hash = excluded.decision_hash,
          updated_at = now()
      `,
      [
        attemptId,
        attempt.questionId,
        attempt.validatorResult.validatorMode,
        attempt.validatorResult.validatorVersion,
        attempt.validatorResult.accepted,
        attempt.validatorResult.score,
        attempt.prompt,
        attempt.answerText,
        JSON.stringify(attempt.validatorResult.rubricSnapshot),
        JSON.stringify(attempt.validatorResult.criteriaBreakdown),
        JSON.stringify(attempt.validatorResult.integrityFlags),
        attempt.validatorResult.feedbackSummary,
        attempt.validatorResult.decisionHash,
      ],
    );
  }
}

async function readAnswerValidationDecisions(client, attemptId) {
  const result = await client.query(
    `
      select
        question_id as "questionId",
        accepted,
        score,
        prompt_snapshot as "prompt",
        feedback_summary as "feedbackSummary",
        validator_version as "validatorVersion",
        decision_hash as "decisionHash"
      from lesson.answer_validation_decisions
      where lesson_attempt_id = $1::uuid
      order by question_id asc
    `,
    [attemptId],
  );

  return result.rows;
}

async function persistQuestionAttempts(client, attemptId, questionAttempts) {
  for (const attempt of questionAttempts) {
    await client.query(
      `
        insert into lesson.user_question_attempts (
          lesson_attempt_id,
          question_id,
          answer_text,
          is_correct
        )
        values (
          $1::uuid,
          $2,
          $3,
          $4
        )
        on conflict (lesson_attempt_id, question_id)
        do update set
          answer_text = excluded.answer_text,
          is_correct = excluded.is_correct
      `,
      [attemptId, attempt.questionId, attempt.answerText, attempt.isCorrect],
    );
  }
}

async function persistLessonProgress(
  client,
  walletAddress,
  lessonId,
  score,
  completedAt,
) {
  await client.query(
    `
      insert into lesson.user_lesson_progress (
        wallet_address,
        lesson_id,
        completed,
        score,
        completed_at,
        updated_at
      )
      values ($1, $2, true, $3, $4::timestamptz, now())
      on conflict (wallet_address, lesson_id)
      do update set
        completed = true,
        score = greatest(coalesce(lesson.user_lesson_progress.score, 0), excluded.score),
        completed_at = greatest(
          coalesce(lesson.user_lesson_progress.completed_at, excluded.completed_at),
          excluded.completed_at
        ),
        updated_at = now()
    `,
    [walletAddress, lessonId, score, completedAt],
  );
}

function toCompletionDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function persistVerifiedCompletionEvent(
  client,
  walletAddress,
  lessonId,
  lessonVersionId,
  lessonAttemptId,
  grading,
  completedAt,
) {
  const courseId = await getCourseIdForPublishedLesson(
    client,
    lessonId,
    lessonVersionId,
  );
  const completionDay = toCompletionDay(completedAt);
  const rewardUnits = grading.score > 0 ? 100 : 0;
  const payload = {
    eventType: 'verified_completion.accepted',
    walletAddress,
    courseId,
    lessonId,
    lessonVersionId,
    lessonAttemptId,
    completionDay,
    rewardUnits,
    score: grading.score,
    correctAnswers: grading.correctAnswers,
    totalQuestions: grading.totalQuestions,
    completedAt,
  };

  await client.query(
    `
      insert into lesson.verified_completion_events (
        event_id,
        wallet_address,
        course_id,
        lesson_id,
        lesson_version_id,
        lesson_attempt_id,
        completion_day,
        reward_units,
        score,
        correct_answers,
        total_questions,
        payload
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5::uuid,
        $6::uuid,
        $7::date,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb
      )
      on conflict (event_id) do update set
        payload = excluded.payload,
        reward_units = excluded.reward_units,
        score = excluded.score,
        correct_answers = excluded.correct_answers,
        total_questions = excluded.total_questions
    `,
    [
      lessonAttemptId,
      walletAddress,
      courseId,
      lessonId,
      lessonVersionId,
      lessonAttemptId,
      completionDay,
      rewardUnits,
      grading.score,
      grading.correctAnswers,
      grading.totalQuestions,
      JSON.stringify(payload),
    ],
  );

  return {
    eventId: lessonAttemptId,
    courseId,
    completionDay,
    rewardUnits,
  };
}

async function readVerifiedCompletionEvent(client, lessonAttemptId) {
  const result = await client.query(
    `
      select
        event_id::text as "eventId",
        course_id as "courseId",
        completion_day::text as "completionDay",
        reward_units as "rewardUnits"
      from lesson.verified_completion_events
      where lesson_attempt_id = $1::uuid
      limit 1
    `,
    [lessonAttemptId],
  );

  return result.rows[0] ?? null;
}

export async function readCourseRuntimeState(client, walletAddress, courseId) {
  const state = await ensureCourseRuntimeState(client, walletAddress, courseId);

  return {
    courseId,
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    currentYieldRedirectBps: state.currentYieldRedirectBps,
    extensionDays: state.extensionDays,
    // v2 shield/lapse engine state (spec §4.2) — drives the flame gauge,
    // shield pips, and the penalty banner on the course card.
    shields: Number(state.shields ?? 3),
    lapseCount: Number(state.lapseCount ?? 0),
    lapseOpen: Boolean(state.lapseOpen),
    consecutiveLessonDays: Number(state.consecutiveLessonDays ?? 0),
    // Server-computed day state so the client never does UTC-day math
    // (a UTC+8 user's local "today" is not the streak day).
    lastCompletedDay: state.lastCompletedDay ?? null,
    completedToday: state.lastCompletedDay === currentUtcDay(),
    dayEndsAtUtc: nextUtcMidnightIso(),
    // Engine freeze marker (practice ruling R6): non-null once every published
    // lesson of the course is complete; the miss writer refuses past it.
    courseCompletedAt: state.courseCompletedAt
      ? new Date(state.courseCompletedAt).toISOString()
      : null,
  };
}

function currentUtcDay() {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnightIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

export async function syncCourseRuntimeStateWithLockSnapshot(
  walletAddress,
  courseId,
  lockSnapshot = null,
) {
  if (!hasDatabase()) {
    return null;
  }

  const snapshot = lockSnapshot ?? (await readLockAccountSnapshot(walletAddress, courseId));

  return withTransactionAsWallet(walletAddress, async (client) => {
    await ensureCourseRuntimeState(client, walletAddress, courseId, { forUpdate: true });
    // The custody-core LockAccount only carries custody fields now
    // (owner, mint, principal, timestamps, status). The game layer — streak,
    // savers, redirect_bps, fuel, ichor, last_completed_day — is OWNED BY THE
    // DB and must NOT be overwritten from the chain snapshot. We sync only the
    // custody columns so the on-chain principal/lock window stay reflected in
    // the runtime row.
    await client.query(
      `
        update lesson.user_course_runtime_state
        set lock_account_address = $3,
            stable_mint = $4,
            principal_amount = $5::bigint,
            lock_start_at = $6::timestamptz,
            lock_end_at = $7::timestamptz,
            updated_at = now()
        where wallet_address = $1
          and course_id = $2
      `,
      [
        walletAddress,
        courseId,
        snapshot.lockAccount,
        snapshot.stableMint,
        snapshot.principalAmount,
        unixTimestampSecondsToIso(snapshot.lockStartTs),
        unixTimestampSecondsToIso(snapshot.lockEndTs),
      ],
    );

    return readCourseRuntimeState(client, walletAddress, courseId);
  });
}

/**
 * List the most recent harvest receipts across all wallets. Operator-only
 * (the public endpoint truncates wallet addresses). Used to verify that
 * the runtime scheduler is actually firing harvests in production.
 */
export async function listRecentHarvestReceipts(limit = 20) {
  if (!hasDatabase()) {
    return [];
  }

  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const result = await query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        harvest_id as "harvestId",
        harvested_at as "harvestedAt",
        gross_yield_amount::text as "grossYieldAmount",
        applied
      from lesson.harvest_result_receipts
      order by harvested_at desc
      limit $1
    `,
    [safeLimit],
  );

  return result.rows;
}

export async function listRuntimeSchedulerCandidates(limit = 10) {
  if (!hasDatabase()) {
    return [];
  }

  const result = await query(
    `
      select
        runtime.wallet_address as "walletAddress",
        runtime.course_id as "courseId",
        runtime.current_streak as "currentStreak",
        runtime.last_completed_day::text as "lastCompletedDay",
        runtime.last_miss_day::text as "lastMissDay",
        runtime.last_brewer_burn_ts as "lastBrewerBurnTs",
        runtime.updated_at as "updatedAt",
        runtime.lock_account_address as "lockAccountAddress",
        runtime.course_completed_at as "courseCompletedAt",
        latest_harvest.harvested_at as "lastHarvestedAt"
      from lesson.user_course_runtime_state runtime
      left join lateral (
        select harvested_at
        from lesson.harvest_result_receipts receipts
        where receipts.wallet_address = runtime.wallet_address
          and receipts.course_id = runtime.course_id
          and receipts.harvested_at <= now()
        order by harvested_at desc
        limit 1
      ) latest_harvest on true
      where runtime.lock_account_address is not null
      order by updated_at asc
      limit $1
    `,
    [limit],
  );

  return result.rows;
}

/**
 * Push a runtime-scheduler candidate to the back of the updated_at-asc queue
 * (enroll ruling R11c). The legacy worker calls this for rows it must not
 * process (v2-armed rows, dead lock reads) so one skipped candidate cannot
 * pin the queue and starve every other lock (batch default is 5).
 */
export async function touchRuntimeSchedulerCandidate(walletAddress, courseId) {
  if (!hasDatabase()) return;
  await query(
    `update lesson.user_course_runtime_state
     set updated_at = now()
     where wallet_address = $1 and course_id = $2`,
    [walletAddress, courseId],
  );
}

/**
 * Lazy completion backfill (sweep ruling R9): when every published lesson of
 * the course is complete, stamp course_completed_at (if not already) and
 * return true. Used by the lapse sweep so a finished-but-unclaimed user never
 * accrues lapses that cut their signed voucher bps (spec item 21). `client`
 * must carry the wallet RLS claim (user_lesson_progress is FORCE RLS).
 */
export async function markCourseCompletedIfComplete(client, walletAddress, courseId) {
  const moduleRows = await fetchModuleCompletion(client, walletAddress, courseId);
  if (!isCourseComplete(moduleRows)) return false;
  await client.query(
    `update lesson.user_course_runtime_state
     set course_completed_at = coalesce(course_completed_at, now()),
         updated_at = now()
     where wallet_address = $1 and course_id = $2`,
    [walletAddress, courseId],
  );
  return true;
}

/**
 * Shared course gate for the enroll + eligibility endpoints (enroll ruling
 * R2/R3/R12). Runs BEFORE any RPC: unknown course -> 404 COURSE_NOT_FOUND,
 * lessonless/placeholder course -> 403 COURSE_NOT_LOCKABLE (never armed into
 * a guaranteed-lapse trap), completed course -> 403 COURSE_COMPLETED (spec
 * item 21: relock of a completed course is blocked forever — the on-chain
 * PDA close+re-init makes relock always possible on-chain, so this endpoint
 * IS the off-chain block). Returns the module rows on success.
 */
export async function assertCourseLockable(walletAddress, courseId, { log = null } = {}) {
  const moduleRows = await fetchModuleCompletion({ query }, walletAddress, courseId);

  if (moduleRows.length === 0) {
    const course = await query(`select 1 from lesson.courses where id = $1`, [courseId]);
    if (course.rowCount === 0) {
      throw notFound(`Unknown course: ${courseId}`, 'COURSE_NOT_FOUND');
    }
    throw new HttpError(
      403,
      'Course has no published lessons and cannot be locked against',
      'COURSE_NOT_LOCKABLE',
    );
  }

  const totalLessons = moduleRows.reduce((sum, m) => sum + Number(m.total_lessons), 0);
  if (totalLessons === 0) {
    throw new HttpError(
      403,
      'Course has no published lessons and cannot be locked against',
      'COURSE_NOT_LOCKABLE',
    );
  }

  if (isCourseComplete(moduleRows)) {
    log?.warn?.({ walletAddress, courseId }, 'locks.enroll.relock_blocked');
    throw new HttpError(
      403,
      'Course is already complete; relocking a completed course is not allowed',
      'COURSE_COMPLETED',
    );
  }

  return moduleRows;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Server-side enroll-on-deposit (enroll ruling R1-R10). Every acceptance
 * decision is made exclusively from server-derived data: the PDA is derived
 * here, the lock is read fresh from the chain, and the client's lockAddress
 * is only a config-skew tripwire. Fail-closed: enroll ONLY on verified
 * status ACTIVE with principal > 0; account-missing / PENDING / principal-0
 * are the RPC-lag race and are bounded-retried, never persisted.
 *
 * `readLockFresh` / `retryDelayMs` are injectable for deterministic tests.
 */
export async function enrollActiveLockServerSide(
  walletAddress,
  courseId,
  {
    claimedLockAddress = null,
    log = null,
    readLockFresh = readLockV2AccountFresh,
    retryDelayMs = appConfig.enrollRetryDelayMs,
  } = {},
) {
  if (!hasDatabase()) {
    throw new HttpError(503, 'Enrollment requires the database', 'DB_UNAVAILABLE');
  }

  // R2 + R3: course gate first — no RPC yet, FK made unreachable, completed
  // course blocked.
  await assertCourseLockable(walletAddress, courseId, { log });

  // R4: server-derived PDA; the client's address is only a tripwire.
  const programId = appConfig.vaultV2ProgramId;
  const expected = deriveLockPdaServer(programId, walletAddress, courseId);
  const expectedAddress = expected.toBase58();
  if (claimedLockAddress != null && claimedLockAddress !== expectedAddress) {
    log?.error?.(
      { walletAddress, courseId, expected: expectedAddress, received: claimedLockAddress, programId },
      'locks.enroll.pda_mismatch',
    );
    throw new HttpError(
      409,
      'Client lock address does not match the server-derived lock PDA',
      'LOCK_ADDRESS_MISMATCH',
    );
  }

  // R5 + R6: fresh reads, accept ONLY ACTIVE with principal > 0. Retry the
  // RPC-lag states (missing / PENDING / principal 0) up to 3 more times.
  let account = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs);
    account = await readLockFresh(walletAddress, courseId);
    if (account?.mismatch) {
      log?.error?.(
        {
          walletAddress,
          courseId,
          expected: expectedAddress,
          received: account.lockAddress ?? null,
          reason: account.reason,
          programId,
        },
        'locks.enroll.pda_mismatch',
      );
      throw new HttpError(
        409,
        'On-chain lock account is not a lock owned by this wallet under the configured program',
        'LOCK_ADDRESS_MISMATCH',
      );
    }
    if (account && account.status === 'ACTIVE' && account.principal > 0n) break;
    account = null;
  }

  if (!account) {
    log?.warn?.({ walletAddress, courseId }, 'locks.enroll.retry_exhausted');
    const retryError = new HttpError(
      409,
      'Lock is not yet ACTIVE on-chain; retry shortly',
      'ENROLL_RETRY',
    );
    retryError.retryable = true;
    retryError.retryAfterMs = 4000;
    throw retryError;
  }

  const principal = account.principal;
  const lockStartTs = Number(account.lockStartTs);

  // R7: all writes in ONE wallet-scoped transaction (FORCE RLS on
  // user_course_enrollments keys on the request.jwt.claim.wallet_address GUC).
  const outcome = await withTransactionAsWallet(walletAddress, async (client) => {
    const enrollInsert = await client.query(
      `insert into lesson.user_course_enrollments (wallet_address, course_id)
       values ($1, $2)
       on conflict (wallet_address, course_id) do nothing`,
      [walletAddress, courseId],
    );
    const freshEnrollment = enrollInsert.rowCount === 1;

    await ensureCourseRuntimeState(client, walletAddress, courseId);

    // FOR UPDATE serializes concurrent enrolls so the reset decision can
    // never run twice.
    const custodyRow = await client.query(
      `select lock_account_address,
              extract(epoch from lock_start_at)::bigint as lock_start_epoch
       from lesson.user_course_runtime_state
       where wallet_address = $1 and course_id = $2
       for update`,
      [walletAddress, courseId],
    );
    const stored = custodyRow.rows[0]?.lock_account_address ?? null;
    const storedEpoch =
      custodyRow.rows[0]?.lock_start_epoch != null
        ? Number(custodyRow.rows[0].lock_start_epoch)
        : null;

    // R8 engine-reset matrix, keyed to ON-CHAIN LOCK IDENTITY, never to the
    // enrollments INSERT:
    //   first v2 arm  (stored NULL or != derived PDA, incl. legacy PDAs) -> reset
    //   replay        (same PDA, same immutable lock_start_ts)           -> no reset
    //   relock-after-settlement (same PDA, changed lock_start_ts)        -> reset
    //     (reachable only by settling the old lock, which already forfeited
    //     its yield — not exploitable)
    const firstV2Arm = stored == null || stored !== expectedAddress;
    const relockAfterSettlement = !firstV2Arm && storedEpoch !== lockStartTs;
    const engineReset = firstV2Arm || relockAfterSettlement;
    if (relockAfterSettlement) {
      log?.info?.(
        { walletAddress, courseId, storedEpoch, lockStartTs },
        'locks.enroll.relock_after_settlement',
      );
    }

    // R9 custody update. NEVER write lock_end_at or stable_mint from v2 data —
    // LockV2 has neither field; fabricating an end date corrupts the sweep
    // and the UI (on reset both are cleared).
    if (engineReset) {
      await client.query(
        `update lesson.user_course_runtime_state
         set lock_account_address = $3,
             principal_amount = $4::bigint,
             lock_start_at = to_timestamp($5),
             current_streak = 0,
             shields = 3,
             lapse_count = 0,
             lapse_open = false,
             consecutive_lesson_days = 0,
             stable_mint = null,
             lock_end_at = null,
             updated_at = now()
         where wallet_address = $1 and course_id = $2`,
        [walletAddress, courseId, expectedAddress, principal.toString(), lockStartTs],
      );
    } else {
      await client.query(
        `update lesson.user_course_runtime_state
         set lock_account_address = $3,
             principal_amount = $4::bigint,
             updated_at = now()
         where wallet_address = $1 and course_id = $2`,
        [walletAddress, courseId, expectedAddress, principal.toString()],
      );
    }

    return { freshEnrollment, engineReset };
  });

  const principalUi = formatAtomicUsdcUi(principal);

  // R10: prime the position cache so the course card cannot show a stale NONE
  // for 60s after a successful enroll.
  primeLockPositionCache(walletAddress, courseId, {
    courseId,
    status: 'ACTIVE',
    lockAddress: expectedAddress,
    principalUi,
    principalAtomic: principal.toString(),
    lockStartTs,
    liveValueUi: null,
    asOf: new Date().toISOString(),
  });

  log?.info?.(
    {
      walletAddress,
      courseId,
      freshEnrollment: outcome.freshEnrollment,
      engineReset: outcome.engineReset,
      principalAmount: principal.toString(),
      lockAddress: expectedAddress,
    },
    'locks.enroll.success',
  );

  return {
    enrolled: true,
    courseId,
    lockAddress: expectedAddress,
    principalUi,
    status: 'ACTIVE',
    freshEnrollment: outcome.freshEnrollment,
    engineReset: outcome.engineReset,
  };
}

/**
 * Get all enrolled courses + runtime state + lesson progress for a wallet.
 * Used by the web app to restore state on login from a fresh browser.
 */
export async function getUserEnrollments(walletAddress) {
  if (!hasDatabase()) {
    return { enrollments: [], lessonProgress: [] };
  }

  // Get enrollments with runtime state in one query
  const enrollResult = await queryAsWallet(
    walletAddress,
    `
      SELECT
        uce.course_id AS "courseId",
        uce.enrolled_at AS "enrolledAt",
        ucrs.current_streak AS "currentStreak",
        ucrs.longest_streak AS "longestStreak",
        ucrs.current_yield_redirect_bps AS "currentYieldRedirectBps",
        ucrs.extension_days AS "extensionDays",
        ucrs.last_fuel_credit_day AS "lastFuelCreditDay",
        ucrs.last_brewer_burn_ts AS "lastBrewerBurnTs",
        coalesce(ucrs.shields, 3) AS "shields",
        coalesce(ucrs.lapse_count, 0) AS "lapseCount",
        coalesce(ucrs.lapse_open, false) AS "lapseOpen",
        coalesce(ucrs.consecutive_lesson_days, 0) AS "consecutiveLessonDays",
        ucrs.last_completed_day::text AS "lastCompletedDay"
      FROM lesson.user_course_enrollments uce
      LEFT JOIN lesson.user_course_runtime_state ucrs
        ON ucrs.wallet_address = uce.wallet_address AND ucrs.course_id = uce.course_id
      WHERE uce.wallet_address = $1
      ORDER BY uce.enrolled_at DESC
    `,
    [walletAddress],
  );

  // Get all completed lesson progress
  const progressResult = await queryAsWallet(
    walletAddress,
    `
      SELECT
        lesson_id AS "lessonId",
        completed,
        score,
        completed_at AS "completedAt"
      FROM lesson.user_lesson_progress
      WHERE wallet_address = $1 AND completed = true
    `,
    [walletAddress],
  );

  // Shape enrollments with runtime snapshots
  const enrollments = enrollResult.rows.map((row) => ({
    courseId: row.courseId,
    enrolledAt: row.enrolledAt,
    runtime: row.currentStreak != null
      ? {
          courseId: row.courseId,
          currentStreak: row.currentStreak,
          longestStreak: row.longestStreak,
          currentYieldRedirectBps: row.currentYieldRedirectBps,
          extensionDays: row.extensionDays,
          shields: Number(row.shields),
          lapseCount: Number(row.lapseCount),
          lapseOpen: Boolean(row.lapseOpen),
          consecutiveLessonDays: Number(row.consecutiveLessonDays),
          lastCompletedDay: row.lastCompletedDay ?? null,
          completedToday: row.lastCompletedDay === currentUtcDay(),
          dayEndsAtUtc: nextUtcMidnightIso(),
          // voucherAvailable intentionally omitted here: computing it per
          // enrollment costs N module-check queries. Enrollments paint
          // gauges; the CLAIM CTA arms from the per-course snapshot.
        }
      : null,
  }));

  return {
    enrollments,
    lessonProgress: progressResult.rows,
  };
}

export async function getCourseRuntimeSnapshot(walletAddress, courseId) {
  if (!hasDatabase()) {
    return {
      courseId,
      currentStreak: 0,
      longestStreak: 0,
      currentYieldRedirectBps: 0,
      extensionDays: 0,
      shields: 3,
      lapseCount: 0,
      lapseOpen: false,
      consecutiveLessonDays: 0,
      lastCompletedDay: null,
      completedToday: false,
      dayEndsAtUtc: nextUtcMidnightIso(),
      voucherAvailable: false,
    };
  }

  return withTransactionAsWallet(walletAddress, async (client) => {
    const snapshot = await readCourseRuntimeState(client, walletAddress, courseId);
    // voucherAvailable: every module/lesson complete AND the signer is
    // configured — the exact conditions under which the voucher endpoint
    // returns 200. Fail-closed: an unarmed deploy never renders CLAIM.
    const moduleRows = await fetchModuleCompletion(client, walletAddress, courseId);
    return {
      ...snapshot,
      voucherAvailable: isCourseComplete(moduleRows) && voucherSigningConfigured(),
    };
  });
}

function mapRelayLifecycleStatus(rawStatus) {
  if (rawStatus === 'published') return 'published';
  if (rawStatus === 'publishing') return 'publishing';
  if (rawStatus === 'failed') return 'failed';
  return 'pending';
}

export async function getCourseRuntimeHistory(walletAddress, courseId, limit = 12) {
  if (!hasDatabase()) {
    return {
      courseId,
      burnCount: 0,
      missCount: 0,
      extensionDaysAdded: 0,
      events: [],
    };
  }

  const [summaryResult, eventsResult] = await Promise.all([
    query(
      `
        select
          (
            select count(*)::int
            from lesson.fuel_burn_cycle_receipts
            where wallet_address = $1
              and course_id = $2
              and applied = true
              and reason = 'BURNED'
          ) as "burnCount",
          (
            select count(*)::int
            from lesson.miss_consequence_receipts
            where wallet_address = $1
              and course_id = $2
              and applied = true
          ) as "missCount",
          (
            select coalesce(sum(greatest(extension_days_after - extension_days_before, 0)), 0)::int
            from lesson.miss_consequence_receipts
            where wallet_address = $1
              and course_id = $2
          ) as "extensionDaysAdded"
      `,
      [walletAddress, courseId],
    ),
    query(
      `
        select *
        from (
          select
            'FUEL_BURN'::text as "eventType",
            cycle_id as "eventId",
            burned_at as "occurredAt",
            null::text as "eventDay",
            applied,
            reason,
            fuel_before as "fuelBefore",
            fuel_after as "fuelAfter",
            null::int as "saverCountBefore",
            null::int as "saverCountAfter",
            null::int as "redirectBpsBefore",
            null::int as "redirectBpsAfter",
            null::int as "extensionDaysBefore",
            null::int as "extensionDaysAfter",
            lock_vault_status as "lockVaultStatus",
            lock_vault_transaction_signature as "lockVaultTransactionSignature",
            lock_vault_last_error as "lockVaultLastError",
            created_at as "createdAt"
          from lesson.fuel_burn_cycle_receipts
          where wallet_address = $1
            and course_id = $2

          union all

          select
            'MISS'::text as "eventType",
            miss_event_id as "eventId",
            created_at as "occurredAt",
            miss_day::text as "eventDay",
            applied,
            reason,
            null::int as "fuelBefore",
            null::int as "fuelAfter",
            saver_count_before as "saverCountBefore",
            saver_count_after as "saverCountAfter",
            redirect_bps_before as "redirectBpsBefore",
            redirect_bps_after as "redirectBpsAfter",
            extension_days_before as "extensionDaysBefore",
            extension_days_after as "extensionDaysAfter",
            lock_vault_status as "lockVaultStatus",
            lock_vault_transaction_signature as "lockVaultTransactionSignature",
            lock_vault_last_error as "lockVaultLastError",
            created_at as "createdAt"
          from lesson.miss_consequence_receipts
          where wallet_address = $1
            and course_id = $2
        ) events
        order by "occurredAt" desc, "createdAt" desc
        limit $3
      `,
      [walletAddress, courseId, limit],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    burnCount: 0,
    missCount: 0,
    extensionDaysAdded: 0,
  };

  return {
    courseId,
    burnCount: Number(summary.burnCount ?? 0),
    missCount: Number(summary.missCount ?? 0),
    extensionDaysAdded: Number(summary.extensionDaysAdded ?? 0),
    events: eventsResult.rows.map((row) => ({
      eventType: row.eventType,
      eventId: row.eventId,
      occurredAt: row.occurredAt,
      eventDay: row.eventDay ?? null,
      applied: Boolean(row.applied),
      reason: row.reason ?? null,
      fuelBefore: row.fuelBefore == null ? null : Number(row.fuelBefore),
      fuelAfter: row.fuelAfter == null ? null : Number(row.fuelAfter),
      saverCountBefore:
        row.saverCountBefore == null ? null : Number(row.saverCountBefore),
      saverCountAfter: row.saverCountAfter == null ? null : Number(row.saverCountAfter),
      redirectBpsBefore:
        row.redirectBpsBefore == null ? null : Number(row.redirectBpsBefore),
      redirectBpsAfter:
        row.redirectBpsAfter == null ? null : Number(row.redirectBpsAfter),
      extensionDaysBefore:
        row.extensionDaysBefore == null ? null : Number(row.extensionDaysBefore),
      extensionDaysAfter:
        row.extensionDaysAfter == null ? null : Number(row.extensionDaysAfter),
      lockVaultStatus: mapRelayLifecycleStatus(row.lockVaultStatus),
      lockVaultTransactionSignature: row.lockVaultTransactionSignature ?? null,
      lockVaultLastError: row.lockVaultLastError ?? null,
    })),
  };
}

async function readUnlockReceipt(client, walletAddress, unlockTxSignature) {
  const result = await client.query(
    `
      select
        unlock_tx_signature as "unlockTxSignature",
        wallet_address as "walletAddress",
        course_id as "courseId",
        lock_account_address as "lockAccountAddress",
        principal_amount_ui as "principalAmountUi",
        lock_end_at as "lockEndAt",
        unlocked_at as "unlockedAt",
        verified_slot as "verifiedSlot",
        verified_block_time as "verifiedBlockTime",
        created_at as "createdAt"
      from lesson.unlock_receipts
      where wallet_address = $1
        and unlock_tx_signature = $2
      limit 1
    `,
    [walletAddress, unlockTxSignature],
  );

  return result.rows[0] ?? null;
}

async function readRuntimeLockMetadata(client, walletAddress, courseId) {
  const result = await client.query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        lock_account_address as "lockAccountAddress",
        stable_mint as "stableMint",
        principal_amount as "principalAmount",
        lock_start_at as "lockStartAt",
        lock_end_at as "lockEndAt"
      from lesson.user_course_runtime_state
      where wallet_address = $1
        and course_id = $2
      limit 1
    `,
    [walletAddress, courseId],
  );

  return result.rows[0] ?? null;
}

async function readRuntimeLockMetadataByLockAccount(client, lockAccountAddress) {
  const result = await client.query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        lock_account_address as "lockAccountAddress",
        stable_mint as "stableMint",
        principal_amount as "principalAmount",
        lock_start_at as "lockStartAt",
        lock_end_at as "lockEndAt"
      from lesson.user_course_runtime_state
      where lock_account_address = $1
      order by updated_at desc
      limit 1
    `,
    [lockAccountAddress],
  );

  return result.rows[0] ?? null;
}

async function readUnlockIndexerState(client) {
  const result = await client.query(
    `
      select
        program_id as "programId",
        last_signature as "lastSignature",
        last_slot as "lastSlot",
        updated_at as "updatedAt"
      from lesson.unlock_indexer_state
      where program_id = $1
      limit 1
    `,
    [appConfig.lockVaultProgramId],
  );

  return result.rows[0] ?? null;
}

async function writeUnlockIndexerState(client, lastSignature, lastSlot) {
  await client.query(
    `
      insert into lesson.unlock_indexer_state (
        program_id,
        last_signature,
        last_slot
      )
      values ($1, $2, $3)
      on conflict (program_id)
      do update set
        last_signature = excluded.last_signature,
        last_slot = excluded.last_slot,
        updated_at = now()
    `,
    [appConfig.lockVaultProgramId, lastSignature, lastSlot],
  );
}

export async function recordUnlockReceipt(walletAddress, payload) {
  if (!payload?.unlockTxSignature || typeof payload.unlockTxSignature !== 'string') {
    throw badRequest('unlockTxSignature is required', 'MISSING_UNLOCK_TX_SIGNATURE');
  }
  if (!payload?.courseId || typeof payload.courseId !== 'string') {
    throw badRequest('courseId is required', 'MISSING_COURSE_ID');
  }
  if (!payload?.lockAccountAddress || typeof payload.lockAccountAddress !== 'string') {
    throw badRequest('lockAccountAddress is required', 'MISSING_LOCK_ACCOUNT_ADDRESS');
  }
  if (!payload?.principalAmountUi || typeof payload.principalAmountUi !== 'string') {
    throw badRequest('principalAmountUi is required', 'MISSING_PRINCIPAL_AMOUNT_UI');
  }
  if (!payload?.lockEndDate || typeof payload.lockEndDate !== 'string') {
    throw badRequest('lockEndDate is required', 'MISSING_LOCK_END_DATE');
  }

  const unlockedAt =
    typeof payload.unlockedAt === 'string' && payload.unlockedAt
      ? payload.unlockedAt
      : new Date().toISOString();

  if (!hasDatabase()) {
    return {
      unlockTxSignature: payload.unlockTxSignature,
      walletAddress,
      courseId: payload.courseId,
      lockAccountAddress: payload.lockAccountAddress,
      principalAmountUi: payload.principalAmountUi,
      lockEndAt: payload.lockEndDate,
      unlockedAt,
      verifiedSlot: null,
      verifiedBlockTime: null,
    };
  }

  if (!hasLockVaultReadConfig()) {
    throw badRequest('LockVault read config is incomplete', 'LOCK_VAULT_READ_DISABLED');
  }

  const verification = await verifyUnlockTransaction({
    unlockTxSignature: payload.unlockTxSignature,
    walletAddress,
    lockAccountAddress: payload.lockAccountAddress,
  });
  if (!verification.valid) {
    throw badRequest('Unlock transaction could not be verified', verification.reason);
  }

  return withTransactionAsWallet(walletAddress, async (client) => {
    const existing = await readUnlockReceipt(client, walletAddress, payload.unlockTxSignature);
    if (existing) {
      return existing;
    }

    await client.query(
      `
        insert into lesson.unlock_receipts (
          unlock_tx_signature,
          wallet_address,
          course_id,
          lock_account_address,
          principal_amount_ui,
          lock_end_at,
          unlocked_at,
          verified_slot,
          verified_block_time
        )
        values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::bigint, $9::timestamptz)
        on conflict (unlock_tx_signature) do nothing
      `,
      [
        payload.unlockTxSignature,
        walletAddress,
        payload.courseId,
        verification.lockAccountAddress ?? payload.lockAccountAddress,
        payload.principalAmountUi,
        payload.lockEndDate,
        unlockedAt,
        verification.slot,
        verification.blockTime,
      ],
    );

    return readUnlockReceipt(client, walletAddress, payload.unlockTxSignature);
  });
}

export async function recordUnlockReceiptFromChain(unlockTxSignature) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
      unlockTxSignature,
    };
  }

  if (!hasLockVaultReadConfig()) {
    return {
      processed: false,
      reason: 'LOCK_VAULT_READ_DISABLED',
      unlockTxSignature,
    };
  }

  const inspection = await inspectUnlockTransaction(unlockTxSignature);
  if (!inspection.valid) {
    return {
      processed: false,
      reason: inspection.reason,
      unlockTxSignature,
    };
  }

  const metadata = await withTransaction(async (client) =>
    readRuntimeLockMetadataByLockAccount(client, inspection.lockAccountAddress),
  );
  if (!metadata) {
    return {
      processed: false,
      reason: 'LOCK_METADATA_NOT_FOUND',
      unlockTxSignature,
      walletAddress: inspection.walletAddress,
      lockAccountAddress: inspection.lockAccountAddress,
    };
  }

  const existing = await withTransactionAsWallet(metadata.walletAddress, async (client) =>
    readUnlockReceipt(client, metadata.walletAddress, unlockTxSignature),
  );
  if (existing) {
    return {
      processed: false,
      reason: 'ALREADY_RECORDED',
      unlockTxSignature,
      walletAddress: metadata.walletAddress,
      courseId: metadata.courseId,
      receipt: existing,
    };
  }

  const receipt = await recordUnlockReceipt(metadata.walletAddress, {
    courseId: metadata.courseId,
    lockAccountAddress: metadata.lockAccountAddress,
    principalAmountUi: formatAtomicUsdcUi(metadata.principalAmount ?? 0),
    lockEndDate:
      metadata.lockEndAt instanceof Date
        ? metadata.lockEndAt.toISOString()
        : String(metadata.lockEndAt),
    unlockedAt: inspection.blockTime ?? new Date().toISOString(),
    unlockTxSignature,
  });

  return {
    processed: true,
    reason: 'RECORDED_FROM_CHAIN',
    unlockTxSignature,
    walletAddress: metadata.walletAddress,
    courseId: metadata.courseId,
    receipt,
  };
}

export async function syncUnlockReceiptsFromChain(limit = 25) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasLockVaultReadConfig()) {
    return {
      processed: false,
      reason: 'LOCK_VAULT_READ_DISABLED',
    };
  }

  const recentSignatures = await listRecentLockVaultProgramSignatures(limit);
  if (recentSignatures.length === 0) {
    return {
      processed: false,
      reason: 'NO_SIGNATURES',
      scanned: 0,
      recorded: 0,
      skipped: 0,
    };
  }

  return withTransaction(async (client) => {
    const state = await readUnlockIndexerState(client);
    const lastSeenSignature = state?.lastSignature ?? null;

    const unseen = [];
    for (const entry of recentSignatures) {
      if (lastSeenSignature && entry.signature === lastSeenSignature) {
        break;
      }
      unseen.push(entry);
    }

    if (unseen.length === 0) {
      return {
        processed: false,
        reason: 'NO_NEW_SIGNATURES',
        scanned: 0,
        recorded: 0,
        skipped: 0,
      };
    }

    let recorded = 0;
    let skipped = 0;
    const results = [];

    for (const entry of unseen.slice().reverse()) {
      try {
        const result = await recordUnlockReceiptFromChain(entry.signature);
        if (result.processed) {
          recorded += 1;
        } else {
          skipped += 1;
        }
        results.push(result);
      } catch (error) {
        skipped += 1;
        results.push({
          processed: false,
          reason: error instanceof Error ? error.message : String(error),
          unlockTxSignature: entry.signature,
        });
      }
    }

    const newest = recentSignatures[0];
    await writeUnlockIndexerState(client, newest.signature, newest.slot ?? null);

    return {
      processed: recorded > 0,
      reason: recorded > 0 ? 'SYNCED' : 'NO_UNLOCKS_FOUND',
      scanned: unseen.length,
      recorded,
      skipped,
      lastSignature: newest.signature,
      results,
    };
  });
}

export async function getUnlockReceipts(walletAddress, limit = 20) {
  if (!hasDatabase()) {
    return {
      receipts: [],
    };
  }

  const result = await queryAsWallet(
    walletAddress,
    `
      select
        unlock_tx_signature as "unlockTxSignature",
        wallet_address as "walletAddress",
        course_id as "courseId",
        lock_account_address as "lockAccountAddress",
        principal_amount_ui as "principalAmountUi",
        lock_end_at as "lockEndAt",
        unlocked_at as "unlockedAt",
        verified_slot as "verifiedSlot",
        verified_block_time as "verifiedBlockTime",
        created_at as "createdAt"
      from lesson.unlock_receipts
      where wallet_address = $1
      order by unlocked_at desc
      limit $2
    `,
    [walletAddress, limit],
  );

  return {
    receipts: result.rows,
  };
}

// ── Dead on-chain lock_vault game-layer publishes (now inert) ─────────────
// The custody-core lock_vault program no longer has apply_verified_completion
// or consume_saver_or_apply_full_consequence. The game layer is fully
// off-chain — these DB rows are the source of truth and are already written
// by the recording paths (persistVerifiedCompletionEvent,
// consumeSaverOrApplyFullConsequence). These exported stubs remain only so
// the legacy /v1/internal/.../publish routes return cleanly. The
// *_publish_status columns are left inert (deferred destructive cleanup).
// publishFuelBurnReceipt was deleted with its route (legacy-deletion ruling).
export async function publishVerifiedCompletionEvent() {
  return { processed: false, reason: 'ONCHAIN_PUBLISH_REMOVED' };
}

export async function publishMissConsequenceReceipt() {
  return { processed: false, reason: 'ONCHAIN_PUBLISH_REMOVED' };
}

async function readHarvestResultReceipt(client, walletAddress, courseId, harvestId) {
  const result = await client.query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        harvest_id as "harvestId",
        harvested_at as "harvestedAt",
        gross_yield_amount as "grossYieldAmount",
        applied,
        reason,
        platform_fee_amount as "platformFeeAmount",
        redirected_amount as "redirectedAmount",
        ichor_awarded as "ichorAwarded",
        lock_vault_status as "lockVaultStatus",
        lock_vault_published_at as "lockVaultPublishedAt",
        lock_vault_last_error as "lockVaultLastError",
        lock_vault_transaction_signature as "lockVaultTransactionSignature",
        community_pot_status as "communityPotStatus",
        community_pot_published_at as "communityPotPublishedAt",
        community_pot_last_error as "communityPotLastError",
        community_pot_transaction_signature as "communityPotTransactionSignature",
        community_pot_window_id as "communityPotWindowId"
      from lesson.harvest_result_receipts
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
      limit 1
    `,
    [walletAddress, courseId, harvestId],
  );

  return result.rows[0] ?? null;
}

export async function recordHarvestResult(
  walletAddress,
  courseId,
  harvestId,
  grossYieldAmount,
  harvestedAt = null,
  redirectedAmount = null,
) {
  if (!harvestId || typeof harvestId !== 'string') {
    throw badRequest('harvestId is required', 'MISSING_HARVEST_ID');
  }

  const amount =
    typeof grossYieldAmount === 'string' || typeof grossYieldAmount === 'number'
      ? BigInt(grossYieldAmount)
      : null;
  if (amount == null || amount < 0n) {
    throw badRequest('grossYieldAmount must be a non-negative integer', 'INVALID_GROSS_YIELD');
  }

  // redirected_amount = how much of this harvest went to the community pot
  // instead of the user. With the fire-timer model: 0 when fire was lit at
  // harvest moment, gross when fire was out. Old callers can leave it null;
  // the column stays nullable for backwards compat.
  const redirected =
    redirectedAmount == null
      ? null
      : typeof redirectedAmount === 'string' || typeof redirectedAmount === 'number'
        ? BigInt(redirectedAmount)
        : null;
  if (redirected != null && (redirected < 0n || redirected > amount)) {
    throw badRequest(
      'redirectedAmount must be between 0 and grossYieldAmount',
      'INVALID_REDIRECTED_AMOUNT',
    );
  }

  const harvestedAtValue = harvestedAt ?? new Date().toISOString();

  if (!hasDatabase()) {
    return {
      harvestId,
      harvestedAt: harvestedAtValue,
      grossYieldAmount: amount.toString(),
      redirectedAmount: redirected != null ? redirected.toString() : null,
      lockVaultStatus: 'pending',
      communityPotStatus: 'pending',
    };
  }

  return withTransactionAsWallet(walletAddress, async (client) => {
    const existingReceipt = await readHarvestResultReceipt(
      client,
      walletAddress,
      courseId,
      harvestId,
    );

    if (existingReceipt) {
      return existingReceipt;
    }

    await client.query(
      `
        insert into lesson.harvest_result_receipts (
          wallet_address,
          course_id,
          harvest_id,
          harvested_at,
          gross_yield_amount,
          redirected_amount
        )
        values ($1, $2, $3, $4::timestamptz, $5::bigint, $6::bigint)
      `,
      [
        walletAddress,
        courseId,
        harvestId,
        harvestedAtValue,
        amount.toString(),
        redirected != null ? redirected.toString() : null,
      ],
    );

    return readHarvestResultReceipt(client, walletAddress, courseId, harvestId);
  });
}

// feedFireForCourse, claimUnclaimedYield, buyStreakSaver, and
// getBreweryState were deleted with their routes (legacy-deletion ruling).
// Unclaimed legacy yield in harvest_result_receipts is accepted as stranded
// (devnet-era value; CSV-exported before the deploy per the ruling).

// Inert: the custody-core lock_vault has no apply_harvest_result instruction.
// Harvest results live in lesson.harvest_result_receipts (written by
// recordHarvestResult) and drive ichor off-chain. Only the community_pot
// redirect (below) is still published on-chain. The lock_vault_* publish
// columns are left inert (deferred destructive cleanup).
export async function publishHarvestResultReceipt() {
  return { processed: false, reason: 'ONCHAIN_PUBLISH_REMOVED' };
}

async function claimHarvestRedirectReceipt(
  walletAddress,
  courseId,
  harvestId,
  retryFailed = false,
) {
  // The lock_vault harvest publish is gone (custody-core program), so the
  // community_pot redirect no longer waits on lock_vault_status. It claims
  // purely on its own community_pot_status — the harvest receipt row (written
  // by recordHarvestResult) is the only precondition.
  const claimableStatuses = retryFailed ? ['pending', 'failed'] : ['pending'];
  const result = await query(
    `
      update lesson.harvest_result_receipts
      set community_pot_status = 'publishing',
          community_pot_last_error = null
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
        and community_pot_status = any($4::text[])
      returning
        wallet_address as "walletAddress",
        course_id as "courseId",
        harvest_id as "harvestId",
        harvested_at as "harvestedAt",
        gross_yield_amount as "grossYieldAmount",
        redirected_amount as "redirectedAmount",
        lock_vault_status as "lockVaultStatus",
        community_pot_status as "communityPotStatus"
    `,
    [walletAddress, courseId, harvestId, claimableStatuses],
  );

  if (result.rowCount > 0) {
    return { receipt: result.rows[0], reason: 'CLAIMED' };
  }

  const current = await query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        harvest_id as "harvestId",
        harvested_at as "harvestedAt",
        gross_yield_amount as "grossYieldAmount",
        redirected_amount as "redirectedAmount",
        lock_vault_status as "lockVaultStatus",
        community_pot_status as "communityPotStatus",
        community_pot_published_at as "communityPotPublishedAt",
        community_pot_last_error as "communityPotLastError",
        community_pot_transaction_signature as "communityPotTransactionSignature",
        community_pot_window_id as "communityPotWindowId"
      from lesson.harvest_result_receipts
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
      limit 1
    `,
    [walletAddress, courseId, harvestId],
  );

  if (current.rowCount === 0) {
    return { receipt: null, reason: 'RECEIPT_NOT_FOUND' };
  }

  const existing = current.rows[0];
  if (existing.communityPotStatus === 'published') {
    return { receipt: existing, reason: 'ALREADY_PUBLISHED' };
  }

  if (existing.communityPotStatus === 'publishing') {
    return { receipt: existing, reason: 'ALREADY_PUBLISHING' };
  }

  return { receipt: existing, reason: 'RETRY_REQUIRED' };
}

async function markHarvestRedirectPublished(
  walletAddress,
  courseId,
  harvestId,
  values,
) {
  await query(
    `
      update lesson.harvest_result_receipts
      set community_pot_status = 'published',
          community_pot_published_at = now(),
          community_pot_last_error = null,
          community_pot_transaction_signature = $4,
          community_pot_window_id = $5::bigint
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
    `,
    [
      walletAddress,
      courseId,
      harvestId,
      values.signature,
      values.windowId,
    ],
  );
}

async function markHarvestRedirectFailed(walletAddress, courseId, harvestId, error) {
  await query(
    `
      update lesson.harvest_result_receipts
      set community_pot_status = 'failed',
          community_pot_last_error = $4
      where wallet_address = $1
        and course_id = $2
        and harvest_id = $3
    `,
    [walletAddress, courseId, harvestId, error],
  );
}

function computeWeightedPayouts(totalAmount, entries) {
  if (entries.length === 0 || totalAmount <= 0n) {
    return entries.map((entry) => ({
      ...entry,
      payoutAmount: 0n,
      remainder: 0n,
    }));
  }

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0n);
  if (totalWeight <= 0n) {
    return entries.map((entry) => ({
      ...entry,
      payoutAmount: 0n,
      remainder: 0n,
    }));
  }

  const provisional = entries.map((entry) => {
    const numerator = totalAmount * entry.weight;
    return {
      ...entry,
      payoutAmount: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });

  const allocated = provisional.reduce((sum, entry) => sum + entry.payoutAmount, 0n);
  let leftover = totalAmount - allocated;
  const ranked = [...provisional].sort((left, right) => {
    if (left.remainder === right.remainder) {
      return `${left.walletAddress}:${left.courseId}`.localeCompare(
        `${right.walletAddress}:${right.courseId}`,
      );
    }
    return left.remainder > right.remainder ? -1 : 1;
  });

  for (const entry of ranked) {
    if (leftover <= 0n) {
      break;
    }
    entry.payoutAmount += 1n;
    leftover -= 1n;
  }

  return provisional;
}

async function readDistributionSnapshotRows(windowId) {
  const result = await query(
    `
      select
        window_id as "windowId",
        wallet_address as "walletAddress",
        course_id as "courseId",
        current_streak as "currentStreak",
        principal_amount as "principalAmount",
        weight,
        payout_amount as "payoutAmount",
        status,
        distribution_transaction_signature as "distributionTransactionSignature",
        distribution_last_error as "distributionLastError",
        distributed_at as "distributedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from lesson.community_pot_distribution_snapshots
      where window_id = $1
      order by payout_amount desc, wallet_address asc, course_id asc
    `,
    [windowId],
  );

  return result.rows;
}

async function claimDistributionSnapshotRows(windowId, batchSize = 10, retryFailed = false) {
  const claimableStatuses = retryFailed ? ['pending', 'failed'] : ['pending'];
  const result = await query(
    `
      with next_rows as (
        select ctid
        from lesson.community_pot_distribution_snapshots
        where window_id = $1
          and status = any($2::text[])
        order by payout_amount desc, wallet_address asc, course_id asc
        limit $3
        for update skip locked
      )
      update lesson.community_pot_distribution_snapshots snapshots
      set status = 'publishing',
          distribution_last_error = null,
          updated_at = now()
      from next_rows
      where snapshots.ctid = next_rows.ctid
      returning
        window_id as "windowId",
        wallet_address as "walletAddress",
        course_id as "courseId",
        current_streak as "currentStreak",
        principal_amount as "principalAmount",
        weight,
        payout_amount as "payoutAmount",
        status
    `,
    [windowId, claimableStatuses, batchSize],
  );

  return result.rows;
}

async function markDistributionSnapshotDistributed(
  windowId,
  walletAddress,
  courseId,
  signature,
) {
  await query(
    `
      update lesson.community_pot_distribution_snapshots
      set status = 'distributed',
          distribution_transaction_signature = $4,
          distribution_last_error = null,
          distributed_at = now(),
          updated_at = now()
      where window_id = $1
        and wallet_address = $2
        and course_id = $3
    `,
    [windowId, walletAddress, courseId, signature],
  );
}

async function markDistributionSnapshotFailed(windowId, walletAddress, courseId, error) {
  await query(
    `
      update lesson.community_pot_distribution_snapshots
      set status = 'failed',
          distribution_last_error = $4,
          updated_at = now()
      where window_id = $1
        and wallet_address = $2
        and course_id = $3
    `,
    [windowId, walletAddress, courseId, error],
  );
}

async function seedDistributionSnapshotRows(windowId, entries) {
  if (entries.length === 0) {
    return [];
  }

  const values = [];
  const params = [];
  let index = 1;

  for (const entry of entries) {
    values.push(
      `($${index++}, $${index++}, $${index++}, $${index++}, $${index++}::bigint, $${index++}::bigint, $${index++}::bigint)`,
    );
    params.push(
      windowId,
      entry.walletAddress,
      entry.courseId,
      entry.currentStreak,
      entry.principalAmount.toString(),
      entry.weight.toString(),
      entry.payoutAmount.toString(),
    );
  }

  await query(
    `
      insert into lesson.community_pot_distribution_snapshots (
        window_id,
        wallet_address,
        course_id,
        current_streak,
        principal_amount,
        weight,
        payout_amount
      )
      values ${values.join(', ')}
      on conflict (window_id, wallet_address, course_id) do nothing
    `,
    params,
  );

  return readDistributionSnapshotRows(windowId);
}

export async function publishHarvestRedirectToCommunityPot(
  walletAddress,
  courseId,
  harvestId,
  retryFailed = false,
) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasCommunityPotRelayConfig()) {
    return {
      processed: false,
      reason: 'COMMUNITY_POT_RELAY_DISABLED',
    };
  }

  const claim = await claimHarvestRedirectReceipt(
    walletAddress,
    courseId,
    harvestId,
    retryFailed,
  );
  if (!claim.receipt) {
    return {
      processed: false,
      reason: claim.reason,
    };
  }

  if (claim.reason !== 'CLAIMED') {
    return {
      processed: false,
      reason: claim.reason,
      receipt: claim.receipt,
    };
  }

  try {
    const redirectedAmount = BigInt(claim.receipt.redirectedAmount ?? 0);
    const windowId = deriveCommunityPotWindowId(claim.receipt.harvestedAt);

    if (redirectedAmount <= 0n) {
      await markHarvestRedirectPublished(walletAddress, courseId, harvestId, {
        signature: null,
        windowId,
      });

      return {
        processed: true,
        reason: 'SKIPPED_NO_REDIRECT',
        walletAddress,
        courseId,
        harvestId,
        redirectedAmount: redirectedAmount.toString(),
        windowId,
      };
    }

    const publishResult = await publishRedirectToCommunityPot({
      redirectEventId: harvestId,
      harvestedAt: claim.receipt.harvestedAt,
      redirectedAmount: redirectedAmount.toString(),
    });

    await markHarvestRedirectPublished(walletAddress, courseId, harvestId, {
      signature: publishResult.signature,
      windowId: publishResult.windowId,
    });

    return {
      processed: true,
      reason: 'PUBLISHED',
      walletAddress,
      courseId,
      harvestId,
      redirectedAmount: redirectedAmount.toString(),
      signature: publishResult.signature,
      authority: publishResult.authority,
      windowId: publishResult.windowId,
      windowAccount: publishResult.windowAccount,
      receiptAccount: publishResult.receiptAccount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markHarvestRedirectFailed(walletAddress, courseId, harvestId, message);

    return {
      processed: false,
      reason: 'PUBLISH_FAILED',
      walletAddress,
      courseId,
      harvestId,
      error: message,
    };
  }
}

export async function closeCommunityPotWindowAndSnapshot(windowId, closedAt = null) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasCommunityPotRelayConfig()) {
    return {
      processed: false,
      reason: 'COMMUNITY_POT_RELAY_DISABLED',
    };
  }

  const existingDistributionWindow = await readCommunityPotDistributionWindow(windowId);
  const existingRows = await readDistributionSnapshotRows(windowId);
  const repairableEmptyWindow =
    existingDistributionWindow &&
    Number(existingDistributionWindow.totalWeight) === 0 &&
    Number(existingDistributionWindow.eligibleRecipientCount) === 0 &&
    Number(existingDistributionWindow.distributionCount) === 0 &&
    existingRows.length === 0;

  if (existingDistributionWindow && !repairableEmptyWindow) {
    return {
      processed: false,
      reason: 'ALREADY_CLOSED',
      distributionWindow: existingDistributionWindow,
      recipients: existingRows,
    };
  }

  const potWindow = await readCommunityPotWindow(windowId);
  if (!potWindow) {
    return {
      processed: false,
      reason: 'WINDOW_NOT_FOUND',
    };
  }

  // Streak is DB-owned now (the custody-core lock_vault no longer tracks it),
  // so read current_streak from runtime state and only use the on-chain
  // snapshot for custody facts (lock status + principal).
  const runtimeResult = await query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        current_streak as "currentStreak"
      from lesson.user_course_runtime_state
      order by wallet_address asc, course_id asc
    `,
  );

  const eligible = [];
  for (const row of runtimeResult.rows) {
    try {
      const snapshot = await readLockAccountSnapshot(row.walletAddress, row.courseId);
      if (snapshot.status !== 0) {
        continue;
      }

      const currentStreak = Number(row.currentStreak ?? 0);
      if (currentStreak <= 0) {
        continue;
      }

      const principalAmount = BigInt(snapshot.principalAmount);
      const weight = principalAmount * BigInt(currentStreak);
      if (weight <= 0n) {
        continue;
      }

      eligible.push({
        walletAddress: row.walletAddress,
        courseId: row.courseId,
        currentStreak,
        principalAmount,
        weight,
      });
    } catch {
      // Skip locks that no longer exist or cannot be read.
    }
  }

  const payouts = computeWeightedPayouts(BigInt(potWindow.totalRedirectedAmount), eligible);
  const rows = await seedDistributionSnapshotRows(windowId, payouts);
  const totalWeight = payouts.reduce((sum, entry) => sum + entry.weight, 0n);
  const closedAtValue = closedAt ?? new Date().toISOString();
  const closeResult = await closeCommunityPotDistributionWindow({
    windowId,
    totalWeight: totalWeight.toString(),
    eligibleRecipientCount: payouts.length,
    closedAt: closedAtValue,
  });
  const distributionWindow = await readCommunityPotDistributionWindow(windowId);

  return {
    processed: true,
    reason: 'CLOSED',
    windowId,
    potWindow,
    distributionWindow,
    signature: closeResult.signature,
    recipients: rows,
  };
}

export async function distributeCommunityPotWindowBatch(
  windowId,
  batchSize = 10,
  retryFailed = false,
) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasCommunityPotRelayConfig()) {
    return {
      processed: false,
      reason: 'COMMUNITY_POT_RELAY_DISABLED',
    };
  }

  const distributionWindow = await readCommunityPotDistributionWindow(windowId);
  if (!distributionWindow) {
    return {
      processed: false,
      reason: 'WINDOW_NOT_CLOSED',
    };
  }

  const claimedRows = await claimDistributionSnapshotRows(windowId, batchSize, retryFailed);
  if (claimedRows.length === 0) {
    return {
      processed: false,
      reason: 'NO_PENDING_RECIPIENTS',
      distributionWindow,
      recipients: await readDistributionSnapshotRows(windowId),
    };
  }

  const potVaultBefore = await readCommunityPotVaultBalance();
  const results = [];

  for (const row of claimedRows) {
    try {
      const publishResult = await distributeCommunityPotWindow({
        windowId,
        walletAddress: row.walletAddress,
        courseId: row.courseId,
        amount: row.payoutAmount,
        distributedAt: new Date().toISOString(),
      });

      await markDistributionSnapshotDistributed(
        windowId,
        row.walletAddress,
        row.courseId,
        publishResult.signature,
      );

      results.push({
        walletAddress: row.walletAddress,
        courseId: row.courseId,
        payoutAmount: row.payoutAmount,
        status: 'distributed',
        signature: publishResult.signature,
        recipientStableTokenAccount: publishResult.recipientStableTokenAccount,
        potVault: publishResult.potVault,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markDistributionSnapshotFailed(windowId, row.walletAddress, row.courseId, message);
      results.push({
        walletAddress: row.walletAddress,
        courseId: row.courseId,
        payoutAmount: row.payoutAmount,
        status: 'failed',
        error: message,
      });
    }
  }

  return {
    processed: true,
    reason: 'DISTRIBUTION_BATCH_PROCESSED',
    windowId,
    potVaultBefore,
    potVaultAfter: await readCommunityPotVaultBalance(),
    distributionWindow: await readCommunityPotDistributionWindow(windowId),
    recipients: await readDistributionSnapshotRows(windowId),
    results,
  };
}

export async function getCommunityPotHistory(walletAddress, limit = 6) {
  if (!hasDatabase()) {
    return {
      windows: [],
    };
  }

  const idsResult = await query(
    `
      with window_ids as (
        select distinct community_pot_window_id as window_id
        from lesson.harvest_result_receipts
        where community_pot_window_id is not null
        union
        select distinct window_id
        from lesson.community_pot_distribution_snapshots
      )
      select window_id
      from window_ids
      where window_id is not null
      order by window_id desc
      limit $1
    `,
    [limit],
  );

  const walletRowsResult = await query(
    `
      select
        window_id as "windowId",
        wallet_address as "walletAddress",
        course_id as "courseId",
        current_streak as "currentStreak",
        principal_amount as "principalAmount",
        weight,
        payout_amount as "payoutAmount",
        status,
        distribution_transaction_signature as "distributionTransactionSignature",
        distribution_last_error as "distributionLastError",
        distributed_at as "distributedAt"
      from lesson.community_pot_distribution_snapshots
      where wallet_address = $1
    `,
    [walletAddress],
  );

  const walletRowsByWindow = new Map(
    walletRowsResult.rows.map((row) => [Number(row.windowId), row]),
  );

  const windows = await Promise.all(
    idsResult.rows.map(async (row) => {
      const windowId = Number(row.window_id);
      const [potWindow, distributionWindow] = await Promise.all([
        readCommunityPotWindow(windowId),
        readCommunityPotDistributionWindow(windowId),
      ]);
      const walletRow = walletRowsByWindow.get(windowId) ?? null;
      const totalRedirectedAmount = BigInt(potWindow?.totalRedirectedAmount ?? 0);
      const distributedAmount = BigInt(distributionWindow?.distributedAmount ?? 0);
      const remainingAmount = totalRedirectedAmount - distributedAmount;

      return {
        windowId,
        windowLabel: formatCommunityPotWindowLabel(windowId),
        totalRedirectedAmount: totalRedirectedAmount.toString(),
        totalRedirectedAmountUi: formatAtomicUsdcUi(totalRedirectedAmount),
        distributedAmount: distributedAmount.toString(),
        distributedAmountUi: formatAtomicUsdcUi(distributedAmount),
        remainingAmount: (remainingAmount > 0n ? remainingAmount : 0n).toString(),
        remainingAmountUi: formatAtomicUsdcUi(remainingAmount > 0n ? remainingAmount : 0n),
        redirectCount: Number(potWindow?.redirectCount ?? 0),
        eligibleRecipientCount: Number(distributionWindow?.eligibleRecipientCount ?? 0),
        distributionCount: Number(distributionWindow?.distributionCount ?? 0),
        status: mapDistributionWindowStatus(distributionWindow?.status ?? 0),
        closedAt: unixTimestampSecondsToIso(distributionWindow?.closedAtTs ?? null),
        userPayoutAmount:
          walletRow?.payoutAmount != null ? String(walletRow.payoutAmount) : null,
        userPayoutAmountUi:
          walletRow?.payoutAmount != null
            ? formatAtomicUsdcUi(walletRow.payoutAmount)
            : null,
        userStatus: mapRecipientStatus(walletRow?.status ?? null),
        userDistributedAt: walletRow?.distributedAt ?? null,
        userTransactionSignature: walletRow?.distributionTransactionSignature ?? null,
        userLastError: walletRow?.distributionLastError ?? null,
      };
    }),
  );

  return {
    windows,
  };
}

function mapHarvestRelayStatus(rawStatus) {
  if (rawStatus === 'published') return 'published';
  if (rawStatus === 'publishing') return 'publishing';
  if (rawStatus === 'failed') return 'failed';
  return 'pending';
}

function mapHarvestKind(harvestId) {
  if (typeof harvestId === 'string' && harvestId.startsWith('auto-harvest:')) {
    return 'AUTO';
  }
  return 'MANUAL';
}

export async function getYieldHistory(walletAddress, courseId, limit = 10) {
  if (!hasDatabase()) {
    return {
      courseId,
      totalHarvests: 0,
      totalGrossYield: '0',
      totalGrossYieldUi: '0',
      totalPlatformFee: '0',
      totalPlatformFeeUi: '0',
      totalRedirected: '0',
      totalRedirectedUi: '0',
      totalIchorAwarded: '0',
      entries: [],
    };
  }

  const [summaryResult, rowsResult] = await Promise.all([
    query(
      `
        select
          count(*)::int as "totalHarvests",
          coalesce(sum(gross_yield_amount), 0)::text as "totalGrossYield",
          coalesce(sum(platform_fee_amount), 0)::text as "totalPlatformFee",
          coalesce(sum(redirected_amount), 0)::text as "totalRedirected",
          coalesce(sum(ichor_awarded), 0)::text as "totalIchorAwarded"
        from lesson.harvest_result_receipts
        where wallet_address = $1
          and course_id = $2
      `,
      [walletAddress, courseId],
    ),
    query(
      `
        select
          harvest_id as "harvestId",
          harvested_at as "harvestedAt",
          gross_yield_amount::text as "grossYieldAmount",
          applied,
          reason,
          coalesce(platform_fee_amount, 0)::text as "platformFeeAmount",
          coalesce(redirected_amount, 0)::text as "redirectedAmount",
          coalesce(ichor_awarded, 0)::text as "ichorAwarded",
          lock_vault_status as "lockVaultStatus",
          lock_vault_transaction_signature as "lockVaultTransactionSignature",
          community_pot_status as "communityPotStatus",
          community_pot_transaction_signature as "communityPotTransactionSignature"
        from lesson.harvest_result_receipts
        where wallet_address = $1
          and course_id = $2
        order by harvested_at desc
        limit $3
      `,
      [walletAddress, courseId, limit],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    totalHarvests: 0,
    totalGrossYield: '0',
    totalPlatformFee: '0',
    totalRedirected: '0',
    totalIchorAwarded: '0',
  };

  return {
    courseId,
    totalHarvests: Number(summary.totalHarvests ?? 0),
    totalGrossYield: String(summary.totalGrossYield ?? '0'),
    totalGrossYieldUi: formatAtomicUsdcUi(summary.totalGrossYield ?? 0),
    totalPlatformFee: String(summary.totalPlatformFee ?? '0'),
    totalPlatformFeeUi: formatAtomicUsdcUi(summary.totalPlatformFee ?? 0),
    totalRedirected: String(summary.totalRedirected ?? '0'),
    totalRedirectedUi: formatAtomicUsdcUi(summary.totalRedirected ?? 0),
    totalIchorAwarded: String(summary.totalIchorAwarded ?? '0'),
    entries: rowsResult.rows.map((row) => ({
      harvestId: row.harvestId,
      kind: mapHarvestKind(row.harvestId),
      harvestedAt: row.harvestedAt,
      grossYieldAmount: row.grossYieldAmount,
      grossYieldAmountUi: formatAtomicUsdcUi(row.grossYieldAmount),
      applied: row.applied == null ? null : Boolean(row.applied),
      reason: row.reason ?? null,
      platformFeeAmount: row.platformFeeAmount,
      platformFeeAmountUi: formatAtomicUsdcUi(row.platformFeeAmount),
      redirectedAmount: row.redirectedAmount,
      redirectedAmountUi: formatAtomicUsdcUi(row.redirectedAmount),
      ichorAwarded: row.ichorAwarded,
      lockVaultStatus: mapHarvestRelayStatus(row.lockVaultStatus),
      lockVaultTransactionSignature: row.lockVaultTransactionSignature ?? null,
      communityPotStatus: mapHarvestRelayStatus(row.communityPotStatus),
      communityPotTransactionSignature: row.communityPotTransactionSignature ?? null,
    })),
  };
}

function truncateWalletAddress(value) {
  if (!value || value.length <= 10) {
    return value;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export async function getCommunityPotWindowDetail(walletAddress, windowId) {
  if (!hasDatabase()) {
    return {
      windowId,
      recipients: [],
      userEntry: null,
    };
  }

  const [potWindow, distributionWindow, recipientRows] = await Promise.all([
    readCommunityPotWindow(windowId),
    readCommunityPotDistributionWindow(windowId),
    readDistributionSnapshotRows(windowId),
  ]);

  if (!potWindow && !distributionWindow && recipientRows.length === 0) {
    throw notFound('Community Pot window not found', 'COMMUNITY_POT_WINDOW_NOT_FOUND');
  }

  const totalRedirectedAmount = BigInt(potWindow?.totalRedirectedAmount ?? 0);
  const distributedAmount = BigInt(distributionWindow?.distributedAmount ?? 0);
  const remainingAmount = totalRedirectedAmount - distributedAmount;

  const recipients = recipientRows.map((row) => ({
    walletAddress: row.walletAddress,
    displayIdentity: truncateWalletAddress(row.walletAddress),
    courseId: row.courseId,
    currentStreak: Number(row.currentStreak),
    principalAmount: String(row.principalAmount),
    principalAmountUi: formatAtomicUsdcUi(row.principalAmount),
    weight: String(row.weight),
    payoutAmount: String(row.payoutAmount),
    payoutAmountUi: formatAtomicUsdcUi(row.payoutAmount),
    status: mapRecipientStatus(row.status),
    distributedAt: row.distributedAt ?? null,
    transactionSignature: row.distributionTransactionSignature ?? null,
    lastError: row.distributionLastError ?? null,
    isCurrentUser: row.walletAddress === walletAddress,
  }));

  const userEntry = recipients.find((row) => row.isCurrentUser) ?? null;

  return {
    windowId,
    windowLabel: formatCommunityPotWindowLabel(windowId),
    totalRedirectedAmount: totalRedirectedAmount.toString(),
    totalRedirectedAmountUi: formatAtomicUsdcUi(totalRedirectedAmount),
    distributedAmount: distributedAmount.toString(),
    distributedAmountUi: formatAtomicUsdcUi(distributedAmount),
    remainingAmount: (remainingAmount > 0n ? remainingAmount : 0n).toString(),
    remainingAmountUi: formatAtomicUsdcUi(remainingAmount > 0n ? remainingAmount : 0n),
    redirectCount: Number(potWindow?.redirectCount ?? 0),
    eligibleRecipientCount: Number(distributionWindow?.eligibleRecipientCount ?? 0),
    distributionCount: Number(distributionWindow?.distributionCount ?? 0),
    status: mapDistributionWindowStatus(distributionWindow?.status ?? potWindow?.status ?? 0),
    closedAt: unixTimestampSecondsToIso(distributionWindow?.closedAtTs ?? null),
    recipients,
    userEntry,
  };
}

async function computeLeaderboardRows() {
  const runtimeWallets = await query(
    `
      select distinct wallet_address
      from lesson.user_course_runtime_state
      order by wallet_address asc
    `,
  );

  const latestClosedWindowIdResult = await query(
    `
      select window_id
      from lesson.community_pot_distribution_snapshots
      group by window_id
      order by window_id desc
      limit 1
    `,
  );

  const latestClosedWindowId =
    latestClosedWindowIdResult.rowCount > 0
      ? Number(latestClosedWindowIdResult.rows[0].window_id)
      : null;
  const latestClosedWindow =
    latestClosedWindowId != null
      ? await readCommunityPotDistributionWindow(latestClosedWindowId)
      : null;
  const latestClosedRows =
    latestClosedWindowId != null ? await readDistributionSnapshotRows(latestClosedWindowId) : [];

  const entries = [];
  for (const row of runtimeWallets.rows) {
    const wallet = row.wallet_address;
    // Streak + last activity are DB-owned (the custody-core lock_vault no
    // longer carries them). Pull them from runtime state; use the on-chain
    // snapshot only for custody facts (lock status + principal).
    const courseIdsResult = await query(
      `
        select
          course_id as "courseId",
          current_streak as "currentStreak",
          last_completed_day::text as "lastCompletedDay"
        from lesson.user_course_runtime_state
        where wallet_address = $1
        order by course_id asc
      `,
      [wallet],
    );

    let streakLength = 0;
    let activeCourseCount = 0;
    let lockedPrincipal = 0n;
    let recentActivityDate = null;

    for (const course of courseIdsResult.rows) {
      try {
        const snapshot = await readLockAccountSnapshot(wallet, course.courseId);
        if (snapshot.status !== 0) {
          continue;
        }

        const currentStreak = Number(course.currentStreak ?? 0);
        streakLength = Math.max(streakLength, currentStreak);
        if (currentStreak > 0) {
          activeCourseCount += 1;
        }

        lockedPrincipal += BigInt(snapshot.principalAmount ?? 0);
        const completionDate = course.lastCompletedDay ?? null;
        if (completionDate && (!recentActivityDate || completionDate > recentActivityDate)) {
          recentActivityDate = completionDate;
        }
      } catch {
        // Skip unreadable locks.
      }
    }

    const projectedRow =
      latestClosedWindowId != null
        ? latestClosedRows.find((entry) => entry.walletAddress === wallet)
        : null;

    entries.push({
      walletAddress: wallet,
      displayIdentity: truncateWalletAddress(wallet),
      streakLength,
      streakStatus: streakLength > 0 ? 'active' : 'broken',
      activeCourseCount,
      lockedPrincipalAmount: lockedPrincipal.toString(),
      lockedPrincipalAmountUi: formatAtomicUsdcUi(lockedPrincipal),
      projectedCommunityPotShare:
        projectedRow?.payoutAmount != null ? String(projectedRow.payoutAmount) : '0',
      projectedCommunityPotShareUi:
        projectedRow?.payoutAmount != null
          ? formatAtomicUsdcUi(projectedRow.payoutAmount)
          : '0',
      recentActivityDate,
    });
  }

  entries.sort((left, right) => {
    if (left.streakLength !== right.streakLength) {
      return right.streakLength - left.streakLength;
    }
    const leftPrincipal = BigInt(left.lockedPrincipalAmount);
    const rightPrincipal = BigInt(right.lockedPrincipalAmount);
    if (leftPrincipal !== rightPrincipal) {
      return rightPrincipal > leftPrincipal ? 1 : -1;
    }
    return left.walletAddress.localeCompare(right.walletAddress);
  });

  const rankedEntries = entries.map((entry, index) => ({
    rank: index + 1,
    ...entry,
  }));

  return {
    currentPotAmount:
      latestClosedWindow?.totalRedirectedAmount != null
        ? String(latestClosedWindow.totalRedirectedAmount)
        : '0',
    nextDistributionWindowLabel:
      latestClosedWindowId != null
        ? formatCommunityPotWindowLabel(latestClosedWindowId + 1)
        : null,
    entries: rankedEntries,
  };
}

function mapLeaderboardSnapshotRow(row, walletAddress) {
  return {
    rank: Number(row.rank),
    walletAddress: row.walletAddress,
    displayIdentity: row.displayIdentity,
    streakLength: Number(row.streakLength),
    streakStatus: row.streakStatus,
    activeCourseCount: Number(row.activeCourseCount),
    lockedPrincipalAmount: String(row.lockedPrincipalAmount),
    lockedPrincipalAmountUi: formatAtomicUsdcUi(row.lockedPrincipalAmount),
    projectedCommunityPotShare: String(row.projectedCommunityPotShare),
    projectedCommunityPotShareUi: formatAtomicUsdcUi(row.projectedCommunityPotShare),
    recentActivityDate: row.recentActivityDate ?? null,
    isCurrentUser: row.walletAddress === walletAddress,
  };
}

async function readLatestLeaderboardSnapshot(walletAddress, page = 1, pageSize = 25) {
  const snapshotResult = await query(
    `
      select
        snapshot_id as "snapshotId",
        snapshot_at as "snapshotAt",
        current_pot_amount as "currentPotAmount",
        next_distribution_window_label as "nextDistributionWindowLabel",
        entry_count as "entryCount"
      from lesson.leaderboard_snapshots
      order by snapshot_id desc
      limit 1
    `,
  );

  const snapshot = snapshotResult.rows[0] ?? null;
  if (!snapshot) {
    return null;
  }

  const safePageSize = Math.max(1, Number(pageSize) || 25);
  const totalEntries = Number(snapshot.entryCount ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalEntries / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const offset = (safePage - 1) * safePageSize;

  const [entriesResult, currentUserResult] = await Promise.all([
    query(
      `
        select
          rank,
          wallet_address as "walletAddress",
          display_identity as "displayIdentity",
          streak_length as "streakLength",
          streak_status as "streakStatus",
          active_course_count as "activeCourseCount",
          locked_principal_amount as "lockedPrincipalAmount",
          projected_community_pot_share as "projectedCommunityPotShare",
          recent_activity_date as "recentActivityDate"
        from lesson.leaderboard_snapshot_rows
        where snapshot_id = $1
        order by rank asc
        limit $2
        offset $3
      `,
      [snapshot.snapshotId, safePageSize, offset],
    ),
    walletAddress
      ? query(
          `
            select
              rank,
              wallet_address as "walletAddress",
              display_identity as "displayIdentity",
              streak_length as "streakLength",
              streak_status as "streakStatus",
              active_course_count as "activeCourseCount",
              locked_principal_amount as "lockedPrincipalAmount",
              projected_community_pot_share as "projectedCommunityPotShare",
              recent_activity_date as "recentActivityDate"
            from lesson.leaderboard_snapshot_rows
            where snapshot_id = $1
              and wallet_address = $2
            limit 1
          `,
          [snapshot.snapshotId, walletAddress],
        )
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    source: 'materialized',
    snapshotAt: snapshot.snapshotAt,
    page: safePage,
    pageSize: safePageSize,
    totalEntries,
    totalPages,
    currentPotSizeUi: formatAtomicUsdcUi(snapshot.currentPotAmount),
    nextDistributionWindowLabel: snapshot.nextDistributionWindowLabel ?? null,
    currentUser:
      currentUserResult.rows[0] != null
        ? mapLeaderboardSnapshotRow(currentUserResult.rows[0], walletAddress)
        : null,
    entries: entriesResult.rows.map((row) => mapLeaderboardSnapshotRow(row, walletAddress)),
  };
}

export async function refreshLeaderboardSnapshot(limit = 25) {
  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  const live = await computeLeaderboardRows();

  return withTransaction(async (client) => {
    const snapshotInsert = await client.query(
      `
        insert into lesson.leaderboard_snapshots (
          current_pot_amount,
          next_distribution_window_label,
          entry_count
        )
        values ($1::bigint, $2, $3)
        returning
          snapshot_id as "snapshotId",
          snapshot_at as "snapshotAt",
          current_pot_amount as "currentPotAmount",
          next_distribution_window_label as "nextDistributionWindowLabel",
          entry_count as "entryCount"
      `,
      [live.currentPotAmount, live.nextDistributionWindowLabel, live.entries.length],
    );

    const snapshot = snapshotInsert.rows[0];

    for (const entry of live.entries) {
      await client.query(
        `
          insert into lesson.leaderboard_snapshot_rows (
            snapshot_id,
            rank,
            wallet_address,
            display_identity,
            streak_length,
            streak_status,
            active_course_count,
            locked_principal_amount,
            projected_community_pot_share,
            recent_activity_date
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::bigint, $9::bigint, $10::date)
        `,
        [
          snapshot.snapshotId,
          entry.rank,
          entry.walletAddress,
          entry.displayIdentity,
          entry.streakLength,
          entry.streakStatus,
          entry.activeCourseCount,
          entry.lockedPrincipalAmount,
          entry.projectedCommunityPotShare,
          entry.recentActivityDate,
        ],
      );
    }

    await client.query(
      `
        delete from lesson.leaderboard_snapshots
        where snapshot_id not in (
          select snapshot_id
          from lesson.leaderboard_snapshots
          order by snapshot_id desc
          limit 20
        )
      `,
    );

    return {
      processed: true,
      reason: 'SNAPSHOT_CREATED',
      source: 'materialized',
      snapshotAt: snapshot.snapshotAt,
      page: 1,
      pageSize: limit,
      totalEntries: live.entries.length,
      totalPages: Math.max(1, Math.ceil(live.entries.length / limit)),
      currentPotSizeUi: formatAtomicUsdcUi(snapshot.currentPotAmount),
      nextDistributionWindowLabel: snapshot.nextDistributionWindowLabel ?? null,
      currentUser: null,
      entries: live.entries.slice(0, limit).map((entry) => ({
        ...entry,
        isCurrentUser: false,
      })),
    };
  });
}

export async function getLeaderboardSnapshot(walletAddress, page = 1, pageSize = 25) {
  if (!hasDatabase()) {
    return {
      source: 'live',
      snapshotAt: null,
      page: 1,
      pageSize,
      totalEntries: 0,
      totalPages: 1,
      currentPotSizeUi: '0',
      nextDistributionWindowLabel: null,
      currentUser: null,
      entries: [],
    };
  }

  const materialized = await readLatestLeaderboardSnapshot(walletAddress, page, pageSize);
  if (materialized) {
    return materialized;
  }

  const live = await computeLeaderboardRows();
  const safePageSize = Math.max(1, Number(pageSize) || 25);
  const totalEntries = live.entries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const startIndex = (safePage - 1) * safePageSize;
  const liveCurrentUser =
    live.entries.find((entry) => entry.walletAddress === walletAddress) ?? null;

  return {
    source: 'live',
    snapshotAt: null,
    page: safePage,
    pageSize: safePageSize,
    totalEntries,
    totalPages,
    currentPotSizeUi: formatAtomicUsdcUi(live.currentPotAmount),
    nextDistributionWindowLabel: live.nextDistributionWindowLabel,
    currentUser: liveCurrentUser ? { ...liveCurrentUser, isCurrentUser: true } : null,
    entries: live.entries.slice(startIndex, startIndex + safePageSize).map((entry) => ({
      ...entry,
      isCurrentUser: entry.walletAddress === walletAddress,
    })),
  };
}

async function readMissConsequenceReceipt(client, walletAddress, courseId, missEventId) {
  const result = await client.query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        miss_event_id as "missEventId",
        miss_day::text as "missDay",
        applied,
        reason,
        saver_count_before as "saverCountBefore",
        saver_count_after as "saverCountAfter",
        redirect_bps_before as "redirectBpsBefore",
        redirect_bps_after as "redirectBpsAfter",
        extension_days_before as "extensionDaysBefore",
        extension_days_after as "extensionDaysAfter",
        lock_vault_status as "lockVaultStatus",
        lock_vault_published_at as "lockVaultPublishedAt",
        lock_vault_last_error as "lockVaultLastError",
        lock_vault_transaction_signature as "lockVaultTransactionSignature"
      from lesson.miss_consequence_receipts
      where wallet_address = $1
        and course_id = $2
        and miss_event_id = $3
      limit 1
    `,
    [walletAddress, courseId, missEventId],
  );

  return result.rows[0] ?? null;
}

/**
 * Miss-day core (practice ruling R15) — the ONE place a miss-day mutates
 * engine state. Used by consumeSaverOrApplyFullConsequence (worker + internal
 * endpoint), the submit-time catch-up loop (R13), and the daily lapse sweep.
 *
 * Caller contract: `client` is inside a wallet-scoped transaction and the
 * caller holds the runtime row lock (ensureCourseRuntimeState forUpdate) for
 * this (wallet, course); `state` is the locked row.
 *
 * Semantics replace the legacy dual penalty:
 *  (a) existing receipt for this missEventId OR this (wallet, course, day)
 *      -> return it, write NOTHING (day-level dedupe regardless of caller id);
 *  (b) completed course -> refuse, write NOTHING (freeze, R6);
 *  (c) shields banked -> SHIELD_ABSORBED: shield burns, streak PAUSES,
 *      saver_count and current_yield_redirect_bps are NOT touched — a
 *      shielded miss is free;
 *      shields gone -> lapse: streak 0, redirect = 10000 - userYieldBps(lapse)
 *      (5000 at lapse 1, 10000 at lapse 2+); consecutive dark days coalesce
 *      into one lapse via lapse_open (LAPSE_ALREADY_OPEN);
 *  (d) engine columns + streak + redirect + last_miss_day + the receipt all
 *      persist in the caller's transaction. saver_count is frozen forever.
 */
async function applyMissConsequenceLocked(client, state, missDay, missEventId) {
  const { walletAddress, courseId } = state;

  // (a) day-keyed idempotency shared by every producer.
  const existing = await client.query(
    `
      select miss_event_id as "missEventId", applied, reason
      from lesson.miss_consequence_receipts
      where wallet_address = $1
        and course_id = $2
        and (miss_event_id = $3 or miss_day = $4::date)
      limit 1
    `,
    [walletAddress, courseId, missEventId, missDay],
  );
  if (existing.rowCount > 0) {
    const receipt = existing.rows[0];
    if (receipt.missEventId === missEventId) {
      return {
        missEventId,
        applied: receipt.applied,
        reason: receipt.reason,
        duplicate: true,
      };
    }
    return { missEventId, applied: false, reason: 'DUPLICATE_MISS_DAY', duplicate: true };
  }

  // (b) freeze enforcement at the writer, not only the caller (R6).
  if (state.courseCompletedAt != null) {
    return { missEventId, applied: false, reason: 'COURSE_COMPLETED' };
  }

  // (c) engine transition.
  const shielded = Number(state.shields) > 0;
  const next = applyMissDay({
    streak: state.currentStreak,
    shields: state.shields,
    lapseCount: state.lapseCount,
    lapseOpen: state.lapseOpen,
    consecutiveLessonDays: state.consecutiveLessonDays,
  });

  let reason;
  let redirectBpsAfter = state.currentYieldRedirectBps;
  if (shielded) {
    reason = 'SHIELD_ABSORBED';
  } else {
    reason = next.lapseOpen && state.lapseOpen ? 'LAPSE_ALREADY_OPEN' : 'LAPSE_APPLIED';
    redirectBpsAfter = 10_000 - userYieldBps(next.lapseCount);
  }

  // (d) persist engine columns + streak (+ redirect only past the shields) +
  // last_miss_day. saver_count / saver_recovery_mode / extension_days are
  // never written by the miss path again.
  await client.query(
    `
      update lesson.user_course_runtime_state
      set shields = $3,
          lapse_count = $4,
          lapse_open = $5,
          consecutive_lesson_days = $6,
          current_streak = $7,
          current_yield_redirect_bps = $8,
          last_miss_day = greatest(coalesce(last_miss_day, $9::date), $9::date),
          updated_at = now()
      where wallet_address = $1
        and course_id = $2
    `,
    [
      walletAddress,
      courseId,
      next.shields,
      next.lapseCount,
      next.lapseOpen,
      next.consecutiveLessonDays,
      next.streak,
      redirectBpsAfter,
      missDay,
    ],
  );

  // Receipt insert stays STRICT (no on-conflict): a racing duplicate violates
  // 0045's unique day index and rolls this whole transaction — including the
  // state mutation above — back. Fail closed. Legacy NOT NULL saver/extension
  // columns are fed fail-closed literal 0 constants (legacy-deletion ruling):
  // the doomed runtime columns are never read here, which decouples the
  // money-critical miss path (lapse_count → voucher bps) from the deferred
  // column DROP in one move. redirect_bps_* stay real.
  await client.query(
    `
      insert into lesson.miss_consequence_receipts (
        wallet_address,
        course_id,
        miss_event_id,
        miss_day,
        applied,
        reason,
        saver_count_before,
        saver_count_after,
        redirect_bps_before,
        redirect_bps_after,
        extension_days_before,
        extension_days_after
      )
      values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      walletAddress,
      courseId,
      missEventId,
      missDay,
      true,
      reason,
      0,
      0,
      state.currentYieldRedirectBps,
      redirectBpsAfter,
      0,
      0,
    ],
  );

  return { missEventId, applied: true, reason, next };
}

// Sweep-facing exports (lapse-sweep ruling): the sweep must use THIS miss
// core and THIS row lock — reimplementing either anywhere is forbidden.
// Caller contract is applyMissConsequenceLocked's: wallet-scoped transaction,
// row lock held via lockRuntimeStateForSweep.
export const applyMissConsequenceForSweep = applyMissConsequenceLocked;

export async function lockRuntimeStateForSweep(client, walletAddress, courseId) {
  return ensureCourseRuntimeState(client, walletAddress, courseId, { forUpdate: true });
}

// Re-read inside the same transaction (the row lock is already held).
export async function rereadRuntimeStateForSweep(client, walletAddress, courseId) {
  return ensureCourseRuntimeState(client, walletAddress, courseId);
}

export async function consumeSaverOrApplyFullConsequence(
  walletAddress,
  courseId,
  missEventId,
  missDay = null,
) {
  if (!missEventId || typeof missEventId !== 'string') {
    throw badRequest('missEventId is required', 'MISSING_MISS_EVENT_ID');
  }

  const missDayValue = missDay ?? new Date().toISOString().slice(0, 10);

  if (!hasDatabase()) {
    return {
      missEventId,
      applied: false,
      reason: 'NO_DATABASE',
    };
  }

  try {
    return await withTransactionAsWallet(walletAddress, async (client) => {
      const state = await ensureCourseRuntimeState(client, walletAddress, courseId, {
        forUpdate: true,
      });
      const result = await applyMissConsequenceLocked(
        client,
        state,
        missDayValue,
        missEventId,
      );
      const courseRuntime = await readCourseRuntimeState(client, walletAddress, courseId);
      return {
        missEventId,
        applied: result.applied,
        reason: result.reason,
        courseRuntime,
      };
    });
  } catch (error) {
    // A concurrent producer won the unique day index race (0045). The losing
    // transaction — state mutation included — rolled back; report the day as
    // already judged instead of throwing (enroll ruling R16).
    if (error?.code === '23505') {
      return { missEventId, applied: false, reason: 'DUPLICATE_MISS_DAY' };
    }
    throw error;
  }
}

// Timestamps are server-authoritative: a client-supplied `startedAt` lets a
// caller backdate attempts and mint an arbitrary streak history, which feeds
// the yield penalty tier and the community-pot weight.
export async function startLessonAttempt(walletAddress, lessonId, attemptId) {
  const normalizedAttemptId = assertAttemptId(attemptId);
  const timestamp = new Date().toISOString();

  if (!hasDatabase()) {
    throw new HttpError(503, 'Progress is unavailable', 'DATABASE_UNAVAILABLE');
  }

  return withTransactionAsWallet(walletAddress, async (client) => {
    const lessonVersion = await getPublishedLessonVersion(client, lessonId);
    const attempt = await ensureAttempt(
      client,
      walletAddress,
      lessonId,
      normalizedAttemptId,
      lessonVersion.lessonVersionId,
      timestamp,
    );

    return {
      lessonId,
      attemptId: attempt.attemptId,
      startedAt: attempt.startedAt,
    };
  });
}

// `completedAt` is never accepted from the caller — see startLessonAttempt.
// Without a database we fail closed: the previous no-db branch returned
// `accepted: true, score: 100`, so an outage passed every lesson.
// DEV-ONLY (devnet-gated at the route): force-complete every lesson in a course
// at 100% by submitting each lesson's correct answers through the real submit
// path — so XP, completion events, course_completed_at and voucher auto-issue
// all fire exactly as a genuine pass. Lets us reach the claim flow without
// hand-grinding every lesson. REMOVE before mainnet.
export async function devCompleteCourse(walletAddress, courseId, { log = null } = {}) {
  if (!hasDatabase()) {
    throw new HttpError(503, 'Dev complete requires the database', 'DATABASE_UNAVAILABLE');
  }
  const pool = getPool();
  const lessonsRes = await pool.query(
    `SELECT DISTINCT pl.lesson_id as "lessonId", pm.module_order as "mo", pl.lesson_order as "lo"
       FROM lesson.published_modules pm
       JOIN lesson.published_lessons pl
         ON pl.module_id = pm.module_id AND pl.release_id = pm.release_id
      WHERE pm.course_id = $1
      ORDER BY pm.module_order, pl.lesson_order`,
    [courseId],
  );
  if (lessonsRes.rows.length === 0) {
    throw notFound(`No published lessons for course: ${courseId}`, 'COURSE_NOT_FOUND');
  }

  const results = [];
  for (const { lessonId } of lessonsRes.rows) {
    const lessonVersion = await getPublishedLessonVersion(pool, lessonId);
    const questions = await listLessonQuestions(pool, lessonVersion.lessonVersionId);
    // Submit each question's own correct answer → grades 100%.
    const answers = questions.map((q) => ({
      questionId: q.id,
      answerText: String(q.correctAnswer ?? ''),
    }));
    const r = await submitLessonAttempt(walletAddress, lessonId, randomUUID(), answers, { log });
    results.push({ lessonId, score: r.score, accepted: r.accepted });
  }
  return { courseId, lessonsCompleted: results.length, results };
}

export async function submitLessonAttempt(
  walletAddress,
  lessonId,
  attemptId,
  answers,
  { log = null } = {},
) {
  const normalizedAttemptId = assertAttemptId(attemptId);
  const submittedAnswers = assertAnswers(answers);
  const timestamp = new Date().toISOString();

  if (!hasDatabase()) {
    throw new HttpError(503, 'Grading is unavailable', 'DATABASE_UNAVAILABLE');
  }

  // Voucher auto-issue (voucher-autoissue ruling R4): set inside the freeze
  // branch, consumed strictly AFTER the transaction commits. Signing/storing
  // inside the submit transaction is forbidden (ruling R3) — a voucher
  // failure could silently roll back the user's final-lesson completion.
  let completedCourseId = null;

  const result = await withTransactionAsWallet(walletAddress, async (client) => {
    const lessonVersion = await getPublishedLessonVersion(client, lessonId);
    // A submit without a prior /start still anchors its attempt to server time.
    const attempt = await ensureAttempt(
      client,
      walletAddress,
      lessonId,
      normalizedAttemptId,
      lessonVersion.lessonVersionId,
      timestamp,
    );

    if (attempt.submittedAt) {
      const questions = await listLessonQuestions(client, attempt.lessonVersionId);
      const totalQuestions = questions.length;
      const correctAnswers = Math.round(
        ((attempt.score ?? 0) / 100) * Math.max(totalQuestions, 0),
      );
      const completionEvent = await readVerifiedCompletionEvent(
        client,
        attempt.attemptId,
      );
      const courseId =
        completionEvent?.courseId ??
        (await getCourseIdForPublishedLesson(
          client,
          lessonId,
          attempt.lessonVersionId,
        ));
      const courseRuntime = await readCourseRuntimeState(
        client,
        walletAddress,
        courseId,
      );
      const questionResults = await readAnswerValidationDecisions(client, attempt.attemptId);

      // Practice ruling R9: never fabricate a completionEventId from the
      // attempt id. A post-gate practice attempt has no verified completion
      // event, so its absence on an accepted attempt identifies practice;
      // pre-gate historical replays have events and report practiceMode false.
      return {
        lessonId,
        attemptId: attempt.attemptId,
        accepted: attempt.accepted ?? true,
        score: attempt.score ?? 0,
        correctAnswers,
        totalQuestions,
        completedAt: attempt.submittedAt,
        completionEventId: completionEvent?.eventId ?? null,
        practiceMode: Boolean(attempt.accepted) && completionEvent == null,
        courseRuntime,
        questionResults,
      };
    }

    const questions = await listLessonQuestions(client, attempt.lessonVersionId);
    const grading = await gradeAnswers(
      questions,
      submittedAnswers,
      attempt.startedAt,
      timestamp,
    );

    await persistQuestionAttempts(client, normalizedAttemptId, grading.attempts);
    await persistAnswerValidationDecisions(client, normalizedAttemptId, grading.attempts);

    const accepted = grading.score >= LESSON_ACCEPTANCE_THRESHOLD;

    await client.query(
      `
        update lesson.user_lesson_attempts
        set submitted_at = $2::timestamptz,
            score = $3,
            accepted = $4
        where id = $1::uuid
      `,
      [normalizedAttemptId, timestamp, grading.score, accepted],
    );

    // Practice gate (practice ruling R2): a lesson already completed in
    // user_lesson_progress, or ANY lesson of a course frozen by
    // course_completed_at, is practice — grade it, keep the per-attempt audit
    // rows, but write NOTHING to progress/runtime/events/XP (R3). The
    // courseCompletedAt clause keeps completion permanent (spec item 21) even
    // if a catalog reseed later adds new lessons to a completed course; do
    // NOT use a live fetchModuleCompletion recompute here.
    let courseId = null;
    try {
      courseId = await getCourseIdForPublishedLesson(client, lessonId, attempt.lessonVersionId);
    } catch (error) {
      // Fail closed where money moves: an accepted completion cannot proceed
      // without its course context. Not-accepted responses only report
      // practiceMode informationally, so they tolerate a missing context.
      if (accepted) throw error;
    }

    let isReplay = false;
    if (courseId != null) {
      if (accepted) {
        // Writers take the row lock FIRST (R11) — a concurrent duplicate
        // first-time submit blocks here and then reads the winner's committed
        // user_lesson_progress row, classifying itself as practice instead of
        // double-applying the lesson-day.
        const state = await ensureCourseRuntimeState(client, walletAddress, courseId, {
          forUpdate: true,
        });
        const progressRow = await client.query(
          `select completed from lesson.user_lesson_progress
           where wallet_address = $1 and lesson_id = $2
           limit 1`,
          [walletAddress, lessonId],
        );
        isReplay =
          progressRow.rows[0]?.completed === true || state.courseCompletedAt != null;
      } else {
        const progressRow = await client.query(
          `select completed from lesson.user_lesson_progress
           where wallet_address = $1 and lesson_id = $2
           limit 1`,
          [walletAddress, lessonId],
        );
        const frozenRow = await client.query(
          `select course_completed_at from lesson.user_course_runtime_state
           where wallet_address = $1 and course_id = $2
           limit 1`,
          [walletAddress, courseId],
        );
        isReplay =
          progressRow.rows[0]?.completed === true ||
          frozenRow.rows[0]?.course_completed_at != null;
      }
    }

    let completionEvent = null;
    let courseRuntime = null;
    let xpResult = null;
    if (accepted && !isReplay) {
      await persistLessonProgress(
        client,
        walletAddress,
        lessonId,
        grading.score,
        timestamp,
      );

      completionEvent = await persistVerifiedCompletionEvent(
        client,
        walletAddress,
        lessonId,
        attempt.lessonVersionId,
        normalizedAttemptId,
        grading,
        timestamp,
      );
      courseRuntime = await applyVerifiedCompletionToCourseRuntime(
        client,
        walletAddress,
        completionEvent.courseId,
        completionEvent.completionDay,
        completionEvent.rewardUnits,
      );
      xpResult = await checkAndAwardMilestoneXp(
        client,
        walletAddress,
        completionEvent.courseId,
        lessonId,
      );

      // Freeze writer (R5): the completing submit stamps course_completed_at
      // in ITS OWN transaction so the engine can never advance lapse_count —
      // and cut the voucher bps — after the course is done.
      if (xpResult?.courseComplete) {
        await client.query(
          `update lesson.user_course_runtime_state
           set course_completed_at = coalesce(course_completed_at, now()),
               updated_at = now()
           where wallet_address = $1 and course_id = $2`,
          [walletAddress, completionEvent.courseId],
        );
        completedCourseId = completionEvent.courseId;
      }
    }

    if (accepted && isReplay) {
      // R8 response contract: practice always carries the CURRENT, unmodified
      // courseRuntime so the client keeps serverHandled=true and never
      // double-bumps the local streak.
      courseRuntime = await readCourseRuntimeState(client, walletAddress, courseId);
    }

    const questionResults = buildQuestionResults(grading.attempts);

    return {
      lessonId,
      attemptId: normalizedAttemptId,
      accepted,
      score: grading.score,
      correctAnswers: grading.correctAnswers,
      totalQuestions: grading.totalQuestions,
      completedAt: timestamp,
      completionEventId: accepted && !isReplay ? completionEvent?.eventId : null,
      practiceMode: isReplay,
      courseRuntime,
      questionResults,
      xp: accepted && !isReplay ? xpResult : null,
    };
  });

  // Best-effort post-commit voucher issue+store (ruling R4). Post-commit the
  // pool sees the committed final lesson AND the frozen lapse_count, so the
  // existing pool-based signer cuts the correct tier. Never rethrows, never
  // alters the submit response; a crash here is healed lazily by the position
  // read (R7) or the POST voucher endpoint (R8).
  if (completedCourseId && voucherSigningConfigured()) {
    try {
      const voucher = await issueCourseCompletionVoucher(walletAddress, completedCourseId);
      await persistCompletionVoucher(walletAddress, completedCourseId, voucher);
    } catch (error) {
      log?.warn?.(
        {
          walletAddress,
          courseId: completedCourseId,
          error: error instanceof Error ? error.message : String(error),
        },
        'voucher.autoissue_failed',
      );
    }
  }

  return result;
}

export async function getCourseProgress(walletAddress, courseId) {
  if (!hasDatabase()) {
    return {
      courseId,
      completedLessons: 0,
      totalLessons: 0,
      completionRate: 0,
    };
  }

  const result = await queryAsWallet(
    walletAddress,
    `
      with totals as (
        select count(*)::int as total_lessons
        from lesson.course_modules cm
        join lesson.module_lessons ml on ml.module_id = cm.module_id
        where cm.course_id = $2
      ),
      completed as (
        select count(*)::int as completed_lessons
        from lesson.user_lesson_progress ulp
        join lesson.module_lessons ml on ml.lesson_id = ulp.lesson_id
        join lesson.course_modules cm on cm.module_id = ml.module_id
        where ulp.wallet_address = $1
          and cm.course_id = $2
          and ulp.completed = true
      )
      select
        $2::text as "courseId",
        completed.completed_lessons as "completedLessons",
        totals.total_lessons as "totalLessons",
        case
          when totals.total_lessons = 0 then 0
          else round((completed.completed_lessons::numeric / totals.total_lessons::numeric), 4)
        end as "completionRate"
      from totals, completed
    `,
    [walletAddress, courseId],
  );

  return result.rows[0];
}

export async function getModuleProgress(walletAddress, moduleId) {
  if (!hasDatabase()) {
    return {
      moduleId,
      completedLessons: 0,
      totalLessons: 0,
      completionRate: 0,
    };
  }

  const result = await queryAsWallet(
    walletAddress,
    `
      with totals as (
        select count(*)::int as total_lessons
        from lesson.module_lessons ml
        where ml.module_id = $2
      ),
      completed as (
        select count(*)::int as completed_lessons
        from lesson.user_lesson_progress ulp
        join lesson.module_lessons ml on ml.lesson_id = ulp.lesson_id
        where ulp.wallet_address = $1
          and ml.module_id = $2
          and ulp.completed = true
      )
      select
        $2::text as "moduleId",
        completed.completed_lessons as "completedLessons",
        totals.total_lessons as "totalLessons",
        case
          when totals.total_lessons = 0 then 0
          else round((completed.completed_lessons::numeric / totals.total_lessons::numeric), 4)
        end as "completionRate"
      from totals, completed
    `,
    [walletAddress, moduleId],
  );

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// v2 pot cycle (pot-cycle ruling 2026-07-10, R4).
//
// NEW function, appended — the v1 closeCommunityPotWindowAndSnapshot above
// (and its readLockAccountSnapshot eligibility loop) is deliberately NOT
// modified and NOT reused for v2: it reads legacy lock PDAs, so v2 users are
// never eligible through it. This function reuses ONLY computeWeightedPayouts
// + seedDistributionSnapshotRows + closeCommunityPotDistributionWindow.
//
// Eligibility (fail closed on money):
//   - v2-armed rows only: lock_account_address must equal the re-derived
//     vault_v2 PDA for (wallet, course) — stale v1 rows are skipped;
//   - FRESH on-chain read via readLockV2AccountFresh; account missing (PDA
//     closed = settled) or mismatch (config skew) EXCLUDES the row;
//   - INCLUDE only status === 'ACTIVE' with principal > 0 — deliberately NO
//     course_completed_at filter, so completed-but-unclaimed ACTIVE locks
//     stay eligible (their principal is still at stake);
//   - weight = on-chain principal x DB current_streak;
//   - any THROWN RPC read error aborts the ENTIRE run — never silently skip
//     a row the way the v1 loop does (a skipped row here mis-pays money).
//
// `overrides` is a test-injection surface (same philosophy as
// runLapseSweepBatch's readLockFresh param); production callers pass nothing.
// overrides.execute=false computes the full eligibility + payout preview but
// performs ZERO on-chain sends and ZERO snapshot-row writes (a preview seed
// would pin stale payout amounts via ON CONFLICT DO NOTHING).
export async function closeCommunityPotWindowAndSnapshotV2(
  windowId,
  closedAt = null,
  overrides = {},
) {
  const {
    execute = true,
    readDistributionWindow = readCommunityPotDistributionWindow,
    readPotWindow = readCommunityPotWindow,
    closeDistributionWindow = closeCommunityPotDistributionWindow,
  } = overrides;

  if (!hasDatabase()) {
    return {
      processed: false,
      reason: 'NO_DATABASE',
    };
  }

  if (!hasCommunityPotRelayConfig()) {
    return {
      processed: false,
      reason: 'COMMUNITY_POT_RELAY_DISABLED',
    };
  }

  // A v2 window may only close once its UTC month has fully elapsed.
  if (Number(windowId) >= deriveCommunityPotWindowId(new Date())) {
    throw badRequest(
      `windowId ${windowId} is not a fully elapsed UTC month`,
      'WINDOW_NOT_PAST',
    );
  }

  // Mirror of the v1 ALREADY_CLOSED / repairable-empty-window check
  // (closeCommunityPotWindowAndSnapshot above), verbatim.
  const existingDistributionWindow = await readDistributionWindow(windowId);
  const existingRows = await readDistributionSnapshotRows(windowId);
  const repairableEmptyWindow =
    existingDistributionWindow &&
    Number(existingDistributionWindow.totalWeight) === 0 &&
    Number(existingDistributionWindow.eligibleRecipientCount) === 0 &&
    Number(existingDistributionWindow.distributionCount) === 0 &&
    existingRows.length === 0;

  if (existingDistributionWindow && !repairableEmptyWindow) {
    return {
      processed: false,
      reason: 'ALREADY_CLOSED',
      distributionWindow: existingDistributionWindow,
      recipients: existingRows,
    };
  }

  const potWindow = await readPotWindow(windowId);
  if (!potWindow || BigInt(potWindow.totalRedirectedAmount ?? 0) === 0n) {
    return {
      processed: false,
      reason: 'NOTHING_TO_DISTRIBUTE',
      windowId,
    };
  }

  const runtimeResult = await query(
    `
      select
        wallet_address as "walletAddress",
        course_id as "courseId",
        current_streak as "currentStreak",
        lock_account_address as "lockAccountAddress"
      from lesson.user_course_runtime_state
      where lock_account_address is not null
        and current_streak > 0
      order by wallet_address asc, course_id asc
    `,
  );

  const eligible = [];
  for (const row of runtimeResult.rows) {
    // v2-armed check: the stored custody address must be THIS wallet+course's
    // derived vault_v2 PDA. Legacy-PDA rows are never eligible here.
    const derived = deriveLockPdaServer(
      appConfig.vaultV2ProgramId,
      row.walletAddress,
      row.courseId,
    ).toBase58();
    if (row.lockAccountAddress !== derived) {
      continue;
    }

    // FRESH read — a thrown RPC error aborts the entire run (fail closed).
    const fresh = await readLockV2AccountFresh(row.walletAddress, row.courseId);
    if (fresh === null || fresh.mismatch) {
      continue; // settled (PDA closed) or config-skewed — excluded
    }
    if (fresh.status !== 'ACTIVE' || fresh.principal <= 0n) {
      continue;
    }

    const currentStreak = Number(row.currentStreak);
    eligible.push({
      walletAddress: row.walletAddress,
      courseId: row.courseId,
      currentStreak,
      principalAmount: fresh.principal,
      weight: fresh.principal * BigInt(currentStreak),
    });
  }

  if (eligible.length === 0) {
    // DO NOT close: leaving the window open lets a later re-run distribute
    // the same window once active locks exist again.
    return {
      processed: false,
      reason: 'NO_ELIGIBLE_RECIPIENTS',
      windowId,
      potWindow,
    };
  }

  // Zero-payout filter: largest-remainder allocation keeps the filtered sum
  // exactly equal to totalRedirectedAmount, so dropping zero rows never
  // drops money.
  const payouts = computeWeightedPayouts(
    BigInt(potWindow.totalRedirectedAmount),
    eligible,
  ).filter((entry) => entry.payoutAmount > 0n);
  const totalWeight = payouts.reduce((sum, entry) => sum + entry.weight, 0n);

  if (!execute) {
    return {
      processed: false,
      reason: 'PREVIEW',
      windowId,
      potWindow,
      eligibleRecipientCount: payouts.length,
      totalWeight: totalWeight.toString(),
      payouts: payouts.map((entry) => ({
        walletAddress: entry.walletAddress,
        courseId: entry.courseId,
        currentStreak: entry.currentStreak,
        principalAmount: entry.principalAmount.toString(),
        weight: entry.weight.toString(),
        payoutAmount: entry.payoutAmount.toString(),
      })),
    };
  }

  const rows = await seedDistributionSnapshotRows(windowId, payouts);
  const closedAtValue = closedAt ?? new Date().toISOString();
  const closeResult = await closeDistributionWindow({
    windowId,
    totalWeight: totalWeight.toString(),
    eligibleRecipientCount: payouts.length,
    closedAt: closedAtValue,
  });
  const distributionWindow = await readDistributionWindow(windowId);

  return {
    processed: true,
    reason: 'CLOSED',
    windowId,
    potWindow,
    distributionWindow,
    signature: closeResult.signature,
    recipients: rows,
  };
}

// Re-exported for the pot-cycle R14 unit tests (zero-payout filtering must
// preserve the exact total); not part of the route surface.
export { computeWeightedPayouts };
