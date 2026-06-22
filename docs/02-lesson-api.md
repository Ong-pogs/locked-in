# Lesson API and Verification Pipeline (v4.0)

## Scope

Lesson content and grading are off-chain.
Fuel and ichor rewards are credited only after verified completion events.

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

## Verification to Reward Bridge

After lesson submission is accepted:

1. Backend records one idempotent verified completion event keyed by attempt id.
2. Backend applies the off-chain reward to course runtime state: **+1 fuel**
   (capped at `fuel_cap`, default 7) and a **random 20-50 ichor** per accepted
   lesson completion.
3. Fuel feeds the fire/Brewer (see `03-fuel.md`); ichor is a pure in-game shop
   currency (see `04-tokenomics.md`). Neither is on-chain — both are Postgres
   counters on `lesson.user_course_runtime_state`.

Lesson completion never pushes an on-chain instruction. The only on-chain
program is `locked_in` custody (escrow + clock-gated unlock); it carries no
course policy, fuel, or ichor. Missed days penalize yield routing only, never
the lock window.

Canonical rule coupling:

- Fuel and ichor credit is never client-trusted.
- Fuel and ichor credit is never granted without a verified completion event.
- Duplicate submits cannot double-credit Fuel or ichor.

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
5. serve immutable snapshot to clients

Every release must be traceable by `releaseId` and publish timestamp.

## Storage

- Supabase/Postgres is the source of truth for content and progress.
- Row-level security enforces wallet-level data isolation for user progress tables.
- Release snapshots are optimized for read-heavy mobile delivery.
