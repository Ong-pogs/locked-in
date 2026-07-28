// Funding breadcrumb — the double-card-charge guard for the fiat onramp.
//
// A card purchase runs in a Privy-hosted modal whose provider leg (MoonPay /
// 3DS) can outlive this page: on iOS standalone PWA the app is routinely
// killed during the Safari handoff, erasing all React state. Card settlement
// then takes minutes-to-tens-of-minutes to land as USDC. Without a persisted
// record that a purchase was initiated, the deposit screen would happily
// re-offer "Add funds" for the full deficit while the first purchase is still
// in transit — and a confused user double-charges their card. Same rationale
// as services/enroll/pendingEnroll.ts, which plays this role for deposits.
//
// Storage failures are swallowed everywhere: the breadcrumb is a guard rail,
// never a gate — a private-mode browser must not lose the ability to fund.

export const FUNDING_BREADCRUMB_KEY = 'locked-in-funding-breadcrumb';

/** Past this age a purchase either landed or died at the provider — stop
 *  warning and let the user buy again. */
const BREADCRUMB_TTL_MS = 30 * 60_000;

export interface FundingBreadcrumb {
  address: string;
  amountUsdc: number;
  initiatedAt: string; // ISO
}

export function writeFundingBreadcrumb(input: { address: string; amountUsdc: number }): void {
  try {
    const record: FundingBreadcrumb = { ...input, initiatedAt: new Date().toISOString() };
    window.localStorage.setItem(FUNDING_BREADCRUMB_KEY, JSON.stringify(record));
  } catch {
    // Storage full/blocked — proceed without the guard rail.
  }
}

export function readFundingBreadcrumb(): FundingBreadcrumb | null {
  try {
    const raw = window.localStorage.getItem(FUNDING_BREADCRUMB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FundingBreadcrumb>;
    if (
      typeof parsed.address !== 'string' ||
      typeof parsed.amountUsdc !== 'number' ||
      typeof parsed.initiatedAt !== 'string'
    ) {
      return null;
    }
    const age = Date.now() - new Date(parsed.initiatedAt).getTime();
    if (!Number.isFinite(age) || age > BREADCRUMB_TTL_MS) return null;
    return parsed as FundingBreadcrumb;
  } catch {
    return null;
  }
}

export function clearFundingBreadcrumb(): void {
  try {
    window.localStorage.removeItem(FUNDING_BREADCRUMB_KEY);
  } catch {
    // Nothing to do — reads fail soft anyway.
  }
}
