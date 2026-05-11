import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { appConfig } from './config.mjs';
import { HttpError } from './lib/errors.mjs';
import { getPool, hasDatabase } from './lib/db.mjs';
import { contentRoutes } from './modules/content/routes.mjs';
import { authRoutes } from './modules/auth/routes.mjs';
import { progressRoutes } from './modules/progress/routes.mjs';
import { faucetRoutes } from './modules/faucet/routes.mjs';
import { registerLeaderboardSnapshotWorker } from './workers/leaderboardSnapshotWorker.mjs';
import { registerLockVaultRelayWorker } from './workers/lockVaultRelayWorker.mjs';
import { registerRedemptionVaultAutofundWorker } from './workers/redemptionVaultAutofundWorker.mjs';
import { registerRuntimeSchedulerWorker } from './workers/runtimeSchedulerWorker.mjs';
import { registerUnlockIndexerWorker } from './workers/unlockIndexerWorker.mjs';

function buildLoggerConfig() {
  const loggerConfig = {
    level: appConfig.logLevel,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[REDACTED]',
    },
  };

  // Pretty logs are easier to read in local terminal sessions.
  if (appConfig.logPretty && process.stdout.isTTY) {
    loggerConfig.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: appConfig.logSingleLine,
      },
    };
  }

  return loggerConfig;
}

export function buildServer() {
  const app = Fastify({
    logger: buildLoggerConfig(),
    // We emit our own concise request lifecycle logs below.
    disableRequestLogging: true,
  });

  const corsAllowlist = new Set(appConfig.corsAllowedOrigins);

  app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, corsAllowlist.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        ip: request.ip,
        origin: request.headers.origin ?? null,
      },
      'request.start',
    );
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: Number(reply.elapsedTime?.toFixed?.(2) ?? 0),
      },
      'request.end',
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      request.log.warn({ err: error, code: error.code }, 'Request failed');
      reply.status(error.statusCode).send({
        message: error.message,
        code: error.code,
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled server error');
    reply.status(500).send({
      message: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    });
  });

  app.get('/health', async () => ({
    ok: true,
    databaseConfigured: hasDatabase(),
  }));

  app.register(contentRoutes);
  app.register(authRoutes);
  app.register(progressRoutes);
  app.register(faucetRoutes);
  registerLeaderboardSnapshotWorker(app);
  registerLockVaultRelayWorker(app);
  registerRedemptionVaultAutofundWorker(app);
  registerRuntimeSchedulerWorker(app);
  registerUnlockIndexerWorker(app);

  app.log.info(
    { corsAllowedOrigins: appConfig.corsAllowedOrigins },
    'CORS configured',
  );

  return app;
}

const app = buildServer();

async function start() {
  try {
    if (hasDatabase()) {
      const pool = getPool();
      await pool.query('select 1');
      app.log.info('Database connection verified');
    } else {
      app.log.warn('DATABASE_URL not set. Running in no-db mode for starter wiring.');
    }

    await app.listen({
      host: appConfig.host,
      port: appConfig.port,
    });

    app.log.info(`Lesson API listening on http://${appConfig.host}:${appConfig.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown(signal) {
  app.log.info(`Received ${signal}. Shutting down.`);
  try {
    await app.close();
    const pool = getPool();
    if (pool) {
      await pool.end();
    }
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const isDirectRun = import.meta.url === `file://${process.argv[1]}` ||
                    process.argv[1]?.endsWith('/server.mjs');
if (isDirectRun) {
  start();
}
