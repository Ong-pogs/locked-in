-- 0058: remove the "principal is always returned" guarantee from live course
-- content.
--
-- The deposit form was corrected, but the same false promise still ships inside
-- lesson prose and inside a GRADED quiz answer, where it is worse: a learner is
-- marked CORRECT for believing it. All three strings were written by 0051/0052
-- as replacement copy, so grepping the seed migrations does not find them —
-- they only exist in the stored jsonb.
--
-- Why the claim is false, in two independent ways:
--
--   1. Custody. Principal is not held by LockedIn; it is supplied to Kamino.
--      claim_v2/force_return_v2 both settle by redeeming the Kamino position
--      (settle.rs redeem_and_split), so the user receives what the position
--      redeems for. A Kamino exploit or bad-debt socialization, a USDC depeg,
--      or a Solana failure can return less than was deposited. Nothing in the
--      program tops that shortfall up — there is no insurance fund and the
--      community pot does not backstop principal.
--   2. Force return. vault_v2.rs force_return_v2 calls
--        redeem_and_split(..., 0, fee_bps)   // bps 0: all yield -> pot
--      The literal 0 is user_yield_bps, so a force-returned lock pays back
--      PRINCIPAL ONLY and forfeits 100% of accrued yield to the community pot.
--
-- What IS true, and what the replacement copy now says: a lapse penalty never
-- touches principal (lapses forfeit yield only). That is a promise about our
-- rules, not about the value of the deposit. The old copy collapsed the two.
--
-- METHOD — written against the two known failure modes in this repo:
--
--   (a) 0051 wrote many of its patterns in SQL-SOURCE syntax
--       (jsonb_build_array('a','b'), trailing "$$),"). That text never exists
--       in the stored jsonb, so those replacements silently matched nothing.
--       Every pattern below is the STORED form — plain prose, newlines as the
--       two characters \n — and each was observed in a database built by
--       replaying 0001..0057 before this file was written.
--   (b) 0054 existed because the catalog serves lesson payloads from
--       lesson.published_lessons (content/repository.mjs listModuleLessons)
--       while getLessonPayload serves lesson.published_lesson_payloads. Every
--       fix is applied to BOTH, plus lesson.lesson_blocks so a later re-publish
--       cannot resurrect the claim.
--   (c) The graded answer that changes also updates lesson.questions.correct_
--       answer AND lesson.question_options.option_text, so the on-screen option
--       still matches the key. Grading is a normalized text match, so a key that
--       drifts from its options marks the right answer wrong (the 0054 bug).
--   (d) The block ends with a loud verification — see FAILURE POLICY. A silent
--       no-op is impossible: every failure mode either aborts or leaves both a
--       warning and a durable row in lesson.content_fix_reports.
--
-- Corrective only: no rows dropped, no ids or block/question structure changed,
-- so enrollments and in-flight attempts are unaffected.
--
-- FAILURE POLICY — mirrors 0057 exactly; see that file's header for the full
-- argument. Short version: scripts/migrate.mjs executes this unattended on every
-- deploy, so a check that asserts something about UPSTREAM CONTENT must not be
-- able to kill an unrelated hotfix. Checks are split by what they prove:
--
--   HARD FAIL (raise exception) — only a bug in THIS file can cause these:
--     * a pattern that matched and whose text SURVIVED the replace;
--     * a graded key with no matching row in lesson.question_options (the
--       UPDATE below targets bw-4-q1 unconditionally, so disagreement means
--       this migration is internally broken).
--
--   WARN + RECORD (raise warning + a row in lesson.content_fix_reports) —
--   assertions about upstream content that may have legitimately drifted:
--     * required patterns that matched nothing;
--     * a total no-op against a populated catalog;
--     * the "always returned" backstop sweep finding an uncovered wording;
--     * a graded key absent from the published payload text.
--   Not ignorable: `select * from lesson.content_fix_reports where
--   unresolved_count > 0` is the operator check (docs/mainnet-deploy-runbook.md
--   §11a). A non-empty result means the guarantee may still be live somewhere.

do $mig$
declare
  v_tables text[] := array[
    'lesson.lesson_blocks',
    'lesson.published_lesson_payloads',
    'lesson.published_lessons'
  ];
  v_tbl text;
  r record;
  n bigint;
  v_content_rows bigint;
  v_pre_total bigint;
  v_post_total bigint;
  v_sentinel bigint;
  v_zero text;
  v_residual text;
  v_sweep text;
  v_mcq_bad text;
  v_mcq_payload_bad text;
  v_unresolved int := 0;
  v_report text := '';
  -- the corrected quiz key, referenced in three places below
  v_key text := 'Principal is the USDC you locked — never taken as a penalty, though not guaranteed; yield is the interest it earns, forfeited if you lapse';
begin
  -- Durable home for the soft-failure findings (see FAILURE POLICY above), and
  -- the same table 0057 writes to. A warning scrolls past in a deploy log; a
  -- row does not.
  create table if not exists lesson.content_fix_reports (
    id bigserial primary key,
    migration text not null,
    ran_at timestamptz not null default now(),
    unresolved_count integer not null,
    detail text not null
  );

  create temporary table _c0058 (
    seq serial primary key,
    find text not null,
    repl text not null,
    required boolean not null default true,
    pre_hits bigint not null default 0,
    post_hits bigint not null default 0
  ) on commit drop;

  insert into _c0058 (find, repl) values

  -- bw-6 "rules of the smart contract" list. Written by 0051 ($f13/$r13).
  ($f$- **Streak:** Track daily completion. If the user lapses after shields are spent: earned yield is forfeited to the community pot — principal is always returned.$f$,
   $r$- **Streak:** Track daily completion. If the user lapses after shields are spent: earned yield is forfeited to the community pot. A lapse never takes principal — but principal is not guaranteed either. It is supplied to Kamino, so a protocol loss, a USDC depeg or a Solana failure can return less than was deposited, and nobody tops up the difference.$r$),

  -- df-3 "is the yield real" money-flow chain. Written by 0051 ($f41/$r41).
  ($f$Users who lapse (miss days after their shields are spent) forfeit their yield to the community pot — principal is always returned.$f$,
   $r$Users who lapse (miss days after their shields are spent) forfeit their yield to the community pot. A lapse never takes your principal — but your principal is not guaranteed either: it sits in Kamino, so a protocol loss, a USDC depeg or a Solana failure can return less than you deposited. And a lock exited by the 180-day force return instead of by finishing the course pays back principal only — all of its yield goes to the pot.$r$),

  -- bw-4-q1 option 3, which is the GRADED KEY: a learner is currently marked
  -- CORRECT for answering that principal is always returned. Written by 0051
  -- ($r76/$r77/$qc1) and re-applied to the options table by 0052 ($r1$).
  -- questions.correct_answer and question_options.option_text move with it below.
  ($f$Principal is your locked USDC, always returned; yield is the interest it earns, forfeited only if you lapse$f$,
   $r$Principal is the USDC you locked — never taken as a penalty, though not guaranteed; yield is the interest it earns, forfeited if you lapse$r$);

  ---------------------------------------------------------------------------
  -- Apply
  ---------------------------------------------------------------------------
  select count(*) into v_content_rows from lesson.published_lesson_payloads;

  -- Sampled BEFORE any update: this is what distinguishes an idempotent re-run
  -- (corrected copy already on disk) from a first run whose patterns are wrong.
  -- Sampling it afterwards would always be non-zero and would mask exactly the
  -- silent no-op this migration exists to prevent.
  select count(*) into v_sentinel
    from lesson.published_lessons
   where position($s$never taken as a penalty, though not guaranteed$s$ in payload::text) > 0;

  foreach v_tbl in array v_tables loop
    for r in select seq, find from _c0058 order by seq loop
      execute format('select count(*) from %s where position($1 in payload::text) > 0', v_tbl)
        into n using r.find;
      update _c0058 set pre_hits = pre_hits + n where seq = r.seq;
    end loop;
  end loop;

  foreach v_tbl in array v_tables loop
    for r in select seq, find, repl from _c0058 order by seq loop
      execute format(
        'update %s set payload = replace(payload::text, $1, $2)::jsonb where position($1 in payload::text) > 0',
        v_tbl
      ) using r.find, r.repl;
    end loop;
  end loop;

  -- Graded key and on-screen option, kept in lockstep with the payload text
  -- replaced above. NOT matched by option id: 0052 exists precisely because
  -- option ids are generated per-environment, so an id match silently missed on
  -- prod. Matched by the old text OR by option_order, which on a correctly
  -- seeded database are the same row — so this lands unconditionally for
  -- bw-4-q1 even if the option text has drifted, which is what lets the
  -- key-vs-option check below hard-fail.
  update lesson.questions
     set correct_answer = v_key
   where id = 'bw-4-q1';

  update lesson.question_options
     set option_text = v_key
   where question_id = 'bw-4-q1'
     and (option_text = $f$Principal is your locked USDC, always returned; yield is the interest it earns, forfeited only if you lapse$f$
          or option_order = 3);

  ---------------------------------------------------------------------------
  -- Verification — loud by construction
  ---------------------------------------------------------------------------
  foreach v_tbl in array v_tables loop
    for r in select seq, find from _c0058 order by seq loop
      execute format('select count(*) from %s where position($1 in payload::text) > 0', v_tbl)
        into n using r.find;
      update _c0058 set post_hits = post_hits + n where seq = r.seq;
    end loop;
  end loop;

  select coalesce(sum(pre_hits), 0), coalesce(sum(post_hits), 0)
    into v_pre_total, v_post_total from _c0058;

  raise notice '0058: % content rows, % pattern hits before, % after, % pre-existing corrected rows',
    v_content_rows, v_pre_total, v_post_total, v_sentinel;

  select string_agg(format('  #%s "%s"', seq, left(find, 70)), E'\n' order by seq)
    into v_zero from _c0058 where required and pre_hits = 0;
  if v_zero is not null then
    if v_sentinel > 0 then
      -- Corrected copy already present: this is a re-run, not a broken pattern.
      raise notice E'0058: re-run — % required patterns already corrected.',
        (select count(*) from _c0058 where required and pre_hits = 0);
    else
      -- WARN + RECORD, not abort: a required pattern missing its target means
      -- the stored jsonb no longer looks like this text (the 0051 failure), and
      -- the guarantee may still be live in some other wording. That needs a
      -- human — but the content is equally broken with or without this deploy,
      -- so blocking the deploy fixes nothing and blocks unrelated hotfixes.
      v_unresolved := v_unresolved
        + (select count(*)::int from _c0058 where required and pre_hits = 0);
      v_report := v_report
        || format(
             E'%s required pattern(s) matched NOTHING — the fix may have silently done nothing (the 0051 failure). Rewrite them against the current stored jsonb:\n%s\n',
             (select count(*) from _c0058 where required and pre_hits = 0), v_zero);
      raise warning E'0058: % required patterns matched NOTHING. The stored jsonb does not contain this text, so the fix may have silently done nothing (the 0051 failure). Recorded in lesson.content_fix_reports — correct the patterns:\n%',
        (select count(*) from _c0058 where required and pre_hits = 0), v_zero;
    end if;
  end if;

  -- HARD FAIL: a pattern that matched and is STILL there means the replace
  -- above did not do what it says. That is a bug in this file — upstream drift
  -- cannot cause it (an unmatched pattern has pre = post = 0) — and it means a
  -- guarantee we believe we corrected is still being served.
  select string_agg(format('  #%s post=%s "%s"', seq, post_hits, left(find, 70)), E'\n' order by seq)
    into v_residual from _c0058 where post_hits > 0;
  if v_residual is not null then
    raise exception E'0058: the false guarantee SURVIVED the migration:\n%', v_residual;
  end if;

  -- A total no-op against a populated catalog means the patterns are wrong.
  -- Tolerated only when the corrected copy is already present (re-run).
  -- WARN + RECORD for the same reason as the required-pattern check above.
  if v_content_rows > 0 and v_pre_total = 0 and v_sentinel = 0 then
    v_unresolved := v_unresolved + 1;
    v_report := v_report
      || format(
           E'NO-OP: %s lesson payload rows exist but no pattern matched and the corrected copy is absent — the stored jsonb does not look like these patterns.\n',
           v_content_rows);
    raise warning '0058: NO-OP — % lesson payload rows exist but no pattern matched and the corrected copy is absent. The stored jsonb does not look like these patterns. Recorded in lesson.content_fix_reports; fix the patterns.', v_content_rows;
  end if;

  -- Backstop sweep: catch any OTHER wording of the same guarantee that these
  -- three patterns did not cover, in content and in graded answers alike. On a
  -- database replayed from 0001 this is empty; a hit means new false copy was
  -- introduced and must be handled explicitly rather than shipped.
  select string_agg(format('  %s (%s rows)', src, cnt), E'\n')
    into v_sweep
    from (
      select 'lesson.lesson_blocks' as src,
             count(*) as cnt from lesson.lesson_blocks
       where payload::text ilike '%always returned%'
      union all
      select 'lesson.published_lesson_payloads', count(*) from lesson.published_lesson_payloads
       where payload::text ilike '%always returned%'
      union all
      select 'lesson.published_lessons', count(*) from lesson.published_lessons
       where payload::text ilike '%always returned%'
      union all
      select 'lesson.questions.correct_answer', count(*) from lesson.questions
       where correct_answer ilike '%always returned%'
      union all
      select 'lesson.question_options.option_text', count(*) from lesson.question_options
       where option_text ilike '%always returned%'
    ) s
   where cnt > 0;

  -- WARN + RECORD: an uncovered wording is upstream content, not a fault of the
  -- three replaces above (which are proven clean by the residual check).
  if v_sweep is not null then
    v_unresolved := v_unresolved + 1;
    v_report := v_report
      || format(
           E'"always returned" still present after the fix — an uncovered wording of the principal guarantee is still live:\n%s\n',
           v_sweep);
    raise warning E'0058: "always returned" still present after the fix — an uncovered wording of the principal guarantee is still live. Recorded in lesson.content_fix_reports:\n%', v_sweep;
  end if;

  -- The graded key must agree with its on-screen option. This is the 0054
  -- failure, checked directly.
  --
  -- HARD FAIL half: lesson.questions vs lesson.question_options. Both sides are
  -- set unconditionally for bw-4-q1 by the UPDATEs above, so a mismatch here is
  -- this file being internally wrong — nothing upstream can cause it.
  select string_agg(format('  %s / %s', src, qid), E'\n')
    into v_mcq_bad
    from (
      select 'question_options' as src, q.id as qid
        from lesson.questions q
       where q.id = 'bw-4-q1'
         and not exists (
           select 1 from lesson.question_options o
            where o.question_id = q.id and o.option_text = q.correct_answer
         )
    ) bad;

  if v_mcq_bad is not null then
    raise exception E'0058: graded key has no matching option row — learners would be marked wrong for the right answer:\n%', v_mcq_bad;
  end if;

  -- WARN + RECORD half: the published payloads. These depend on the text
  -- patterns above having matched, so drifted content lands here rather than in
  -- the hard failure. Still a real learner-facing bug — hence the record.
  select string_agg(format('  %s / %s', src, qid), E'\n')
    into v_mcq_payload_bad
    from (
      select 'published_lessons' as src, q.id as qid
        from lesson.questions q
        join lesson.published_lessons pl
          on position(format('"id": "%s"', q.id) in pl.payload::text) > 0
       where q.id = 'bw-4-q1'
         and position(q.correct_answer in pl.payload::text) = 0
      union all
      select 'published_lesson_payloads' as src, q.id
        from lesson.questions q
        join lesson.published_lesson_payloads plp
          on position(format('"id": "%s"', q.id) in plp.payload::text) > 0
       where q.id = 'bw-4-q1'
         and position(q.correct_answer in plp.payload::text) = 0
    ) bad;

  if v_mcq_payload_bad is not null then
    v_unresolved := v_unresolved + 1;
    v_report := v_report
      || format(
           E'Graded key absent from the published payload text — learners would be marked wrong for the right answer:\n%s\n',
           v_mcq_payload_bad);
    raise warning E'0058: graded key absent from the published payload text — learners would be marked wrong for the right answer. Recorded in lesson.content_fix_reports:\n%',
      v_mcq_payload_bad;
  end if;

  -- One row per run, always — an absent row is itself a signal that this
  -- migration never executed here.
  insert into lesson.content_fix_reports (migration, unresolved_count, detail)
  values (
    '0058_fix_principal_guarantee_content',
    v_unresolved,
    case
      when v_unresolved = 0 then format(
        'OK — %s occurrences of the principal guarantee corrected across %s; bw-4-q1 key verified against its options.',
        v_pre_total, array_to_string(v_tables, ', '))
      else v_report
    end
  );

  if v_unresolved > 0 then
    raise warning '0058: % unresolved finding(s) recorded in lesson.content_fix_reports. The principal guarantee may still be live — see docs/mainnet-deploy-runbook.md §11a.',
      v_unresolved;
  else
    raise notice '0058: OK — % occurrences of the principal guarantee corrected across %; bw-4-q1 key verified against its options.',
      v_pre_total, array_to_string(v_tables, ', ');
  end if;
end
$mig$;
