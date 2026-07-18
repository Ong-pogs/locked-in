-- 0054: converge lesson.published_lessons onto the cleaned publish payloads.
--
-- 0051/0052 stripped the deleted Fuel/Ichor mechanics from lesson.lesson_blocks
-- and lesson.published_lesson_payloads — but the catalog API serves lesson
-- payloads from lesson.published_lessons (content/repository.mjs
-- listModuleLessons), which those migrations never touched. Result: 18
-- (lesson, release) rows still showed v1 Fuel/Ichor content, INCLUDING quiz
-- questions whose on-screen options no longer match the graded answers in
-- lesson.questions — users picking the correct-looking stale option were
-- marked wrong.
--
-- Fix: copy the clean same-release payload across. Guarded so it only touches
-- rows that are stale AND have a verified-clean counterpart; idempotent.

update lesson.published_lessons pl
set payload = plp.payload
from lesson.published_lesson_payloads plp
where plp.lesson_id = pl.lesson_id
  and plp.release_id = pl.release_id
  and (pl.payload::text ilike '%fuel%' or pl.payload::text ilike '%ichor%')
  and plp.payload::text not ilike '%fuel%'
  and plp.payload::text not ilike '%ichor%';
