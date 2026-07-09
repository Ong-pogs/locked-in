import { badRequest, HttpError } from '../../lib/errors.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import { hasPositionConfig, readLockPosition } from '../../lib/lockPosition.mjs';

export async function locksRoutes(app) {
  // Live lock position for the authenticated wallet (spec §4.2 position
  // reader). status is authoritative for the CLAIM CTA; liveValueUi is the
  // headline number on the course card (null when the rate is unreadable).
  app.get(
    '/v1/locks/:courseId/position',
    { preHandler: requireAccessAuth },
    async (request) => {
      const courseId = request.params?.courseId;
      if (!courseId || typeof courseId !== 'string') {
        throw badRequest('Missing path parameter: courseId');
      }
      if (!hasPositionConfig()) {
        throw new HttpError(503, 'Position reader is not configured', 'POSITION_UNCONFIGURED');
      }
      return readLockPosition(request.auth.walletAddress, courseId);
    },
  );
}
