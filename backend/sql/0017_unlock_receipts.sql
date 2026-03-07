create table if not exists lesson.unlock_receipts (
  unlock_tx_signature text primary key,
  wallet_address text not null,
  course_id text not null references lesson.courses(id) on delete cascade,
  lock_account_address text not null,
  principal_amount_ui text not null,
  skr_locked_amount_ui text not null,
  lock_end_at timestamptz not null,
  unlocked_at timestamptz not null,
  verified_slot bigint,
  verified_block_time timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists unlock_receipts_wallet_unlocked_at_idx
  on lesson.unlock_receipts (wallet_address, unlocked_at desc);
