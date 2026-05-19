-- Prevent the TOCTOU faucet-drain: two parallel claims from the same wallet
-- with the same JWT used to pass the eligibility check independently and
-- each insert a row (no unique constraint existed). Now `(wallet_address,
-- round)` is unique so the second insert raises a UNIQUE violation, and
-- the claim flow does an `INSERT ... ON CONFLICT DO NOTHING RETURNING id`
-- to atomically reserve before any Solana transfer happens.
--
-- If the table has duplicates from past activity, dedupe first (keep the
-- oldest row per (wallet, round)). On a fresh deploy this is a no-op.
DELETE FROM lesson.faucet_claims a
USING lesson.faucet_claims b
WHERE a.wallet_address = b.wallet_address
  AND a.round = b.round
  AND a.created_at > b.created_at;

-- Use CREATE UNIQUE INDEX IF NOT EXISTS instead of ADD CONSTRAINT.
-- Postgres treats a unique index as a valid target for ON CONFLICT,
-- and this form is idempotent — re-running the migration won't error.
CREATE UNIQUE INDEX IF NOT EXISTS faucet_claims_wallet_round_unique
  ON lesson.faucet_claims (wallet_address, round);
