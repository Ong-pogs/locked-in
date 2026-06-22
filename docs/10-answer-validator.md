# Subjective Answer Validation Spec (v5.0)

## Scope

This validator grades open-ended lesson answers and decides whether a completion can be accepted by the progress pipeline.

It is off-chain and feeds verified completion events.

## Supported Validation Modes

1. MCQ exact-match scoring
2. LLM scoring for every non-MCQ answer
3. fail-closed handling when LLM grading is unavailable

Default mode:

- MCQ answers are graded with deterministic exact matching
- `short_text` and future non-MCQ question types are graded by OpenAI Responses structured output
- model failures, missing API keys, timeouts, malformed output, empty answers, or blocking integrity flags return a rejected validator decision
- there is no rubric-only acceptance fallback for non-MCQ answers

Current implementation checkpoint:

- backend now uses LLM grading for all non-MCQ lesson questions
- rubric config is stored in `lesson.questions.metadata`
- LLM output is constrained to strict JSON schema before it is stored
- accepted subjective answers flow into the same verified completion pipeline
- rejected subjective answers do not create completion events or course-runtime progression
- validator decisions are stored in an audit table with:
  - criteria breakdown
  - feedback summary
  - validator version
  - decision hash
- the result screen can show backend feedback for subjective answers
- the server still enforces the configured acceptance threshold even if model output disagrees

## Required Request Context

Validator input must include:

- question id
- prompt text
- expected answer and/or rubric snapshot
- learner answer text
- acceptance threshold

## Required Output Shape

- `accepted: boolean`
- `score: 0..100`
- `criteria_breakdown[]`
- `feedback_summary`
- `confidence: 0..1`
- `validator_version`
- `decision_hash` (for auditability)

## Acceptance Policy

A submission is completion-eligible only when:

- `accepted == true`
- score meets course/question threshold
- no integrity flags are triggered

Accepted submission then flows into the same verified completion event pipeline used by objective question types.

## Integrity Controls

1. idempotency key per attempt
2. bounded retry policy
3. audit trail for prompt, rubric, decision, and version
4. abuse heuristics (copy/paste spam, impossible speed)
5. model timeout returns a rejected fail-closed decision

## Cost and Performance Controls

- keep output small with strict structured JSON
- throttle LLM calls for repeated near-identical answers
- asynchronous grading allowed with interim `pending` status

## User Experience Requirements

Feedback must be instructive, not binary.
At minimum, show:

- what was correct
- what key concept was missing
- how to improve next attempt

## On-chain Coupling Rule

Validator never writes on-chain directly.
Only verified completion events from backend workers may trigger Fuel/streak updates.
Fuel and streak are off-chain Postgres counters; the only on-chain action is custody (lock/unlock) in the `locked_in` program, which is never driven by the validator.
