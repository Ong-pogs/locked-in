-- Completion-voucher storage (voucher-autoissue ruling R1, 2026-07-10;
-- numbered 0047 per the coordination header — pot-cycle owns 0046).
-- Additive only: stores the full signed CompletionVoucherResponse so the
-- position endpoint can serve it without re-signing. NO DROPs here.

create table if not exists lesson.completion_vouchers (
  wallet_address text not null,
  course_id text not null references lesson.courses(id) on delete cascade,
  lock_address text not null,
  lapse_count integer not null default 0,
  bps integer not null,
  expiry bigint not null,
  authority_pubkey text not null,
  message text not null,
  signature text not null,
  issued_at timestamptz not null default now(),
  primary key (wallet_address, course_id),
  check (bps in (10000, 5000, 0)),
  check (lapse_count >= 0)
);

alter table lesson.completion_vouchers enable row level security;
alter table lesson.completion_vouchers force row level security;

create policy completion_vouchers_wallet_policy
  on lesson.completion_vouchers
  using ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address)
  with check ((current_setting('request.jwt.claim.wallet_address', true)) = wallet_address);
