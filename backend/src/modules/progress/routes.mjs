import { badRequest, unauthorized } from '../../lib/errors.mjs';
import { runLapseSweepBatch } from '../../lib/lapseSweep.mjs';
import { autoMissEventId } from '../../lib/missEvents.mjs';
import { secureEquals } from '../../lib/secureCompare.mjs';
import { appConfig } from '../../config.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import {
  getUserXp,
  closeCommunityPotWindowAndSnapshot,
  distributeCommunityPotWindowBatch,
  getCommunityPotWindowDetail,
  consumeSaverOrApplyFullConsequence,
  getCommunityPotHistory,
  getLeaderboardSnapshot,
  getCourseRuntimeHistory,
  getUserEnrollments,
  getCourseRuntimeSnapshot,
  getCourseProgress,
  getUnlockReceipts,
  getYieldHistory,
  getModuleProgress,
  issueCourseCompletionVoucher,
  refreshLeaderboardSnapshot,
  recordUnlockReceipt,
  syncUnlockReceiptsFromChain,
  publishHarvestRedirectToCommunityPot,
  publishHarvestResultReceipt,
  publishMissConsequenceReceipt,
  publishVerifiedCompletionEvent,
  recordHarvestResult,
  startLessonAttempt,
  submitLessonAttempt,
} from './repository.mjs';

function assertPathParam(value, fieldName) {
  if (!value || typeof value !== 'string') {
    throw badRequest(`Missing path parameter: ${fieldName}`);
  }
  return value;
}

function assertBodyField(value, fieldName) {
  if (!value || typeof value !== 'string') {
    throw badRequest(`Missing body field: ${fieldName}`, 'MISSING_BODY_FIELD');
  }
  return value;
}

function assertAnswers(value) {
  if (!Array.isArray(value)) {
    throw badRequest('answers must be an array', 'INVALID_ANSWERS');
  }
  return value;
}

function requireSchedulerAuth(request) {
  const schedulerKey = request.headers['x-scheduler-key'];
  if (
    typeof schedulerKey !== 'string' ||
    schedulerKey.length === 0 ||
    !secureEquals(schedulerKey, appConfig.schedulerSecret)
  ) {
    throw unauthorized('Invalid scheduler key', 'INVALID_SCHEDULER_KEY');
  }
}

export async function progressRoutes(app) {
  app.post(
    '/v1/progress/lessons/:lessonId/start',
    { preHandler: requireAccessAuth },
    async (request) => {
      const lessonId = assertPathParam(request.params?.lessonId, 'lessonId');
      const attemptId = assertBodyField(request.body?.attemptId, 'attemptId');

      return startLessonAttempt(request.auth.walletAddress, lessonId, attemptId);
    },
  );

  app.post(
    '/v1/progress/lessons/:lessonId/submit',
    { preHandler: requireAccessAuth },
    async (request) => {
      const lessonId = assertPathParam(request.params?.lessonId, 'lessonId');
      const attemptId = assertBodyField(request.body?.attemptId, 'attemptId');
      const answers = request.body?.answers;

      return submitLessonAttempt(
        request.auth.walletAddress,
        lessonId,
        attemptId,
        assertAnswers(answers),
      );
    },
  );

  app.get(
    '/v1/progress/xp',
    { preHandler: requireAccessAuth },
    async (request) => {
      return getUserXp(request.auth.walletAddress);
    },
  );

  // Brewery/shop/fuel routes deleted (legacy-deletion ruling): GET+feed+claim
  // /v1/progress/brewery, POST /v1/progress/shop/buy-saver,
  // POST /v1/internal/fuel/burn, POST /v1/internal/lock-vault/fuel-burn/publish.

  app.post('/v1/internal/lock-vault/completions/publish', async (request) => {
    requireSchedulerAuth(request);

    const eventId = assertBodyField(request.body?.eventId, 'eventId');
    const retryFailed = request.body?.retryFailed === true;

    return publishVerifiedCompletionEvent(eventId, retryFailed);
  });

  app.post('/v1/internal/yield/harvest', async (request) => {
    requireSchedulerAuth(request);

    const walletAddress = assertBodyField(request.body?.walletAddress, 'walletAddress');
    const courseId = assertBodyField(request.body?.courseId, 'courseId');
    const harvestId = assertBodyField(request.body?.harvestId, 'harvestId');
    const grossYieldAmount = request.body?.grossYieldAmount;
    const harvestedAt = request.body?.harvestedAt ?? null;

    return recordHarvestResult(
      walletAddress,
      courseId,
      harvestId,
      grossYieldAmount,
      harvestedAt,
    );
  });

  app.post('/v1/internal/lock-vault/yield/harvest/publish', async (request) => {
    requireSchedulerAuth(request);

    const walletAddress = assertBodyField(request.body?.walletAddress, 'walletAddress');
    const courseId = assertBodyField(request.body?.courseId, 'courseId');
    const harvestId = assertBodyField(request.body?.harvestId, 'harvestId');
    const retryFailed = request.body?.retryFailed === true;

    return publishHarvestResultReceipt(walletAddress, courseId, harvestId, retryFailed);
  });

  app.post('/v1/internal/community-pot/yield/harvest/publish', async (request) => {
    requireSchedulerAuth(request);

    const walletAddress = assertBodyField(request.body?.walletAddress, 'walletAddress');
    const courseId = assertBodyField(request.body?.courseId, 'courseId');
    const harvestId = assertBodyField(request.body?.harvestId, 'harvestId');
    const retryFailed = request.body?.retryFailed === true;

    return publishHarvestRedirectToCommunityPot(
      walletAddress,
      courseId,
      harvestId,
      retryFailed,
    );
  });

  app.post('/v1/internal/community-pot/windows/close', async (request) => {
    requireSchedulerAuth(request);

    const rawWindowId = request.body?.windowId;
    const windowId = Number.parseInt(String(rawWindowId), 10);
    if (!Number.isFinite(windowId)) {
      throw badRequest('windowId is required', 'MISSING_WINDOW_ID');
    }

    const closedAt = request.body?.closedAt ?? null;
    return closeCommunityPotWindowAndSnapshot(windowId, closedAt);
  });

  app.post('/v1/internal/community-pot/windows/distribute', async (request) => {
    requireSchedulerAuth(request);

    const rawWindowId = request.body?.windowId;
    const windowId = Number.parseInt(String(rawWindowId), 10);
    if (!Number.isFinite(windowId)) {
      throw badRequest('windowId is required', 'MISSING_WINDOW_ID');
    }

    const batchSize = Number.parseInt(String(request.body?.batchSize ?? 10), 10);
    const retryFailed = request.body?.retryFailed === true;

    return distributeCommunityPotWindowBatch(windowId, batchSize, retryFailed);
  });

  // Hardened per sweep ruling R20 + practice ruling R16: this endpoint was an
  // unbounded punishment oracle (caller-supplied missEventId + missDay). Now:
  // missDay is required, must be a calendar date STRICTLY before today (UTC),
  // and the missEventId is ALWAYS derived server-side — day-level dedupe
  // (0045) then makes any replay or id games inert.
  app.post('/v1/internal/consequences/miss', async (request) => {
    requireSchedulerAuth(request);

    const walletAddress = request.body?.walletAddress;
    const courseId = request.body?.courseId;
    const missDay = request.body?.missDay;

    if (!walletAddress || typeof walletAddress !== 'string') {
      throw badRequest('walletAddress is required', 'MISSING_WALLET_ADDRESS');
    }

    if (!courseId || typeof courseId !== 'string') {
      throw badRequest('courseId is required', 'MISSING_COURSE_ID');
    }

    if (typeof missDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(missDay)) {
      throw badRequest('missDay must be YYYY-MM-DD', 'INVALID_MISS_DAY');
    }
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (missDay >= todayUtc) {
      throw badRequest('missDay must be strictly before today (UTC)', 'INVALID_MISS_DAY');
    }

    return consumeSaverOrApplyFullConsequence(
      walletAddress,
      courseId,
      autoMissEventId(walletAddress, courseId, missDay),
      missDay,
    );
  });

  // Daily lapse sweep (sweep ruling R16, as amended): runs exactly ONE
  // bounded batch synchronously; callers loop until nextCursor is null.
  // Per-row transactions inside the batch mean an LB timeout or cron retry
  // can never truncate mid-row or double-apply. Never judges today.
  app.post('/v1/internal/lapse/sweep', async (request) => {
    requireSchedulerAuth(request);

    const rawBatchSize = request.body?.batchSize;
    let batchSize = 200;
    if (rawBatchSize != null) {
      batchSize = Number.parseInt(String(rawBatchSize), 10);
      if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 1000) {
        throw badRequest('batchSize must be an integer 1..1000', 'INVALID_BATCH_SIZE');
      }
    }

    const cursor = request.body?.cursor ?? null;
    if (cursor != null && typeof cursor !== 'string') {
      throw badRequest('cursor must be a string', 'INVALID_SWEEP_CURSOR');
    }

    const asOfDay = request.body?.asOfDay;
    if (asOfDay != null && (typeof asOfDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDay))) {
      throw badRequest('asOfDay must be YYYY-MM-DD', 'INVALID_SWEEP_DAY');
    }

    return runLapseSweepBatch({
      ...(asOfDay != null ? { asOfDay } : {}),
      batchSize,
      cursor,
      log: request.log,
    });
  });

  app.post('/v1/internal/lock-vault/consequences/miss/publish', async (request) => {
    requireSchedulerAuth(request);

    const walletAddress = assertBodyField(request.body?.walletAddress, 'walletAddress');
    const courseId = assertBodyField(request.body?.courseId, 'courseId');
    const missEventId = assertBodyField(request.body?.missEventId, 'missEventId');
    const retryFailed = request.body?.retryFailed === true;

    return publishMissConsequenceReceipt(
      walletAddress,
      courseId,
      missEventId,
      retryFailed,
    );
  });

  app.post('/v1/internal/leaderboard/refresh', async (request) => {
    requireSchedulerAuth(request);
    const limit =
      Number.isFinite(Number(request.body?.limit)) && Number(request.body?.limit) > 0
        ? Number(request.body?.limit)
        : 25;
    return refreshLeaderboardSnapshot(limit);
  });

  app.post('/v1/internal/unlocks/index/sync', async (request) => {
    requireSchedulerAuth(request);
    const limit =
      Number.isFinite(Number(request.body?.limit)) && Number(request.body?.limit) > 0
        ? Number(request.body?.limit)
        : appConfig.unlockIndexerScanLimit;
    return syncUnlockReceiptsFromChain(limit);
  });

  app.get(
    '/v1/progress/leaderboard',
    { preHandler: requireAccessAuth },
    async (request) => {
      const page =
        Number.isFinite(Number(request.query?.page)) && Number(request.query?.page) > 0
          ? Number(request.query?.page)
          : 1;
      const pageSize =
        Number.isFinite(Number(request.query?.pageSize)) && Number(request.query?.pageSize) > 0
          ? Number(request.query?.pageSize)
          : 10;
      return getLeaderboardSnapshot(request.auth.walletAddress, page, pageSize);
    },
  );

  app.get(
    '/v1/progress/community-pot/history',
    { preHandler: requireAccessAuth },
    async (request) => getCommunityPotHistory(request.auth.walletAddress),
  );

  app.get(
    '/v1/progress/community-pot/windows/:windowId',
    { preHandler: requireAccessAuth },
    async (request) => {
      const rawWindowId = request.params?.windowId;
      const windowId = Number.parseInt(String(rawWindowId), 10);
      if (!Number.isFinite(windowId)) {
        throw badRequest('windowId is required', 'MISSING_WINDOW_ID');
      }

      return getCommunityPotWindowDetail(request.auth.walletAddress, windowId);
    },
  );

  app.get(
    '/v1/progress/yield/courses/:courseId/history',
    { preHandler: requireAccessAuth },
    async (request) => {
      const courseId = assertPathParam(request.params?.courseId, 'courseId');
      return getYieldHistory(request.auth.walletAddress, courseId);
    },
  );

  app.get(
    '/v1/progress/unlocks',
    { preHandler: requireAccessAuth },
    async (request) => getUnlockReceipts(request.auth.walletAddress),
  );

  app.post(
    '/v1/progress/unlocks',
    { preHandler: requireAccessAuth },
    async (request) => recordUnlockReceipt(request.auth.walletAddress, request.body),
  );

  // Returns all enrolled courses + runtime + lesson progress for the authenticated user
  app.get(
    '/v1/progress/enrollments',
    { preHandler: requireAccessAuth },
    async (request) => getUserEnrollments(request.auth.walletAddress),
  );

  app.get(
    '/v1/progress/runtime/courses/:courseId',
    { preHandler: requireAccessAuth },
    async (request) => {
      const courseId = assertPathParam(request.params?.courseId, 'courseId');
      return getCourseRuntimeSnapshot(request.auth.walletAddress, courseId);
    },
  );

  app.get(
    '/v1/progress/runtime/courses/:courseId/history',
    { preHandler: requireAccessAuth },
    async (request) => {
      const courseId = assertPathParam(request.params?.courseId, 'courseId');
      return getCourseRuntimeHistory(request.auth.walletAddress, courseId);
    },
  );

  app.get(
    '/v1/progress/courses/:courseId',
    { preHandler: requireAccessAuth },
    async (request) => {
      const courseId = assertPathParam(request.params?.courseId, 'courseId');
      return getCourseProgress(request.auth.walletAddress, courseId);
    },
  );

  // Sign an Ed25519 completion voucher for a fully-completed course. The client
  // embeds it in a precompile ix before claim_v2 to unlock the position.
  app.post(
    '/v1/progress/courses/:courseId/voucher',
    { preHandler: requireAccessAuth },
    async (request) => {
      const courseId = assertPathParam(request.params?.courseId, 'courseId');
      return issueCourseCompletionVoucher(request.auth.walletAddress, courseId);
    },
  );

  app.get(
    '/v1/progress/modules/:moduleId',
    { preHandler: requireAccessAuth },
    async (request) => {
      const moduleId = assertPathParam(request.params?.moduleId, 'moduleId');
      return getModuleProgress(request.auth.walletAddress, moduleId);
    },
  );
}
