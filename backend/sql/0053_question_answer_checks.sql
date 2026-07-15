-- 0053: per-attempt question check ledger (instant quiz feedback).
--
-- The lesson player may "check" ONE question mid-attempt to give the learner
-- an on-the-spot verdict. The FIRST check locks that (attempt, question)
-- answer server-side:
--   * re-checking with a different answer returns the ORIGINAL verdict, so
--     the endpoint cannot be used as an option-probing oracle;
--   * at submit, any submitted answer for a checked question is OVERRIDDEN
--     by the locked answer, so check-then-swap cannot inflate the score.
-- Verdicts here are advisory UI; authoritative grading stays at submit.

create table if not exists lesson.user_question_checks (
  lesson_attempt_id uuid not null references lesson.user_lesson_attempts(id) on delete cascade,
  question_id text not null references lesson.questions(id) on delete cascade,
  answer_text text not null,
  is_correct boolean not null,
  question_score integer not null default 0 check (question_score >= 0 and question_score <= 100),
  created_at timestamptz not null default now(),
  primary key (lesson_attempt_id, question_id)
);

alter table lesson.user_question_checks enable row level security;

create policy user_question_checks_wallet_policy
  on lesson.user_question_checks
  using (
    exists (
      select 1
      from lesson.user_lesson_attempts attempts
      where attempts.id = lesson.user_question_checks.lesson_attempt_id
        and attempts.wallet_address = current_setting('request.jwt.claim.wallet_address', true)
    )
  )
  with check (
    exists (
      select 1
      from lesson.user_lesson_attempts attempts
      where attempts.id = lesson.user_question_checks.lesson_attempt_id
        and attempts.wallet_address = current_setting('request.jwt.claim.wallet_address', true)
    )
  );
