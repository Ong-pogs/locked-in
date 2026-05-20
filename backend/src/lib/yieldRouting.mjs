// Pure yield-routing + fire-timer economics. Extracted here (no DB, no
// network) so the core invariants can be unit-tested deterministically.
//
// Routing model:
//   fire OUT  → 100% of a harvest's gross yield goes to the community pot
//   fire LIT  → split by saver tier: 0/10/15/20% to pot, the rest to user

const FULL_REDIRECT_BPS = 10_000;
const FIRE_HOURS_PER_FUEL = 24;

// Savers USED → yield-redirect basis points.
//   0 used (3 banked):  0% to pot
//   1 used (2 banked): 10%
//   2 used (1 banked): 15%
//   3 used (0 banked): 20%
export const SAVER_REDIRECT_BPS_BY_COUNT = {
  0: 0,
  1: 1000,
  2: 1500,
  3: 2000,
};

export function getSaverRedirectBps(saverCount) {
  return SAVER_REDIRECT_BPS_BY_COUNT[saverCount] ?? FULL_REDIRECT_BPS;
}

// Is the fire lit at `nowMs`? fireLitUntil may be a Date, ISO string,
// epoch ms, or null. Returns false for null/invalid/past.
export function isFireLit(fireLitUntil, nowMs = Date.now()) {
  if (fireLitUntil == null) return false;
  const litUntil =
    fireLitUntil instanceof Date ? fireLitUntil.getTime() : new Date(fireLitUntil).getTime();
  if (!Number.isFinite(litUntil)) return false;
  return litUntil > nowMs;
}

// How much of a harvest's gross yield routes to the community pot.
//   fire out  → all of it
//   fire lit  → gross × redirectBps / 10000 (floored, bigint-safe)
// Returns a base-unit string.
export function computeRedirectedAmount(grossYieldStr, fireLit, redirectBps) {
  const gross = BigInt(grossYieldStr);
  if (!fireLit) return gross.toString();
  const bps = BigInt(redirectBps ?? 0);
  if (bps <= 0n) return '0';
  return ((gross * bps) / 10_000n).toString();
}

// Feeding the fire extends the timer additively: if it's still lit, stack
// on top of the remaining time; if it's out (or never lit), start from
// now. Returns the next fire_lit_until as a Date.
export function computeNextFireLitUntil(
  currentFireLitUntil,
  now = new Date(),
  hoursToAdd = FIRE_HOURS_PER_FUEL,
) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const current =
    currentFireLitUntil == null
      ? null
      : currentFireLitUntil instanceof Date
        ? currentFireLitUntil.getTime()
        : new Date(currentFireLitUntil).getTime();
  const base = current != null && Number.isFinite(current) && current > nowMs ? current : nowMs;
  return new Date(base + hoursToAdd * 60 * 60 * 1000);
}
