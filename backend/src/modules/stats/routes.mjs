import { getStats } from './repository.mjs';

export async function statsRoutes(app) {
  app.get('/v1/stats', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (_request, reply) => {
      try {
        return reply.send(await getStats());
      } catch {
        return reply.status(503).send({ error: 'STATS_UNAVAILABLE' });
      }
    },
  });
}
