-- v4: SKR removed from the product entirely.
-- The custody program no longer escrows SKR (LockAccount is USDC-principal only),
-- and the backend no longer reads or writes these columns. Drop them.
alter table lesson.user_course_runtime_state
  drop column if exists skr_locked_amount;

alter table lesson.unlock_receipts
  drop column if exists skr_locked_amount_ui;
