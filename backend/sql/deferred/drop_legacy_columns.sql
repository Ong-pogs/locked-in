-- DESTRUCTIVE — DEFERRED. DO NOT APPLY. DO NOT MOVE INTO backend/sql/ YET.
--
-- This file lives in backend/sql/deferred/ ON PURPOSE: scripts/migrate.mjs
-- applies ALL pending sql/*.sql, so a committed-but-unapplied drop inside
-- sql/ would be dragged in by any future migration run (pot-cycle ruling R11
-- makes the deferred/ folder mandatory).
--
-- Drops the ten legacy ichor/fuel/gauntlet/saver runtime columns whose last
-- writers/readers were removed by the legacy-deletion PR-B strip build.
--
-- PROMOTION PRECONDITIONS (all must hold before this file may run):
--   1. The PR-F redirect release and the PR-B strip build are BOTH live and
--      verified on prod (deleted routes 404, v2 smoke green, shield-lapse
--      sweep exits 0), soaked >= 24h (one full UTC-day submit cycle + one
--      sweep run).
--   2. Grep gate returns ZERO hits:
--        grep -rn "ichor_counter\|ichor_lifetime_total\|fuel_counter\|fuel_cap\|fuel_fragments\|gauntlet_active\|gauntlet_day\|saver_count\b\|saver_recovery_mode" backend/src web-app
--      (receipt-table columns saver_count_before/after are NOT dropped and
--      do not count as hits.)
--   3. Move this file into backend/sql/ renamed to the then-next free
--      migration number; apply it manually via
--      `node backend/scripts/migrate.mjs` after a --dry-run showing it is
--      the ONLY pending file and after confirming the live Render deploy is
--      the PR-B strip build or later.
--   4. After the apply, NEVER roll the backend back past the strip build —
--      this migration is the rollback point of no return.
--
-- Scope fence: lesson.miss_consequence_receipts is NOT touched (its
-- saver/extension columns stay NOT NULL and are fed literal-0 constants).
-- extension_days, fire_lit_until, last_brewer_burn_ts, last_fuel_credit_day,
-- fuel_burn_cycle_receipts, harvest_result_receipts, and every v2/custody
-- column are RETAINED (deferred to a later migration). Single-column check
-- constraints on the dropped columns auto-drop with them.
--
-- migrate.mjs wraps each file in BEGIN/COMMIT, so SET LOCAL is correctly
-- scoped and a lock-timeout abort leaves the tracker unrecorded and the file
-- cleanly re-runnable.

set local lock_timeout = '5s';

alter table lesson.user_course_runtime_state
  drop column if exists ichor_counter,
  drop column if exists ichor_lifetime_total,
  drop column if exists fuel_counter,
  drop column if exists fuel_cap,
  drop column if exists fuel_fragments_today,
  drop column if exists fuel_fragments_day,
  drop column if exists gauntlet_active,
  drop column if exists gauntlet_day,
  drop column if exists saver_count,
  drop column if exists saver_recovery_mode;
