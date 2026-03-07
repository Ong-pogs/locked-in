# Leaderboard and Community Pot View Spec (v3.0)

## Scope

Leaderboard is an off-chain ranking and analytics view backed by verified activity and on-chain financial data.
It does not settle funds.

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

- on-chain: pot balances, lock balances, yield redirects
- backend: streak snapshots, lesson verification history, ranking materialization

Backend should maintain precomputed ranking snapshots for responsive mobile queries.

Current implementation checkpoint:

- backend can now materialize ranking snapshots into Postgres
- snapshots store:
  - current pot amount
  - next distribution window label
  - all ranked wallet rows for that refresh
- the public leaderboard route now prefers the latest materialized snapshot and falls back to a live computation only when no snapshot exists yet
- the app now shows whether the current view is a snapshot or live fallback

## Refresh and Latency Targets

- ranking refresh: near real-time batch cadence (for example every few minutes)
- pot and projection refresh: on balance/index updates
- user rank pinning: always show signed-in user rank even outside current page window

Current implementation checkpoint:

- leaderboard reads are now paged
- the current user row is fetched independently from the current page slice
- mobile can page through snapshot rows without losing the pinned signed-in rank card

Current operator path:

- scheduler/admin can trigger a refresh through:
  - `POST /v1/internal/leaderboard/refresh`

## Privacy and Fairness

1. support display-name or abbreviated wallet mode
2. support hiding exact deposit amount in favor of ranges if required
3. provide transparent ranking formula documentation in app help

## Explicit Out of Scope (v3.0)

- peer betting on user streak outcomes
- prediction-market style side pools
- any gambling-like escrow features
