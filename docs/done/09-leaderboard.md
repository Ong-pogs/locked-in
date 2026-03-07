# Done: 09 Leaderboard

## Scope Completed

This checkpoint replaced the placeholder leaderboard screen with a real off-chain ranking view backed by live lock/runtime state and CommunityPot projection data.

## What Was Implemented

- Backend now serves `/v1/progress/leaderboard`.
- Backend can now also materialize ranking snapshots and read the latest snapshot on request.
- Snapshot reads are now paged.
- The signed-in user rank is fetched separately, so it stays pinned even when the current page slice does not include that wallet.
- Ranking is computed from:
  - highest live active streak
  - aggregate locked principal
  - active course count
  - recent activity date
- Each row now includes:
  - rank
  - display identity
  - streak status
  - active course count
  - locked principal
  - projected CommunityPot share
- The app now shows:
  - current CommunityPot size
  - next distribution window label
  - signed-in user pinned rank
  - ranked wallet rows
  - snapshot update time or live-fallback status

### Snapshot layer

- Added a persisted leaderboard snapshot store in Postgres.
- Internal refresh path:
  - `POST /v1/internal/leaderboard/refresh`
- Public leaderboard reads the latest snapshot when present.
- If no snapshot exists yet, the endpoint still falls back to the previous live computation.

## Main Files

- `backend/src/modules/progress/repository.mjs`
- `backend/src/modules/progress/routes.mjs`
- `backend/sql/0018_leaderboard_snapshots.sql`
- `src/services/api/types.ts`
- `src/services/api/progress/progressApi.ts`
- `src/screens/main/LeaderboardScreen.tsx`

## Remaining Follow-up

- Decide whether exact principal should later move to privacy-safe bands.
