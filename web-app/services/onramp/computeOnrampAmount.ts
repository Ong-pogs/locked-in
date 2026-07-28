/**
 * USDC amount to prefill in the funding modal for a given shortfall.
 *
 * Buffer (max of +$2 / +10%) guards provider minimums, rounding, and fee
 * treatment differences between providers; the $10 floor keeps re-offer
 * top-ups from being purchases where fixed card fees (~$4) rival the value
 * received. Deficit ≤ 0 is a caller bug — the Add-funds button must never
 * render without a real shortfall, so throwing beats silently prefilling
 * a card purchase from garbage input.
 */
export function computeOnrampAmount(deficitUsdc: number): number {
  if (!Number.isFinite(deficitUsdc) || deficitUsdc <= 0) {
    throw new Error(
      `computeOnrampAmount: deficit must be a positive finite number, got ${deficitUsdc}`,
    );
  }
  // Round to cents before ceiling: 50 * 1.1 is 55.000000000000007 in floats,
  // and ceiling that would charge $56 for a $55 target.
  const buffered = Math.round(Math.max(deficitUsdc + 2, deficitUsdc * 1.1) * 100) / 100;
  return Math.max(10, Math.ceil(buffered));
}
