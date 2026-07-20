import { test, expect } from '../fixtures/fullpass.fixture';
import { COURSE_A } from '../fixtures/fullpass-mocks';

// Full lesson pass: spaced-recall interstitial (server-graded via the NEW
// recall-check endpoint), paginated reading, check-to-lock quiz, graded
// submit → result page. Happy path plus every recall/check degradation.
//
// Scenario `learning`: lesson 1 (fp-l1, exactly ONE question → deterministic
// recall pick) is complete; deep-linking lesson 2 (fp-l2) always opens on the
// recall interstitial. Payloads carry NO answer key — every verdict is a
// server round-trip. Determinism: no waitForTimeout, no hedged assertions.

const LESSON_2 = COURSE_A.lessons[1];
const RECALL_Q = COURSE_A.lessons[0].questions[0]; // 'anchor build' is correct
const [QUIZ_Q1, QUIZ_Q2] = LESSON_2.questions;

/** Recall (correct pick) → Continue → both reading sections. */
async function walkRecallAndReading(page: import('@playwright/test').Page) {
  await expect(page.getByText('Quick Recall')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: RECALL_Q.correctText, exact: true }).click();
  await expect(page.getByTestId('recall-verdict')).toContainText('✓ Correct');
  await page.getByRole('button', { name: 'Continue to Lesson' }).click();

  await expect(page.locator('h1')).toHaveText(LESSON_2.title, { timeout: 20_000 });
  await expect(page.getByText(LESSON_2.blocks[0].text)).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(LESSON_2.blocks[1].text)).toBeVisible();
  await page.getByRole('button', { name: 'Start Questions' }).click();
}

test.describe('happy: full lesson flow — recall → reading → quiz → result', () => {
  // Hold the recall verdict briefly so the `recall-checking` status line is
  // observable before the green verdict replaces it (event-driven asserts).
  test.use({ scenario: 'learning', recallCheckDelayMs: 700 });

  test('correct recall gets the green server verdict; check-to-lock quiz completes to a verified result', async ({
    fpPage: page,
  }) => {
    await page.goto(`/lessons/${LESSON_2.id}`);

    // Recall interstitial — the one question from the completed lesson 1.
    await expect(page.getByText('Quick Recall')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(RECALL_Q.prompt)).toBeVisible();
    // Continue is gated until a pick is made.
    await expect(page.getByRole('button', { name: 'Continue to Lesson' })).toBeDisabled();

    await page.getByRole('button', { name: RECALL_Q.correctText, exact: true }).click();
    // Server round-trip status line, then the green verdict.
    await expect(page.getByTestId('recall-checking')).toBeVisible();
    const verdict = page.getByTestId('recall-verdict');
    await expect(verdict).toContainText('✓ Correct');
    await expect(verdict).toHaveCSS('color', 'rgb(62, 230, 138)');

    await page.getByRole('button', { name: 'Continue to Lesson' }).click();

    // Reading — both sections, in order.
    await expect(page.locator('h1')).toHaveText(LESSON_2.title, { timeout: 20_000 });
    await expect(page.getByText(LESSON_2.blocks[0].text)).toBeVisible();
    await expect(page.getByText('1 / 2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(LESSON_2.blocks[1].text)).toBeVisible();
    await page.getByRole('button', { name: 'Start Questions' }).click();

    // Q1 — select-then-Check-Answer, server verdict unlocks advance.
    await expect(page.getByText('Question 1 of 2')).toBeVisible();
    await expect(page.locator('h2')).toHaveText(QUIZ_Q1.prompt);
    await page.getByRole('button', { name: QUIZ_Q1.correctText, exact: true }).click();
    await expect(page.getByText(/^(Correct!|Incorrect)$/)).toHaveCount(0); // picking never grades
    await page.getByRole('button', { name: 'Check Answer' }).click();
    await expect(page.getByText('Correct!')).toBeVisible();
    await page.getByRole('button', { name: 'Next Question' }).click();

    // Q2 — same contract, then submit.
    await expect(page.getByText('Question 2 of 2')).toBeVisible();
    await page.getByRole('button', { name: QUIZ_Q2.correctText, exact: true }).click();
    await page.getByRole('button', { name: 'Check Answer' }).click();
    await expect(page.getByText('Correct!')).toBeVisible();
    await page.getByRole('button', { name: 'See Results' }).click();

    // Graded on submit → result page.
    await expect(page.locator('h1')).toHaveText('Lesson Result', { timeout: 20_000 });
    await expect(page.getByText('100%', { exact: true })).toBeVisible();
    await expect(page.getByText('Verified', { exact: true })).toBeVisible();
  });
});

test.describe('sad: recall wrong answer — crimson verdict reveals the key', () => {
  test.use({ scenario: 'learning' });

  test('wrong pick shows the crimson verdict with the correct answer and still continues', async ({
    fpPage: page,
  }) => {
    await page.goto(`/lessons/${LESSON_2.id}`);
    await expect(page.getByText('Quick Recall')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'cargo publish', exact: true }).click();

    const verdict = page.getByTestId('recall-verdict');
    await expect(verdict).toContainText('✕ Not quite');
    await expect(verdict).toContainText(`The answer is: ${RECALL_Q.correctText}`);
    await expect(verdict).toHaveCSS('color', 'rgb(255, 68, 102)');
    // The correct option is marked, and the reveal locks the options.
    await expect(
      page.getByRole('button', { name: RECALL_Q.correctText, exact: true }),
    ).toContainText('✓');
    await expect(page.getByRole('button', { name: 'cargo publish', exact: true })).toBeDisabled();

    // Recall is not graded — Continue still works after a miss.
    const cont = page.getByRole('button', { name: 'Continue to Lesson' });
    await expect(cont).toBeEnabled();
    await cont.click();
    await expect(page.locator('h1')).toHaveText(LESSON_2.title, { timeout: 20_000 });
  });
});

test.describe('sad: recall-check endpoint 500 — degrades, never dead-ends', () => {
  test.use({ scenario: 'learning', recallCheckStatus: 500 });

  test('failed check keeps the pick selectable, shows the degrade note, Continue works', async ({
    fpPage: page,
  }) => {
    await page.goto(`/lessons/${LESSON_2.id}`);
    await expect(page.getByText('Quick Recall')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: RECALL_Q.correctText, exact: true }).click();

    // Degrade note instead of a verdict — nothing was verified.
    await expect(page.getByText(/Couldn.t verify your pick/)).toBeVisible();
    await expect(page.getByTestId('recall-verdict')).toHaveCount(0);

    // The pick stays changeable (no lock without a verdict)…
    const otherOption = page.getByRole('button', { name: 'solana airdrop', exact: true });
    await expect(otherOption).toBeEnabled();
    await otherOption.click();

    // …and Continue still moves into the lesson.
    const cont = page.getByRole('button', { name: 'Continue to Lesson' });
    await expect(cont).toBeEnabled();
    await cont.click();
    await expect(page.locator('h1')).toHaveText(LESSON_2.title, { timeout: 20_000 });
  });
});

test.describe('sad: quiz check endpoint 500 — falls back to scored-on-submit', () => {
  test.use({ scenario: 'learning', quizCheckStatus: 500 });

  test('failed Check Answer degrades to the plain submit flow and the lesson still completes', async ({
    fpPage: page,
  }) => {
    await page.goto(`/lessons/${LESSON_2.id}`);
    await walkRecallAndReading(page);

    // Q1: the instant check fails → no verdict, flow degrades to submit-graded.
    await expect(page.getByText('Question 1 of 2')).toBeVisible();
    await page.getByRole('button', { name: QUIZ_Q1.correctText, exact: true }).click();
    await page.getByRole('button', { name: 'Check Answer' }).click();
    await expect(
      page.getByText('Answers are verified by the lesson API after you finish the lesson.'),
    ).toBeVisible();
    await expect(page.getByText(/^(Correct!|Incorrect)$/)).toHaveCount(0);

    // Advance is un-gated by the fallback (checkFailed → answer-only gate).
    await page.getByRole('button', { name: 'Next Question' }).click();

    // Q2: checkFailed resets per question — the gate re-arms, fails again,
    // and the submit path still carries the lesson home.
    await expect(page.getByText('Question 2 of 2')).toBeVisible();
    await page.getByRole('button', { name: QUIZ_Q2.correctText, exact: true }).click();
    await page.getByRole('button', { name: 'Check Answer' }).click();
    await expect(page.getByRole('button', { name: 'See Results' })).toBeEnabled();
    await page.getByRole('button', { name: 'See Results' }).click();

    // The server grades the whole set on submit — full marks, verified.
    await expect(page.locator('h1')).toHaveText('Lesson Result', { timeout: 20_000 });
    await expect(page.getByText('100%', { exact: true })).toBeVisible();
    await expect(page.getByText('Verified', { exact: true })).toBeVisible();
  });
});
