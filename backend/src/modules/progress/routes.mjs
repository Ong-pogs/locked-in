import { badRequest } from '../../lib/errors.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import {
  getCourseProgress,
  getModuleProgress,
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
