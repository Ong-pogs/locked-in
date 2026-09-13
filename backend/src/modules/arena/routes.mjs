import { unauthorized, badRequest } from '../../lib/errors.mjs';
import { secureEquals } from '../../lib/secureCompare.mjs';
import { appConfig } from '../../config.mjs';
import { runArenaSweep } from '../../lib/arenaSweep.mjs';
import { runArenaSeasonSweep } from '../../lib/arenaSeasonSweep.mjs';
import {
  optIntoSeason, getMyStake, getOpenSeason, listStakeableCourses,
} from './seasonRepository.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import { keyGenerator } from '../../plugins/rateKey.mjs';
import {
  createLinkMatch, joinMatchByCode, getMatchState,
  startAttempt, nextQuestion, submitAnswer,
  enterQueue, pollQueue, leaveQueue, getLadder, getMyArena,
} from './repository.mjs';

// Same gate as the lapse sweep and pot cycle: a shared scheduler key, compared
// in constant time.
function requireSchedulerAuth(request) {
  const key = request.headers['x-scheduler-key'];
  if (typeof key !== 'string' || key.length === 0 || !secureEquals(key, appConfig.schedulerSecret)) {
    throw unauthorized('Invalid scheduler key', 'INVALID_SCHEDULER_KEY');
  }
}

export async function arenaRoutes(app) {
  app.post(
    '/v1/arena/matches',
    {
      preHandler: requireAccessAuth,
      config: { rateLimit: { max: 20, timeWindow: '1 hour', keyGenerator } },
    },
    async (request, reply) => {
      const created = await createLinkMatch(request.auth.walletAddress);
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/v1/arena/join/:code',
    {
      preHandler: requireAccessAuth,
      config: { rateLimit: { max: 60, timeWindow: '1 hour', keyGenerator } },
    },
    async (request) => joinMatchByCode(request.auth.walletAddress, request.params.code),
  );

  app.get(
    '/v1/arena/matches/:id',
    { preHandler: requireAccessAuth },
    async (request) => getMatchState(request.auth.walletAddress, request.params.id),
  );
  app.post(
    '/v1/arena/matches/:id/start',
    { preHandler: requireAccessAuth },
    async (request) => startAttempt(request.auth.walletAddress, request.params.id),
  );

  app.get(
    '/v1/arena/matches/:id/question',
    { preHandler: requireAccessAuth },
    async (request) => nextQuestion(request.auth.walletAddress, request.params.id),
  );

  app.post(
    '/v1/arena/matches/:id/answer',
    { preHandler: requireAccessAuth },
    async (request) => submitAnswer(
      request.auth.walletAddress,
      request.params.id,
      request.body?.questionId,
      request.body?.chosenOptionId,
    ),
  );
  app.post(
    '/v1/arena/queue',
    {
      preHandler: requireAccessAuth,
      config: { rateLimit: { max: 60, timeWindow: '1 hour', keyGenerator } },
    },
    async (request) => enterQueue(request.auth.walletAddress),
  );

  app.get(
    '/v1/arena/queue',
    { preHandler: requireAccessAuth },
    async (request) => pollQueue(request.auth.walletAddress),
  );

  // POST alias: the web-app's shared httpClient only speaks GET/POST.
  app.post(
    '/v1/arena/queue/leave',
    { preHandler: requireAccessAuth },
    async (request) => leaveQueue(request.auth.walletAddress),
  );

  app.delete(
    '/v1/arena/queue',
    { preHandler: requireAccessAuth },
    async (request) => leaveQueue(request.auth.walletAddress),
  );

  app.get('/v1/arena/ladder', async (request) => getLadder(1, request.query?.limit));

  app.get(
    '/v1/arena/me',
    { preHandler: requireAccessAuth },
    async (request) => getMyArena(request.auth.walletAddress),
  );
  // ---------- Stake seasons ----------

  app.get('/v1/arena/season', async () => getOpenSeason());

  app.get(
    '/v1/arena/stake',
    { preHandler: requireAccessAuth },
    async (request) => getMyStake(request.auth.walletAddress),
  );

  // What the picker may offer. Served by the same check the opt-in gate runs,
  // so the list can never promise a course the gate then refuses.
  app.get(
    '/v1/arena/stake/eligible',
    { preHandler: requireAccessAuth },
    async (request) => ({ courseIds: await listStakeableCourses(request.auth.walletAddress) }),
  );

  app.post(
    '/v1/arena/stake',
    {
      preHandler: requireAccessAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator } },
    },
    async (request, reply) => {
      const courseId = String(request.body?.courseId ?? '').trim();
      if (!courseId) throw badRequest('courseId is required', 'COURSE_ID_REQUIRED');
      const consentVersion = String(request.body?.consentVersion ?? '').trim();
      if (!consentVersion) {
        throw badRequest('consentVersion is required', 'CONSENT_VERSION_REQUIRED');
      }
      const result = await optIntoSeason(
        request.auth.walletAddress, courseId, consentVersion,
      );
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );

  app.post('/v1/internal/arena/sweep', async (request) => {
    requireSchedulerAuth(request);
    return runArenaSweep({ log: request.log });
  });

  app.post('/v1/internal/arena/season', async (request) => {
    requireSchedulerAuth(request);
    return runArenaSeasonSweep({ log: request.log });
  });
}
