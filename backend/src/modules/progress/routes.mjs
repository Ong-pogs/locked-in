import { badRequest, unauthorized } from '../../lib/errors.mjs';
import { appConfig } from '../../config.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import {
  consumeDailyFuel,
  closeCommunityPotWindowAndSnapshot,
  distributeCommunityPotWindowBatch,
  getCommunityPotWindowDetail,
  consumeSaverOrApplyFullConsequence,
  getCommunityPotHistory,
  getLeaderboardSnapshot,
  getCourseRuntimeSnapshot,
  getCourseProgress,
  getYieldHistory,
  getModuleProgress,
  publishFuelBurnReceipt,
  publishHarvestSplitReceipt,
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
    schedulerKey !== appConfig.schedulerSecret
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
      const startedAt = request.body?.startedAt ?? null;

      return startLessonAttempt(
        request.auth.walletAddress,
        lessonId,
        attemptId,
        startedAt,
      );
    },
  );

  app.post(
    '/v1/progress/lessons/:lessonId/submit',
    { preHandler: requireAccessAuth },
    async (request) => {
      const lessonId = assertPathParam(request.params?.lessonId, 'lessonId');
      const attemptId = assertBodyField(request.body?.attemptId, 'attemptId');
      const answers = request.body?.answers;
      const startedAt = request.body?.startedAt ?? null;
      const completedAt = request.body?.completedAt ?? null;

      return submitLessonAttempt(
        request.auth.walletAddress,
        lessonId,
        attemptId,
        assertAnswers(answers),
        startedAt,
        completedAt,
      );
    },
  );

  app.post('/v1/internal/fuel/burn', async (request) => {
    requireSchedulerAuth(request);

    const walletAddress = request.body?.walletAddress;
    const courseId = request.body?.courseId;
    const cycleId = request.body?.cycleId;
    const burnedAt = request.body?.burnedAt ?? null;

    if (!walletAddress || typeof walletAddress !== 'string') {
      throw badRequest('walletAddress is required', 'MISSING_WALLET_ADDRESS');
    }

    if (!courseId || typeof courseId !== 'string') {
      throw badRequest('courseId is required', 'MISSING_COURSE_ID');
    }

    return consumeDailyFuel(walletAddress, courseId, cycleId, burnedAt);
  });

  app.post('/v1/internal/lock-vault/completions/publish', async (request) => {
    requireSchedulerAuth(request);

    const eventId = assertBodyField(request.body?.eventId, 'eventId');
    const retryFailed = request.body?.retryFailed === true;

    return publishVerifiedCompletionEvent(eventId, retryFailed);
  });

  app.post('/v1/internal/lock-vault/fuel-burn/publish', async (request) => {
    requireSchedulerAuth(request);

    const walletAddress = assertBodyField(request.body?.walletAddress, 'walletAddress');
    const courseId = assertBodyField(request.body?.courseId, 'courseId');
    const cycleId = assertBodyField(request.body?.cycleId, 'cycleId');
    const retryFailed = request.body?.retryFailed === true;

    return publishFuelBurnReceipt(walletAddress, courseId, cycleId, retryFailed);
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

  app.post('/v1/internal/yield-splitter/yield/harvest/publish', async (request) => {
    requireSchedulerAuth(request);

    const walletAddress = assertBodyField(request.body?.walletAddress, 'walletAddress');
    const courseId = assertBodyField(request.body?.courseId, 'courseId');
    const harvestId = assertBodyField(request.body?.harvestId, 'harvestId');
    const retryFailed = request.body?.retryFailed === true;

    return publishHarvestSplitReceipt(walletAddress, courseId, harvestId, retryFailed);
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

  app.post('/v1/internal/consequences/miss', async (request) => {
    requireSchedulerAuth(request);

    const walletAddress = request.body?.walletAddress;
    const courseId = request.body?.courseId;
    const missEventId = request.body?.missEventId;
    const missDay = request.body?.missDay ?? null;

    if (!walletAddress || typeof walletAddress !== 'string') {
      throw badRequest('walletAddress is required', 'MISSING_WALLET_ADDRESS');
    }

    if (!courseId || typeof courseId !== 'string') {
      throw badRequest('courseId is required', 'MISSING_COURSE_ID');
    }

    return consumeSaverOrApplyFullConsequence(
      walletAddress,
      courseId,
      missEventId,
      missDay,
    );
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

  app.get(
    '/v1/progress/leaderboard',
    { preHandler: requireAccessAuth },
    async (request) => getLeaderboardSnapshot(request.auth.walletAddress),
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
    '/v1/progress/runtime/courses/:courseId',
    { preHandler: requireAccessAuth },
    async (request) => {
      const courseId = assertPathParam(request.params?.courseId, 'courseId');
      return getCourseRuntimeSnapshot(request.auth.walletAddress, courseId);
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

  app.get(
    '/v1/progress/modules/:moduleId',
    { preHandler: requireAccessAuth },
    async (request) => {
      const moduleId = assertPathParam(request.params?.moduleId, 'moduleId');
      return getModuleProgress(request.auth.walletAddress, moduleId);
    },
  );
}
