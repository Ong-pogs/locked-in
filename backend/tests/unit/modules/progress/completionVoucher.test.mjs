import { describe, expect, it } from 'vitest';
import { isCourseComplete } from '../../../../src/modules/progress/repository.mjs';

// Postgres count() returns strings, so the gate must coerce. total_lessons=0
// means the module has no published lessons and can never be "complete".
describe('isCourseComplete (voucher gate)', () => {
  it('is false for empty / non-array input', () => {
    expect(isCourseComplete([])).toBe(false);
    expect(isCourseComplete(null)).toBe(false);
    expect(isCourseComplete(undefined)).toBe(false);
    expect(isCourseComplete('nope')).toBe(false);
  });

  it('is true only when every module is fully complete', () => {
    expect(isCourseComplete([{ total_lessons: '3', completed_lessons: '3' }])).toBe(true);
    expect(
      isCourseComplete([
        { total_lessons: '3', completed_lessons: '3' },
        { total_lessons: '2', completed_lessons: '2' },
      ]),
    ).toBe(true);
  });

  it('is false if any module is incomplete', () => {
    expect(isCourseComplete([{ total_lessons: '3', completed_lessons: '2' }])).toBe(false);
    expect(
      isCourseComplete([
        { total_lessons: '3', completed_lessons: '3' },
        { total_lessons: '2', completed_lessons: '1' },
      ]),
    ).toBe(false);
  });

  it('treats a lessonless module (total 0) as never complete', () => {
    expect(isCourseComplete([{ total_lessons: '0', completed_lessons: '0' }])).toBe(false);
    expect(
      isCourseComplete([
        { total_lessons: '3', completed_lessons: '3' },
        { total_lessons: '0', completed_lessons: '0' },
      ]),
    ).toBe(false);
  });

  it('handles numeric (non-string) counts too', () => {
    expect(isCourseComplete([{ total_lessons: 2, completed_lessons: 2 }])).toBe(true);
    expect(isCourseComplete([{ total_lessons: 2, completed_lessons: 1 }])).toBe(false);
  });
});
