# Lesson API and Verification Pipeline (v3.0)

## Scope

Lesson content and grading are off-chain.
Fuel and on-chain consequences are triggered only after verified completion events.

## Canonical API Responsibilities

1. Serve published course/module/lesson content.
2. Authenticate users by wallet signature challenge.
3. Record lesson attempts and completion scores.
4. Emit verified completion events for reward/consequence processing.

## Canonical Public and Auth Endpoints

Public content endpoints:

- `GET /v1/content/version`
- `GET /v1/courses`
- `GET /v1/courses/:courseId/modules`
- `GET /v1/modules/:moduleId/lessons`
- `GET /v1/lessons/:lessonId`

Auth endpoints:

- `POST /v1/auth/challenge`
- `POST /v1/auth/verify`
- `POST /v1/auth/refresh`

Progress endpoints (bearer auth):

- `POST /v1/progress/lessons/:lessonId/start`
- `POST /v1/progress/lessons/:lessonId/submit`
- `GET /v1/progress/courses/:courseId`
- `GET /v1/progress/modules/:moduleId`

## Data Model

Canonical structure:

- `course -> module -> lesson -> blocks -> questions`

Question types supported:

- `mcq`
- `short_text`
- `subjective` (graded by validator service)

Each published lesson payload includes:

- `releaseId`
- `version`
- immutable content hash
- no client-visible answer key in public payloads

Canonical attempt flow:

1. client creates a per-attempt UUID
2. client calls `POST /v1/progress/lessons/:lessonId/start` with that attempt id
3. client calls `POST /v1/progress/lessons/:lessonId/submit` with the same attempt id plus raw answers
4. backend grades answers server-side and records a single immutable attempt row

## Verification to On-chain Bridge

After lesson submission is accepted:

1. Backend computes reward eligibility (daily cap, gauntlet status, saver recovery state).
2. Backend emits a signed, idempotent completion event.
3. Authorized worker submits the corresponding on-chain instruction to update course lock state.

Current implementation checkpoint:

- accepted lesson submit now writes one verified completion event record keyed by attempt id
- downstream worker consumption remains the next step

Canonical rule coupling:

- Fuel credit is never client-trusted.
- Fuel credit is never granted without a verified completion event.
- Duplicate submits cannot double-credit Fuel.

## Anti-abuse and Integrity

Required controls:

- per-attempt idempotency keys
- replay-safe challenge signatures
- score bounds validation (0-100)
- immutable attempt log
- rate limiting on submit endpoints
- anomaly detection for impossible completion velocity

## Content Pipeline

Editorial flow:

1. ingest official source material
2. normalize into internal lesson schema
3. review and approval
4. publish release snapshot
5. serve immutable snapshot to mobile clients

Every release must be traceable by `releaseId` and publish timestamp.

## Storage

- Supabase/Postgres is the source of truth for content and progress.
- Row-level security enforces wallet-level data isolation for user progress tables.
- Release snapshots are optimized for read-heavy mobile delivery.
