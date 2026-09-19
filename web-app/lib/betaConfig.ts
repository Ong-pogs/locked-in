const DEFAULT_GLOBAL_TVL_CAP_USDC = 1_000;

function readPositiveNumber(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('NEXT_PUBLIC_GLOBAL_TVL_CAP_USDC must be a positive number.');
  }
  return parsed;
}

// Public launch copy and the deposit capacity meter must describe the same cap.
// The fallback is the deployed capped-beta value; the release harness injects
// the machine-readable production value and the live canary verifies it.
export const BETA_GLOBAL_TVL_CAP_USDC = readPositiveNumber(
  process.env.NEXT_PUBLIC_GLOBAL_TVL_CAP_USDC,
  DEFAULT_GLOBAL_TVL_CAP_USDC,
);
