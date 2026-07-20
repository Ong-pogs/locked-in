import { describe, expect, it } from 'vitest';
import {
  isCourseComplete,
  isCourseCompleteOrFrozen,
} from '../../../../src/modules/progress/repository.mjs';

// Completion is PERMANENT once frozen (invariant 6 / practice ruling): the
// stored course_completed_at is the source of truth, because a frozen user can
// never be credited for a lesson published afterwards.
//
// issueCourseCompletionVoucher already honored the freeze, but two other call
// sites recomputed completion live from module counts:
//   - getCourseRuntimeState.voucherAvailable (arms the dashboard CLAIM CTA)
//   - assertCourseLockable's COURSE_COMPLETED relock block
// so publishing ONE new lesson into a finished course made the CTA vanish for
// users whose principal was still locked, and simultaneously re-opened
// relocking on a course that could be claimed again with no new work.
//
// This helper is the single definition all three sites must share.

const complete = [{ total_lessons: '3', completed_lessons: '3' }];
const grown = [{ total_lessons: '4', completed_lessons: '3' }]; // a lesson was added after the freeze

describe('isCourseCompleteOrFrozen', () => {
  it('is true when the live counts say complete and there is no freeze', () => {
    expect(isCourseCompleteOrFrozen(complete, null)).toBe(true);
  });

  it('stays true after the catalog grows, when the user was frozen complete', () => {
    // The regression: live counts alone flip to false here.
    expect(isCourseComplete(grown)).toBe(false);
    expect(isCourseCompleteOrFrozen(grown, '2026-07-18T10:00:00.000Z')).toBe(true);
  });

  it('is false for an unfrozen user who has not finished', () => {
    expect(isCourseCompleteOrFrozen(grown, null)).toBe(false);
  });

  it('treats an undefined freeze the same as null', () => {
    expect(isCourseCompleteOrFrozen(grown, undefined)).toBe(false);
  });

  it('accepts a Date freeze as well as an ISO string', () => {
    expect(isCourseCompleteOrFrozen(grown, new Date('2026-07-18T10:00:00Z'))).toBe(true);
  });

  it('never fabricates completion from an empty module list', () => {
    expect(isCourseCompleteOrFrozen([], null)).toBe(false);
  });

  it('a freeze still wins over an empty module list (frozen users keep their claim)', () => {
    expect(isCourseCompleteOrFrozen([], '2026-07-18T10:00:00.000Z')).toBe(true);
  });
});
