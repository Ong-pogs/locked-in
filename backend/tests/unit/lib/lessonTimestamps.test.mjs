import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// These are source-level guards for two exploits that were live in production:
//   C1 — the client supplied `completedAt`, so any wallet could backdate
//        attempts and mint a streak history that drives the yield penalty
//        tier and the community-pot weight.
//   C3 — with no database, `submitLessonAttempt` returned
//        `accepted: true, score: 100`, so an outage passed every lesson.
// A behavioural test would need a live DB; these assert the shapes that made
// the exploits possible cannot come back.

const routes = readFileSync(
  new URL('../../../src/modules/progress/routes.mjs', import.meta.url),
  'utf8',
);
const repository = readFileSync(
  new URL('../../../src/modules/progress/repository.mjs', import.meta.url),
  'utf8',
);

function sliceFunction(source, signature) {
  const start = source.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  const next = source.indexOf('\nexport async function', start + signature.length);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('C1: lesson timestamps are server-authoritative', () => {
  it('the lesson routes never read startedAt/completedAt from the request body', () => {
    expect(routes).not.toMatch(/request\.body\?\.startedAt/);
    expect(routes).not.toMatch(/request\.body\?\.completedAt/);
  });

  it('startLessonAttempt takes no caller-supplied timestamp', () => {
    const fn = sliceFunction(repository, 'export async function startLessonAttempt');
    expect(fn).toContain('const timestamp = new Date().toISOString();');
    expect(fn).not.toMatch(/startedAt\s*=\s*null/);
  });

  it('submitLessonAttempt takes no caller-supplied timestamp', () => {
    const fn = sliceFunction(repository, 'export async function submitLessonAttempt');
    expect(fn).toContain('const timestamp = new Date().toISOString();');
    expect(fn).not.toMatch(/completedAt\s*=\s*null/);
    expect(fn).not.toMatch(/completedAt\s*\?\?\s*new Date\(\)/);
  });
});

describe('C3: grading fails closed without a database', () => {
  it('submitLessonAttempt throws instead of auto-passing', () => {
    const fn = sliceFunction(repository, 'export async function submitLessonAttempt');
    const noDbBranch = fn.slice(fn.indexOf('if (!hasDatabase())'));
    expect(noDbBranch).toContain('DATABASE_UNAVAILABLE');
    expect(noDbBranch.slice(0, 200)).not.toContain('accepted: true');
    expect(noDbBranch.slice(0, 200)).not.toContain('score: 100');
  });

  it('startLessonAttempt throws instead of minting a local attempt', () => {
    const fn = sliceFunction(repository, 'export async function startLessonAttempt');
    const noDbBranch = fn.slice(fn.indexOf('if (!hasDatabase())'));
    expect(noDbBranch).toContain('DATABASE_UNAVAILABLE');
  });
});
