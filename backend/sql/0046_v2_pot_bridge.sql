-- v2 pot bridge (pot-cycle ruling 2026-07-10, R1). Additive only — safe to
-- apply under running old code, and applied to prod BEFORE any R2-R7 backend
-- code ships (R12 step 1). Never reuse 0046 for anything else.
--
-- Why these tables exist: the live devnet v2 config has pot_vault ==
-- fee_vault == the deployer's own USDC ATA (GCWEHFyJ…), permanently
-- commingled (set_config_v2 cannot repoint either vault). Pot amounts are
-- therefore NEVER derived by sweeping a balance — they are derived per-event
-- from vault_v2's LockV2Settled events and booked into the merged program's
-- pot ledger via record_redirect (R2).

-- (a) Per-event ledger of LockV2Settled forfeits (to_pot > 0 only). Primary
-- key (tx_signature, lock_address) makes the indexer's re-scan idempotent;
-- record_status tracks the record_redirect relay leg (the on-chain
-- RedirectReceipt is the ultimate double-book guard).
CREATE TABLE IF NOT EXISTS lesson.v2_pot_settle_events (
  tx_signature text NOT NULL,
  lock_address text NOT NULL,
  to_pot bigint NOT NULL CHECK (to_pot > 0),
  block_time timestamptz NOT NULL,
  window_id bigint NOT NULL,
  record_status text NOT NULL DEFAULT 'pending'
    CHECK (record_status IN ('pending', 'published', 'failed')),
  record_signature text,
  record_last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (tx_signature, lock_address)
);

-- (b) Singleton scan cursor for getSignaturesForAddress pagination. The
-- last_signature only advances AFTER a scan batch's inserts commit, so a
-- crash mid-scan re-reads (ON CONFLICT DO NOTHING) instead of skipping.
CREATE TABLE IF NOT EXISTS lesson.v2_pot_scan_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_signature text,
  updated_at timestamptz DEFAULT now()
);

-- (c) Audit receipt per pot-cycle run (success AND failure paths, R5 step 11).
CREATE TABLE IF NOT EXISTS lesson.pot_cycle_runs (
  window_id bigint NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL,
  detail jsonb,
  PRIMARY KEY (window_id, started_at)
);
