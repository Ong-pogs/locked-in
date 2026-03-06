-- Idempotent receipt log for daily Fuel burn cycles.

create table if not exists lesson.fuel_burn_cycle_receipts (
  wallet_address text not null,
  course_id text not null references lesson.courses(id) on delete cascade,
  cycle_id text not null,
  burned_at timestamptz not null,
  applied boolean not null,
  fuel_before integer not null,
  fuel_after integer not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (wallet_address, course_id, cycle_id),
  check (fuel_before >= 0),
  check (fuel_after >= 0)
);

create index if not exists fuel_burn_cycle_receipts_burned_at_idx
  on lesson.fuel_burn_cycle_receipts (burned_at desc);
