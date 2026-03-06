# 02 Summary - Lesson API

## Scope

Summary of completed work for `docs/02-lesson-api.md`.

## Implemented Backend

- Modular backend scaffold is in place and wired:
  - `content`, `auth`, `progress` route modules
  - OpenAPI contract at `backend/openapi/lesson-api-v1.yaml`
  - scalable SQL schema at `backend/sql/0001_lesson_platform.sql`
- Auth routes implemented:
  - `POST /v1/auth/challenge`
  - `POST /v1/auth/verify`
  - `POST /v1/auth/refresh`
- Real Solana signature verification implemented (no placeholder logic):
  - Ed25519 verification via `tweetnacl`
  - public key/signature decoding via `bs58`
  - supports detached signatures and MWA signed-payload format
- Progress routes implemented:
  - `POST /v1/progress/lessons/:lessonId/start`
  - `POST /v1/progress/lessons/:lessonId/submit`
  - course/module progress reads
- CORS allowlist is configurable and patched for local web/mobile dev.
- Logging upgraded to readable structured logs with request lifecycle entries:
  - `request.start`
  - `request.end`

## Implemented Frontend

- Modular API layer completed:
  - `content`, `auth`, `progress` API modules
  - adapter pattern (`http` provider + `mock` provider)
  - repository mapping into app state
- Runtime mode switching works:
  - remote mode when `EXPO_PUBLIC_LESSON_API_BASE_URL` is set
  - mock fallback when remote unavailable
- HTTP client now has:
  - explicit request/response logs in dev
  - network error diagnostics with full URL
  - host fallback candidates for Android dev scenarios
- Course store content initialization improved:
  - remote upgrade path from mock snapshot
  - better dev diagnostics for skip/start/success/error
- Lesson flow integration completed:
  - calls `start` when questions begin
  - calls `submit` when lesson completes
  - backend token refresh path used for sync attempts

## Verified End-to-End

- Auth:
  - challenge `200`
  - verify `200`
- Content:
  - courses/modules/lessons/content-version reads `200`
- Progress:
  - lesson start `204`
  - lesson submit `200`
- Frontend and backend logs match for the same request sequence.

## Status

`docs/02-lesson-api.md` implementation is complete for the requested v1 scope and current dev workflow.

