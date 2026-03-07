create table if not exists lesson.leaderboard_snapshots (
  snapshot_id bigserial primary key,
  snapshot_at timestamptz not null default now(),
  current_pot_amount bigint not null default 0,
  next_distribution_window_label text,
  entry_count integer not null default 0
);

create table if not exists lesson.leaderboard_snapshot_rows (
  snapshot_id bigint not null references lesson.leaderboard_snapshots (snapshot_id) on delete cascade,
  rank integer not null,
  wallet_address text not null,
  display_identity text not null,
  streak_length integer not null,
  streak_status text not null,
  active_course_count integer not null,
  locked_principal_amount bigint not null,
  projected_community_pot_share bigint not null default 0,
  recent_activity_date date,
  primary key (snapshot_id, rank),
  unique (snapshot_id, wallet_address),
  check (streak_status in ('active', 'broken'))
);

create index if not exists leaderboard_snapshot_rows_snapshot_wallet_idx
  on lesson.leaderboard_snapshot_rows (snapshot_id, wallet_address);
