-- 0062: retire the `defi-protocols` placeholder course — but ONLY where it is
-- genuinely an empty shell.
--
-- WHY THIS IS CONDITIONAL RATHER THAN A PLAIN DELETE
--
-- Production and a fresh replay of this migration chain disagree about what
-- `defi-protocols` is, and the difference was measured, not assumed:
--
--   * Production (web-app/e2e/fixtures/content-snapshot.json, captured from
--     the live content API) serves defi-protocols with totalModules = 0 and
--     totalLessons = 0 — a "Coming Soon" card that goes nowhere. Same for
--     anchor-dev, rust-solana and solana-fundamentals.
--   * A full 0001..0059 replay into a clean database serves defi-protocols
--     with 1 module and 3 lessons (dp-1 Automated Market Makers, dp-2 Lending
--     & Borrowing, dp-3 Yield Farming & Staking), seeded by 0022 and 0023.
--
-- So the same statement would remove a dead card in production and destroy
-- three real lessons in any rebuilt database or CI run. An unconditional
-- delete is therefore not safe, and this migration refuses to be one: it
-- retires the course only when the database it is running against actually
-- shows it as contentless, and is a documented no-op everywhere else.
--
-- WHAT COUNTS AS "CONTENTLESS"
--
-- Published content only: lesson.published_modules and lesson.published_lessons.
-- Those are the tables the read path actually serves — content/repository.mjs
-- listCourseModules and listModuleLessons both read published_*, so a course
-- with nothing there serves nothing to anybody, whatever else exists.
--
-- lesson.course_modules is deliberately NOT part of that test. Production holds
-- exactly this shape: course_modules = 1 (an editorial link to
-- 'defi-protocols-module-core') with published_modules = 0 and
-- published_lessons = 0 — i.e. a link to a module that was never published.
-- Counting that link as content would make this migration skip precisely the
-- dead card it exists to remove. Deleting the course cascades that one link
-- row away; the lesson.modules and lesson.lessons rows behind it do not
-- reference lesson.courses and are left untouched.
--
-- The protection that matters is unchanged: a course that serves ANY published
-- module or lesson is skipped, and a course referenced by ANY user or money
-- record is refused outright.
--
-- WHY THE DELETE IS GUARDED AT ALL
--
-- lesson.courses is the parent of 11 foreign keys and EVERY one of them is
-- `on delete cascade` — including lesson.user_course_runtime_state,
-- lesson.unlock_receipts, lesson.completion_vouchers and
-- lesson.claim_attempts. A bare delete would silently cascade through real
-- money records if any user had ever locked into this course. The scan below
-- is driven off pg_constraint rather than a hardcoded list, so a table added
-- later is covered automatically instead of being quietly missed.
--
-- Precedence: content check first (skip), then user-data check (refuse). Once
-- content is known to be zero, any remaining referencing row is by definition
-- user or money data and a human needs to look at it.
--
-- Editorial rows (lesson.modules 'defi-protocols-module-core', lesson.lessons
-- 'dp-1'..'dp-3') are deliberately left in place. They do not reference
-- lesson.courses, the read path serves only published_* tables, and removing
-- the course row is already enough to drop the card from /v1/courses.
--
-- The whole file runs inside the runner's begin/commit, so a raised exception
-- rolls back and changes nothing.

do $mig$
declare
  v_course_id   constant text := 'defi-protocols';
  v_course_mods integer;
  v_pub_mods    integer;
  v_pub_lessons integer;
  v_ref         record;
  v_n           integer;
  v_blockers    text := '';
begin
  if not exists (select 1 from lesson.courses where id = v_course_id) then
    raise notice '0062: course % not present — nothing to retire.', v_course_id;
    return;
  end if;

  -------------------------------------------------------------------------
  -- 1. Is it actually an empty shell HERE?
  -------------------------------------------------------------------------
  select count(*) into v_course_mods
    from lesson.course_modules where course_id = v_course_id;

  select count(*) into v_pub_mods
    from lesson.published_modules where course_id = v_course_id;

  select count(*) into v_pub_lessons
    from lesson.published_lessons pl
   where exists (
     select 1 from lesson.published_modules pm
      where pm.module_id = pl.module_id and pm.course_id = v_course_id
   );

  -- Published content only — see "WHAT COUNTS AS CONTENTLESS" in the header.
  -- v_course_mods is reported for transparency but does NOT gate the delete.
  if v_pub_mods > 0 or v_pub_lessons > 0 then
    raise notice
      '0062: SKIPPED — % serves published content in this database (published_modules=%, published_lessons=%, course_modules=%). Retiring it would destroy that content, so nothing was changed.',
      v_course_id, v_pub_mods, v_pub_lessons, v_course_mods;
    return;
  end if;

  -------------------------------------------------------------------------
  -- 2. Content is zero. Any remaining reference is user/money data — refuse.
  --    Driven off pg_constraint so tables added later are covered too.
  -------------------------------------------------------------------------
  for v_ref in
    select con.conrelid::regclass::text as tbl,
           att.attname                  as col
      from pg_constraint con
      join pg_class ref       on ref.oid = con.confrelid
      join pg_namespace refns on refns.oid = ref.relnamespace
      join unnest(con.conkey) with ordinality as k(attnum, ord) on true
      join pg_attribute att   on att.attrelid = con.conrelid and att.attnum = k.attnum
     where con.contype = 'f'
       and refns.nspname = 'lesson'
       and ref.relname   = 'courses'
       and con.conrelid::regclass::text
             not in ('lesson.course_modules', 'lesson.published_modules')
     order by 1
  loop
    execute format('select count(*) from %s where %I = $1', v_ref.tbl, v_ref.col)
       into v_n
      using v_course_id;

    if v_n > 0 then
      v_blockers := v_blockers || format('%s=%s ', v_ref.tbl, v_n);
    end if;
  end loop;

  if v_blockers <> '' then
    raise exception
      '0062: REFUSING to delete % — user or money records still reference it (%). Every FK onto lesson.courses is ON DELETE CASCADE, so deleting would destroy those rows. Resolve them first.',
      v_course_id, trim(v_blockers);
  end if;

  -------------------------------------------------------------------------
  -- 3. Safe to retire.
  -------------------------------------------------------------------------
  delete from lesson.courses where id = v_course_id;

  if exists (select 1 from lesson.courses where id = v_course_id) then
    raise exception '0062: % still present after delete.', v_course_id;
  end if;

  raise notice
    '0062: OK — retired the % placeholder (published_modules=0, published_lessons=0; % editorial course_modules link(s) cascaded away). Its dead catalog card is gone.',
    v_course_id, v_course_mods;
end
$mig$;
