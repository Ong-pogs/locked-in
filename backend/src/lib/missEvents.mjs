// Canonical miss-event id (2026-07-10 rulings, enroll R16 / practice R16).
//
// EVERY producer of a miss-day consequence — the legacy runtime scheduler,
// the submit-time catch-up loop, the daily lapse sweep, and the internal
// consequences endpoint — must derive its miss_event_id here so the
// (wallet, course, miss_day) unique index and the id-keyed receipt lookup
// agree about what "the same miss" is. Never hand-roll this string.

export function autoMissEventId(walletAddress, courseId, missDay) {
  return `auto-miss:${walletAddress}:${courseId}:${missDay}`;
}
