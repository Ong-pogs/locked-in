# Done: 02 Lesson API

## Scope Completed

This checkpoint moved lesson verification out of the client and into the backend.
It also hardened wallet-backed API auth so lesson progress is tied to a verified wallet session.

## What Was Implemented

### Wallet auth and session flow

- `POST /v1/auth/challenge`, `POST /v1/auth/verify`, and `POST /v1/auth/refresh` are now the canonical backend auth flow.
- Wallet challenge signatures are verified server-side with Ed25519 before issuing backend tokens.
- Refresh tokens now rotate through persisted `lesson_auth.refresh_sessions` records.
- App launch now attempts wallet `reauthorize`, and disconnect explicitly calls wallet `deauthorize`.
- Remote mode now fails closed if backend auth bootstrap does not succeed.

### Content contract hardening

- Public lesson payloads no longer expose `correctAnswer`.
- Published lessons now include `contentHash`.
- Lesson content remains immutable by release/version at the API contract level.

### Attempt and grading pipeline

- Lesson attempts now use a client-generated `attemptId`.
- `POST /v1/progress/lessons/:lessonId/start` and `submit` use the same attempt id.
- Backend grades answers server-side instead of trusting a client score.
- Question attempts are stored per lesson attempt.
- Submit responses now return backend-computed score data and `completionEventId`.

### Verified completion bridge

- Accepted lesson submits now write a `lesson.verified_completion_events` row.
- The event is keyed by the same UUID as the accepted lesson attempt.
- This gives the system an idempotent bridge from lesson completion to later Fuel / on-chain workers.

### Dev/testing support

- A dev-only `Reset Lesson Progress` action was added in the app so completed lessons can be replayed without switching wallets.

## Main Schema and API Changes

- `backend/sql/0003_auth_progress_hardening.sql`
- `backend/sql/0004_verified_completion_events.sql`
- `backend/openapi/lesson-api-v1.yaml`

## Main App and Backend Files

- `backend/src/modules/auth/routes.mjs`
- `backend/src/modules/auth/state.mjs`
- `backend/src/modules/content/repository.mjs`
- `backend/src/modules/progress/repository.mjs`
- `backend/src/modules/progress/routes.mjs`
- `src/screens/auth/WalletConnectScreen.tsx`
- `src/screens/main/LessonScreen.tsx`
- `src/screens/main/ProfileScreen.tsx`
- `src/services/api/types.ts`

## Verified Outcomes

- App reopen restores the wallet-backed session through `reauthorize`.
- Disconnect clears the backend/app session and returns to the connect flow.
- Lesson submit is rejected if backend verification fails.
- Accepted lesson submit creates a verified completion event row in Postgres.
- Duplicate lesson completions create separate attempt/event rows, ready for downstream deduped reward handling.

## Remaining Follow-up

- `subjective` answer validation still needs its dedicated validator path.
- Verified completion events still need their downstream worker/on-chain consumer.
