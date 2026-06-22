-- Remove the on-chain yield_splitter publish tracking from harvest receipts.
-- The yield_splitter PROGRAM has been deleted on-chain, so the off-chain
-- columns that mirrored its publish state machine no longer serve a purpose.
-- Drops are devnet-only at this point (not yet on mainnet), so there is no
-- production data loss. The core harvest recording columns and the
-- (wallet_address, course_id, harvest_id) idempotency PK are untouched.
alter table lesson.harvest_result_receipts
  drop column if exists yield_splitter_status,
  drop column if exists yield_splitter_published_at,
  drop column if exists yield_splitter_last_error,
  drop column if exists yield_splitter_transaction_signature,
  drop column if exists yield_splitter_receipt_account;
