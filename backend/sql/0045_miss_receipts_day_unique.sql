-- Miss-day dedupe spine (practice-mode ruling R16, 2026-07-10).
--
-- miss_consequence_receipts' PK is per miss_event_id only (0007), so two
-- producers with different id conventions (in-process worker, submit-time
-- catch-up, daily sweep, internal endpoint) could each punish the same
-- (wallet, course, day). Dedupe historical rows (keep the earliest), then
-- make a second punishment of the same day impossible at the database layer.
-- Historical state effects of deleted duplicate receipts are accepted devnet
-- debt. Canonical event id everywhere: auto-miss:{wallet}:{course}:{missDay}.

DELETE FROM lesson.miss_consequence_receipts e
USING lesson.miss_consequence_receipts d
WHERE e.wallet_address = d.wallet_address
  AND e.course_id = d.course_id
  AND e.miss_day = d.miss_day
  AND (e.created_at, e.miss_event_id) > (d.created_at, d.miss_event_id);

CREATE UNIQUE INDEX IF NOT EXISTS miss_consequence_receipts_day_uniq
  ON lesson.miss_consequence_receipts (wallet_address, course_id, miss_day);
