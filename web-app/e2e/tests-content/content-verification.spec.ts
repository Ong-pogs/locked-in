import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  allLessons,
  contentCourses,
  expectsRecall,
  lessonsForCourse,
  type SnapshotBlock,
  type SnapshotLesson,
} from '../fixtures/content.fixture';

// Content verification: walk EVERY seeded lesson end to end and assert the
// REAL production content (e2e/fixtures/content-snapshot.json — pulled from
// the live catalog, post 0051/0052 content migrations) actually renders:
//
// - every reading block's text is present and visible, section by section
// - no raw markdown (**bold**), template goo ({{…}}, [object Object]),
//   mojibake (U+FFFD, â€…), or the Pixelify "Anance" ligature artifact
// - nothing overflows the viewport horizontally (390px — the PWA's world)
// - every quiz question prompt + all options render; the NEW check-to-lock
//   flow works (picking only selects, "Check Answer" locks + reveals)
// - a full-page screenshot per lesson lands in test-results-content/lessons/
//   as a browsable visual record (not pixel-diffed)

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'test-results-content', 'lessons');

/* ── Expected-text derivation (mirrors components/LessonBlocks.tsx) ── */

function cleanInline(s: string): string {
  return s.replace(/\*\*/g, '').replace(/`/g, '').trim();
}

// Candidate contiguous strings from a multi-line text field: per LINE (the
// renderer may split lines into headings/list items/paragraphs, but never
// splits within a line), stripped of list markers and inline markdown.
function lineCandidates(text?: string): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^(-\s+|•\s+|\d+\.\s+)/, ''))
    .map(cleanInline)
    .filter((l) => l.length >= 3);
}

function longestLine(text?: string): string[] {
  const c = lineCandidates(text);
  return c.length === 0 ? [] : [c.reduce((a, b) => (b.length > a.length ? b : a))];
}

// What MUST be visible for a block, per the renderer's semantics (fields the
// renderer ignores for a variant are not asserted).
function expectedSnippets(block: SnapshotBlock): string[] {
  const out: string[] = [];
  switch (block.variant) {
    case 'analogy':
      if (block.title) out.push(block.title);
      out.push(...longestLine(block.text));
      break;
    case 'takeaway':
      out.push('Key Takeaway', ...longestLine(block.text));
      break;
    case 'flow':
      for (const s of block.steps ?? []) out.push(cleanInline(s.title), cleanInline(s.desc));
      break;
    case 'concepts':
      out.push(...longestLine(block.text));
      for (const item of (block.items ?? []) as { name: string; desc: string }[]) {
        out.push(item.name, cleanInline(item.desc));
      }
      break;
    case 'comparison':
      out.push(...(block.headers ?? []).filter((h) => h.trim().length > 0));
      for (const row of block.rows ?? []) {
        const cells = row.map(cleanInline).filter(Boolean);
        if (cells.length > 0) out.push(cells.reduce((a, b) => (b.length > a.length ? b : a)));
      }
      break;
    case 'chain-cards':
      for (const chain of block.chains ?? []) {
        out.push(chain.name, chain.tagline, cleanInline(chain.desc), ...chain.stats);
      }
      break;
    case 'scam':
      if (block.number != null) out.push(`SCAM #${block.number}`);
      if (block.title) out.push(block.title);
      if (block.example) out.push(...longestLine(block.example));
      if (block.exampleSender) out.push(block.exampleSender);
      if (block.rule) out.push(...longestLine(block.rule));
      break;
    case 'checklist':
      for (const item of (block.items ?? []) as string[]) out.push(cleanInline(item));
      break;
    case 'kv-grid':
      for (const item of (block.items ?? []) as { label: string; value: string; desc?: string }[]) {
        out.push(item.label, item.value);
        if (item.desc) out.push(item.desc);
      }
      break;
    default:
      if (block.type === 'code') {
        // Raw <pre> text — longest raw line, no markdown cleaning.
        const lines = (block.text ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length >= 3);
        if (lines.length > 0) out.push(lines.reduce((a, b) => (b.length > a.length ? b : a)));
      } else if (block.type === 'callout') {
        // DefaultCallout splits a leading "Title: body" first line.
        const lines = (block.text ?? '').split('\n').filter(Boolean);
        const first = lines[0] ?? '';
        const colonIdx = first.indexOf(':');
        const hasTitle = colonIdx > 0 && colonIdx < 60;
        const candidates = [
          ...(hasTitle ? [first.slice(0, colonIdx), first.slice(colonIdx + 1)] : [first]),
          ...lines.slice(1),
        ]
          .map(cleanInline)
          .filter((l) => l.length >= 3);
        if (candidates.length > 0) out.push(candidates.reduce((a, b) => (b.length > a.length ? b : a)));
      } else {
        // RichParagraph renders every line (heading, list item, or body).
        out.push(...longestLine(block.text));
      }
  }
  return out.map((s) => s.trim()).filter((s) => s.length >= 3);
}

/* ── Page-level assertions ── */

const TEXT_ARTIFACTS = ['[object Object]', '{{', '}}', 'undefined', 'NaN', '�', 'â€', 'Anance'];

async function assertNoTextArtifacts(page: Page, ctx: string) {
  const hits = await page.evaluate((needles) => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    // <pre>/<code> may legally contain braces etc. — rendered code is exempt.
    clone.querySelectorAll('pre, code, script, style, noscript').forEach((el) => el.remove());
    const text = clone.textContent ?? '';
    const found = needles.filter((n) => text.includes(n));
    if (/\*\*[^*\n]+\*\*/.test(text)) found.push('unrendered **markdown**');
    return found;
  }, TEXT_ARTIFACTS);
  expect(hits, `${ctx}: text artifacts in rendered DOM: ${hits.join(', ')}`).toEqual([]);
}

async function assertNoHorizontalOverflow(page: Page, ctx: string) {
  const issues = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) {
      out.push(`documentElement scrollWidth ${document.documentElement.scrollWidth} > viewport ${vw}`);
    }
    if (document.body.scrollWidth > vw + 1) {
      out.push(`body scrollWidth ${document.body.scrollWidth} > viewport ${vw}`);
    }
    // position:fixed elements never grow the scroll width — check their rects.
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
        out.push(
          `fixed <${el.tagName.toLowerCase()} class="${(el as HTMLElement).className}"> spans ${Math.round(r.left)}..${Math.round(r.right)} (viewport ${vw})`,
        );
      }
    }
    return out;
  });
  expect(issues, `${ctx}: horizontal overflow`).toEqual([]);
}

/* ── Walkthrough helpers ── */

// The spaced-recall interstitial picks a RANDOM question from earlier
// completed lessons — pass through it generically.
async function passRecall(page: Page) {
  await expect(page.getByText('Quick Recall')).toBeVisible({ timeout: 20_000 });
  const textarea = page.locator('textarea');
  if ((await textarea.count()) > 0) {
    await textarea.fill('recall answer');
  } else {
    // Recall option buttons are the only w-full text-left buttons here.
    await page.locator('button.w-full.text-left').first().click();
  }
  const cont = page.getByRole('button', { name: 'Continue to Lesson' });
  await expect(cont).toBeEnabled();
  await cont.click();
}

async function walkReading(page: Page, lesson: SnapshotLesson, screenshotPath: string) {
  await expect(page.locator('h1')).toHaveText(lesson.title, { timeout: 20_000 });

  const blocks = [...lesson.blocks].sort((a, b) => a.order - b.order);
  expect(blocks.length, `${lesson.id}: lesson has no reading blocks`).toBeGreaterThan(0);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const ctx = `${lesson.id} section ${i + 1}/${blocks.length} (${block.id})`;

    if (blocks.length > 1) {
      await expect(page.getByText(`${i + 1} / ${blocks.length}`, { exact: true })).toBeVisible();
    }

    const snippets = expectedSnippets(block);
    expect(snippets.length, `${ctx}: no assertable text derived — block empty?`).toBeGreaterThan(0);
    for (const snippet of snippets) {
      await expect(
        page.getByText(snippet).first(),
        `${ctx}: missing text "${snippet.slice(0, 80)}"`,
      ).toBeVisible();
    }

    await assertNoTextArtifacts(page, ctx);
    await assertNoHorizontalOverflow(page, ctx);

    if (i === 0) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    if (i < blocks.length - 1) {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
  }
}

async function walkQuiz(page: Page, lesson: SnapshotLesson) {
  const qs = lesson.questions;
  if (qs.length === 0) {
    // Question-less lesson ends with Complete Lesson instead of a quiz.
    await expect(page.getByRole('button', { name: 'Complete Lesson' })).toBeVisible();
    return;
  }

  await page.getByRole('button', { name: 'Start Questions' }).click();

  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    const ctx = `${lesson.id} question ${i + 1}/${qs.length} (${q.id})`;

    await expect(page.getByText(`Question ${i + 1} of ${qs.length}`)).toBeVisible();
    await expect(page.locator('h2'), `${ctx}: prompt mismatch`).toHaveText(q.prompt);

    if (i === 0) {
      // New check-to-lock flow helper copy (remote payloads carry no key).
      await expect(
        page.getByText('Answers lock when you check — the final score is confirmed on submit.'),
      ).toBeVisible();
    }

    if (q.type === 'mcq') {
      const opts = q.options ?? [];
      expect(opts.length, `${ctx}: MCQ without options in snapshot`).toBeGreaterThanOrEqual(2);
      for (const o of opts) {
        expect(o.text.trim().length, `${ctx}: empty option text (${o.id})`).toBeGreaterThan(0);
        await expect(
          page.getByRole('button', { name: o.text, exact: true }),
          `${ctx}: option "${o.text.slice(0, 60)}" not rendered`,
        ).toBeVisible();
      }
      // Exactly the seeded options — no extras, none dropped.
      await expect(page.locator('button.w-full.text-left')).toHaveCount(opts.length);

      // Picking only SELECTS (re-selectable); nothing locks or validates
      // until "Check Answer".
      await page.getByRole('button', { name: opts[0].text, exact: true }).click();
      if (i === 0 && opts.length > 1) {
        await page.getByRole('button', { name: opts[1].text, exact: true }).click();
        await page.getByRole('button', { name: opts[0].text, exact: true }).click();
      }
      await expect(page.getByText(/^(Correct!|Incorrect)$/)).toHaveCount(0);
      const check = page.getByRole('button', { name: 'Check Answer' });
      await expect(check, `${ctx}: Check Answer gate missing after select`).toBeVisible();
      await check.click();
    } else {
      const input = page.getByPlaceholder('Type your answer...');
      await expect(input, `${ctx}: short-text input missing`).toBeVisible();
      await input.fill('content verification answer');
      await expect(page.getByText(/^(Correct!|Incorrect)$/)).toHaveCount(0);
      await page.getByRole('button', { name: 'Check Answer' }).click();
    }

    // Server verdict (mocked check endpoint) reveals + unlocks advance.
    await expect(page.getByText('Correct!')).toBeVisible();

    await assertNoTextArtifacts(page, ctx);
    await assertNoHorizontalOverflow(page, ctx);

    if (i < qs.length - 1) {
      await page.getByRole('button', { name: 'Next Question' }).click();
    } else {
      await expect(page.getByRole('button', { name: 'See Results' })).toBeVisible();
    }
  }
}

/* ── Static snapshot sanity (no browser) ── */

test('snapshot carries the full seeded catalog', async () => {
  const courses = contentCourses();
  expect(courses.length, 'no courses with lessons in content-snapshot.json — regenerate via e2e/scripts/snapshot-content.mjs').toBeGreaterThanOrEqual(1);
  for (const course of courses) {
    const lessons = lessonsForCourse(course.id);
    expect(lessons.length, `${course.id}: catalog count drifted`).toBe(course.totalLessons);
    for (const lesson of lessons) {
      expect(lesson.blocks.length, `${lesson.id}: no blocks`).toBeGreaterThan(0);
      for (const q of lesson.questions) {
        expect(q.prompt.trim().length, `${q.id}: empty prompt`).toBeGreaterThan(0);
        if (q.type === 'mcq') {
          expect((q.options ?? []).length, `${q.id}: mcq needs 2+ options`).toBeGreaterThanOrEqual(2);
        }
        // The remote payload must NEVER leak the answer key.
        expect(
          (q as unknown as Record<string, unknown>).correctAnswer,
          `${q.id}: answer key leaked in public payload`,
        ).toBeUndefined();
      }
    }
  }
});

/* ── Font rendering: Pixelify Sans ligature fix ── */

test('font-pixel disables ligatures (the "finance" → "Anance" fix)', async ({ contentPage: page }) => {
  const first = lessonsForCourse(contentCourses()[0].id)[0];
  await page.goto(`/lessons/${first.id}`);
  if (expectsRecall(first)) await passRecall(page);
  const title = page.locator('h1.font-pixel');
  await expect(title).toBeVisible({ timeout: 20_000 });
  const style = await title.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { ligatures: cs.fontVariantLigatures, features: cs.fontFeatureSettings };
  });
  expect(style.ligatures).toBe('none');
});

/* ── Practice Hall lists the fully-completed catalog ── */

test('practice hall lists every lesson of every completed course', async ({ contentPage: page }) => {
  await page.goto('/practice');
  await expect(page.locator('h1')).toHaveText('Practice Hall', { timeout: 20_000 });
  for (const course of contentCourses()) {
    await expect(page.getByText(course.title).first()).toBeVisible();
  }
  for (const lesson of allLessons()) {
    await expect(
      page.getByRole('button', { name: `Practice ${lesson.title}` }).first(),
      `practice row missing for ${lesson.id}`,
    ).toBeVisible();
  }
  // All courses are complete — the locked-course card must not appear.
  await expect(page.getByText('Finish the course to unlock practice')).toHaveCount(0);
  await assertNoTextArtifacts(page, 'practice hall');
  await assertNoHorizontalOverflow(page, 'practice hall');
});

/* ── The main matrix: every course, every lesson ── */

for (const course of contentCourses()) {
  test.describe(`content: ${course.id}`, () => {
    for (const lesson of lessonsForCourse(course.id)) {
      test(`${lesson.id} — "${lesson.title}" renders all blocks + questions`, async ({
        contentPage: page,
      }) => {
        await page.goto(`/lessons/${lesson.id}`);
        if (expectsRecall(lesson)) await passRecall(page);
        await walkReading(
          page,
          lesson,
          path.join(SCREENSHOT_DIR, `${course.id}--${String(lesson.order).padStart(2, '0')}-${lesson.id}.png`),
        );
        await walkQuiz(page, lesson);
      });
    }
  });
}
