alter table lesson.harvest_result_receipts
  add column if not exists yield_splitter_status text not null default 'pending',
  add column if not exists yield_splitter_published_at timestamptz,
  add column if not exists yield_splitter_last_error text,
  add column if not exists yield_splitter_transaction_signature text,
  add column if not exists yield_splitter_receipt_account text;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'harvest_result_receipts_yield_splitter_status_check'
  ) then
    alter table lesson.harvest_result_receipts
      drop constraint harvest_result_receipts_yield_splitter_status_check;
  end if;
end $$;

alter table lesson.harvest_result_receipts
  add constraint harvest_result_receipts_yield_splitter_status_check
    check (yield_splitter_status in ('pending', 'publishing', 'published', 'failed'));
