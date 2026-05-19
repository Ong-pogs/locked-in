-- User-claimable yield ledger. A harvest receipt with redirected_amount <
-- gross_yield_amount has user-side yield. claimed_at marks when the user
-- pulled that yield to their wallet. Unclaimed = sum(gross - redirected)
-- over rows where claimed_at is null.

alter table lesson.harvest_result_receipts
  add column if not exists claimed_at timestamptz;

create index if not exists harvest_result_receipts_unclaimed_idx
  on lesson.harvest_result_receipts (wallet_address, course_id)
  where claimed_at is null;
