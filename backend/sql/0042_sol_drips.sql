-- One-time onboarding SOL drips (spec §4.2): ~0.005 SOL per wallet so a fresh
-- wallet can pay its first transaction fees. The UNIQUE wallet_address is the
-- idempotency anchor — a wallet can never be paid twice, even across races
-- (INSERT ... ON CONFLICT DO NOTHING reserves the slot BEFORE any transfer).
-- An empty signature means "reserved, payment not confirmed recorded"; such a
-- row still blocks re-drips (fail closed — never risk a double payout).
CREATE TABLE IF NOT EXISTS lesson.sol_drips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL UNIQUE,
  signature text NOT NULL DEFAULT '',
  lamports bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
