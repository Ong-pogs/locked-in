#!/usr/bin/env node
// Regenerates e2e/fixtures/content-snapshot.json from the REAL backend content
// API. The snapshot is the ground truth the content-verification e2e suite
// renders and asserts against. NOTE: "from the live catalog" means it reflects
// whatever lesson.published_lessons currently holds — including content bugs
// (the pre-0054 snapshot faithfully contained the stale Fuel/Ichor text).
// A green suite run proves the content RENDERS, not that it is editorially
// correct — regenerate after every content migration (latest: 0054).
//
// Usage:
//   node e2e/scripts/snapshot-content.mjs                       # prod backend
//   CONTENT_API_URL=http://localhost:3001 node e2e/scripts/snapshot-content.mjs
//
// Re-run whenever course content is reseeded/republished, then review the
// diff of content-snapshot.json like any other fixture change.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.CONTENT_API_URL ?? 'https://locked-in-backend-oetf.onrender.com').replace(/\/$/, '');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'content-snapshot.json');

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

const contentVersion = await getJson('/v1/content/version');
const courses = await getJson('/v1/courses');

const modulesByCourse = {};
const lessonsByModule = {};

for (const course of courses) {
  const modules = await getJson(`/v1/courses/${course.id}/modules`);
  modulesByCourse[course.id] = modules;
  for (const mod of modules) {
    lessonsByModule[mod.id] = await getJson(`/v1/modules/${mod.id}/lessons`);
  }
}

const lessonCount = Object.values(lessonsByModule).reduce((n, ls) => n + ls.length, 0);

const snapshot = {
  source: BASE,
  generatedAt: new Date().toISOString(),
  releaseId: contentVersion.releaseId,
  publishedAt: contentVersion.publishedAt,
  courses,
  modulesByCourse,
  lessonsByModule,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);

console.log(`Wrote ${OUT}`);
console.log(`  releaseId: ${contentVersion.releaseId}`);
console.log(`  courses: ${courses.length} (${courses.filter((c) => c.totalLessons > 0).length} with lessons), lessons: ${lessonCount}`);
