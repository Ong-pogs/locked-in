// Claim receipt persisted by the claim page on success (sessionStorage).
// Shared: the claim page writes + renders it; the dashboard's Claimed tab
// reads it to show what the close actually paid out. Session-scoped by
// design — the on-chain truth is the tx itself, this is just a nicety.

export interface ClaimSuccessRecord {
  signature: string;
  principalUi: string | null;
  receivedUi: string | null;
  bps: number;
  lapseCount: number;
  claimedAt: string;
}

export const claimSuccessKey = (courseId: string) => `locked-in-claim-success:${courseId}`;

export function readClaimSuccessRecord(courseId: string): ClaimSuccessRecord | null {
  try {
    const raw = sessionStorage.getItem(claimSuccessKey(courseId));
    return raw ? (JSON.parse(raw) as ClaimSuccessRecord) : null;
  } catch {
    return null;
  }
}
