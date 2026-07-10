-- XP-event uniqueness (practice-mode ruling R21, 2026-07-10).
--
-- 0029 shipped user_xp_events with no unique constraint, so the SELECT-then-
-- INSERT guard in awardXp double-awards under concurrency. Dedupe historical
-- rows (keep the earliest per (wallet, source, source_id)), rebuild xp_total
-- from the surviving events, then add the partial unique index that awardXp's
-- ON CONFLICT targets. xp_level self-corrects on the next award — accepted.

DELETE FROM lesson.user_xp_events e
USING lesson.user_xp_events d
WHERE e.source_id IS NOT NULL
  AND d.source_id IS NOT NULL
  AND e.wallet_address = d.wallet_address
  AND e.source = d.source
  AND e.source_id = d.source_id
  AND (e.created_at, e.id) > (d.created_at, d.id);

UPDATE lesson.user_xp u
SET xp_total = coalesce(s.total, 0)
FROM (
  SELECT wallet_address, sum(xp_amount) AS total
  FROM lesson.user_xp_events
  GROUP BY wallet_address
) s
WHERE s.wallet_address = u.wallet_address;

CREATE UNIQUE INDEX IF NOT EXISTS user_xp_events_dedupe_idx
  ON lesson.user_xp_events (wallet_address, source, source_id)
  WHERE source_id IS NOT NULL;
