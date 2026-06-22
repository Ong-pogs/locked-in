# Leaderboard and Community Pot View Spec (v4.0)

## Scope

Leaderboard is an off-chain ranking and analytics view backed by verified activity and on-chain custody data.
It does not settle funds.

It is served from a periodically refreshed materialized snapshot, with a live
computation as fallback when no snapshot exists yet.

## Core Ranking Dimensions

Primary ranking dimension:

- active streak length

Secondary tie-break dimensions:

- locked principal size
- verified completion consistency
- recent activity freshness

## Required Entry Fields

Each leaderboard row should include:

- rank
- display identity (alias or truncated wallet)
- streak length
- streak status (`active` or `broken`)
- active course count
- locked principal aggregate (or privacy-safe band)
- projected community pot share

## Community Pot Integration

Leaderboard must show:

- current community pot size
- next distribution timestamp
- user projection using distribution weighting policy

Distribution policy basis:

- eligible users with active streaks
- weighting by streak length and deposit size

## Data Sources

Ranking rows are assembled from three sources, merged per wallet:

- DB runtime state (`lesson.user_course_runtime_state`): streak length and last
  completed day (recent activity). The custody-only vault no longer carries
  streak or activity, so these are DB-owned.
- on-chain custody snapshot (per-lock `LockAccount`): lock status and locked
  principal. Only `active` (status `0`) locks contribute.
- closed distribution windows (`lesson.community_pot_distribution_snapshots`):
  current pot amount, next distribution window label, and the projected pot
  share per wallet.

Backend maintains precomputed ranking snapshots for responsive mobile queries.

Current implementation:

- `computeLeaderboardRows` (backend/src/modules/progress/repository.mjs) builds
  the live ranked rows from the three sources above.
- `refreshLeaderboardSnapshot` materializes those rows into Postgres tables
  `lesson.leaderboard_snapshots` (one row per refresh) and
  `lesson.leaderboard_snapshot_rows` (the ranked wallet rows for that refresh).
- each snapshot row stores:
  - current pot amount
  - next distribution window label
  - all ranked wallet rows for that refresh
- `getLeaderboardSnapshot` serves the public leaderboard: it prefers the latest
  materialized snapshot and falls back to a live `computeLeaderboardRows` pass
  only when no snapshot exists yet.
- the app shows snapshot freshness above the podium using response
  `snapshotAt`; if no snapshot exists yet, it shows the live fallback state.

Note (internal): the live fallback `computeLeaderboardRows` reads one lock
account at a time (one `getAccountInfo` per lock). A `getMultipleAccountsInfo`
batch fix is a pending follow-up for mainnet scale; the materialized snapshot
path is the normal serving path and is unaffected.

## Refresh and Latency Targets

- ranking refresh: near real-time batch cadence (for example every few minutes)
- pot and projection refresh: on balance/index updates
- user rank pinning: always show signed-in user rank even outside current page window

Current implementation checkpoint:

- leaderboard reads are now paged
- the current user row is fetched independently from the current page slice
- mobile can page through snapshot rows without losing the pinned signed-in rank card

Current operator path:

- leaderboard snapshots refresh through a daily cron job that runs
  `npm run cron:leaderboard-refresh` from `backend/`
- the in-process backend worker
  (`leaderboardSnapshotWorker`, backend/src/workers/leaderboardSnapshotWorker.mjs)
  remains available for local/E2E runs but should stay disabled when cron owns
  refreshes (`LEADERBOARD_SNAPSHOT_ENABLED=false`)
- scheduler/admin can trigger an immediate refresh through:
  - `POST /v1/internal/leaderboard/refresh`

## Privacy and Fairness

1. support display-name or abbreviated wallet mode
2. support hiding exact deposit amount in favor of ranges if required
3. provide transparent ranking formula documentation in app help

## Explicit Out of Scope (v4.0)

- peer betting on user streak outcomes
- prediction-market style side pools
- any gambling-like escrow features
