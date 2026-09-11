import { requireAccessAuth } from '../../plugins/auth.mjs';
import { keyGenerator } from '../../plugins/rateKey.mjs';
import {
  createLinkMatch, joinMatchByCode, getMatchState,
  startAttempt, nextQuestion, submitAnswer,
} from './repository.mjs';

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
}
