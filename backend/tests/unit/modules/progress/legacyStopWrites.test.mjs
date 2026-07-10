// T1 guard test (legacy-deletion ruling): the SQL text of the four surviving
// runtime-state readers/writers must reference NONE of the ten columns doomed
// by backend/sql/deferred/drop_legacy_columns.sql. This keeps the deferred
// DROP promotable: a regression that re-introduces a read or write of a
// doomed column fails here long before the grep gate.

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repositoryPath = join(
  __dirname, '..', '..', '..', '..', 'src', 'modules', 'progress', 'repository.mjs',
);

const DOOMED_COLUMNS = [
  'ichor_counter',
  'ichor_lifetime_total',
  'fuel_counter',
  'fuel_cap',
  'fuel_fragments_today',
  'fuel_fragments_day',
  'gauntlet_active',
  'gauntlet_day',
  'saver_count',
  'saver_recovery_mode',
];

// Extract a top-level function's full text: from its declaration line to the
// next line that is exactly '}' at column 0.
function extractFunction(source, declaration) {
  const start = source.indexOf(declaration);
  expect(start, `declaration not found: ${declaration}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n}\n', start);
  expect(end, `end of ${declaration} not found`).toBeGreaterThan(start);
  return source.slice(start, end + 2);
}

describe('legacy stop-writes guard (T1)', () => {
  it('ensure/completion/scheduler/enrollments SQL references none of the ten doomed columns', async () => {
    const source = await readFile(repositoryPath, 'utf8');
    const functions = {
      ensureCourseRuntimeState: extractFunction(source, 'async function ensureCourseRuntimeState('),
      applyVerifiedCompletionToCourseRuntime: extractFunction(
        source, 'async function applyVerifiedCompletionToCourseRuntime(',
      ),
      listRuntimeSchedulerCandidates: extractFunction(
        source, 'export async function listRuntimeSchedulerCandidates(',
      ),
      getUserEnrollments: extractFunction(source, 'export async function getUserEnrollments('),
    };

    for (const [name, text] of Object.entries(functions)) {
      for (const column of DOOMED_COLUMNS) {
        expect(
          text.includes(column),
          `${name} still references doomed column "${column}"`,
        ).toBe(false);
      }
    }
  });

  it('the completion UPDATE sets exactly day + streak + updated_at', async () => {
    const source = await readFile(repositoryPath, 'utf8');
    const fn = extractFunction(source, 'async function applyVerifiedCompletionToCourseRuntime(');
    const updateMatch = fn.match(/update lesson\.user_course_runtime_state\s+set ([\s\S]*?)where/);
    expect(updateMatch).not.toBeNull();
    const setClause = updateMatch[1];
    const columns = [...setClause.matchAll(/([a-z_]+) =/g)].map((m) => m[1]).sort();
    expect(columns).toEqual(
      ['current_streak', 'last_completed_day', 'longest_streak', 'updated_at'].sort(),
    );
  });
});
