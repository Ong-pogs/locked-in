-- Real-money support trail (mainnet hardening, 2026-07-20). Additive only.
--
-- Claiming is executed entirely by the client, and lesson.completion_vouchers
-- only records the voucher we ISSUED — so a user reporting "my claim failed"
-- left no server-side trace at all. claim_attempts is that trace. It is
-- deliberately append-only telemetry: it never gates a claim, so a write
-- failure must not be able to block anyone's money.
--
-- user_consents is the opposite: it is a legal record of the terms a user
-- accepted before depositing, keyed so the FIRST acceptance of a version wins
-- (a re-POST must never rewrite history).

create table if not exists lesson.claim_attempts (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  course_id text not null references lesson.courses(id) on delete cascade,
  -- Free-form on purpose: the client's claim state machine will grow phases,
  -- and a CHECK here would turn a UI change into a 400 on the money path. The
  -- route owns the allowlist.
  phase text not null,
  signature text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists claim_attempts_wallet_idx
  on lesson.claim_attempts (wallet_address, created_at desc);

create index if not exists claim_attempts_course_idx
  on lesson.claim_attempts (course_id, created_at desc);

alter table lesson.claim_attempts enable row level security;
alter table lesson.claim_attempts force row level security;

create policy claim_attempts_wallet_policy
  on lesson.claim_attempts
  using ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address)
  with check ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address);

create table if not exists lesson.user_consents (
  wallet_address text not null,
  terms_version text not null,
  accepted_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (wallet_address, terms_version)
);

create index if not exists user_consents_version_idx
  on lesson.user_consents (terms_version, accepted_at desc);

alter table lesson.user_consents enable row level security;
alter table lesson.user_consents force row level security;

create policy user_consents_wallet_policy
  on lesson.user_consents
  using ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address)
  with check ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address);
