/**
 * Flow-guard routing decision, extracted from AppShell so it can be tested.
 *
 * This rule has caused two production bugs — first /arena bouncing to /village,
 * then /arena/[matchId] bouncing to /courses — because it lived inside an effect
 * with no test covering it. The logic is unchanged from AppShell; it is only
 * pure now, so a route rule can be asserted instead of clicked.
 *
 * Mirrors AppNavigator.tsx from the RN app:
 *   1. No wallet/JWT            → village
 *   2. phase 'auth'             → village
 *   3. phase 'onboarding' + lock → main routes (onboarding routes → courses)
 *   4. phase 'onboarding', no lock → onboarding routes only
 *   5. phase 'main'             → everything
 */

export type OnboardingPhase = 'auth' | 'onboarding' | 'gauntlet' | 'main';

export interface FlowGuardInput {
  pathname: string;
  walletAddress: string | null;
  isAuthenticated: boolean;
  phase: OnboardingPhase;
  hasActiveLock: boolean;
}

// Pages a new user can browse without a wallet. Must agree with proxy.ts, or
// the flow guard redirects a logged-out reader away from a page the edge just
// allowed.
export const PUBLIC_ROUTES = [
  '/courses',
  '/village',
  '/dashboard',
  '/shop',
  '/alchemy',
  '/community-pot',
  '/inventory',
  '/leaderboard',
  '/terms',
  '/privacy',
  '/risk',
  '/arena',
];

export const ONBOARDING_ROUTES = ['/courses', '/onboarding/deposit', '/onboarding/tutorial'];

/** True for /arena and anything beneath it, but not /arenaFoo. */
export function isArenaRoute(pathname: string): boolean {
  return pathname === '/arena' || pathname.startsWith('/arena/');
}

/** The invite landing renders for logged-out visitors — it is the growth loop. */
export function isArenaInvite(pathname: string): boolean {
  return pathname.startsWith('/arena/join/');
}

/**
 * Returns the path to redirect to, or null to stay put.
 */
export function flowGuardRedirect({
  pathname,
  walletAddress,
  isAuthenticated,
  phase,
  hasActiveLock,
}: FlowGuardInput): string | null {
  if (PUBLIC_ROUTES.includes(pathname)) return null;

  // Before the auth gates: an invite must render to someone with no account.
  if (isArenaInvite(pathname)) return null;

  // Gate 1 — no wallet/JWT.
  if (!walletAddress || !isAuthenticated) return '/village';

  // Gate 2 — still at the auth step.
  if (phase === 'auth') return '/village';

  // The Arena needs a signed-in user but NEVER an active lock. Entry now
  // requires a stake, but that gate belongs to the API — a player without one
  // must still REACH the page, because staking is what it offers them. Sitting
  // above the lock gates is the whole point — otherwise a player who has not
  // locked into a course gets thrown to /courses the instant a match starts.
  if (isArenaRoute(pathname)) return null;

  // Gate 3 — onboarding WITH an active lock: main routes are fine, but the
  // onboarding routes themselves send you on to courses.
  if (phase === 'onboarding' && hasActiveLock) {
    if (pathname.startsWith('/onboarding/deposit')) return null;
    if (ONBOARDING_ROUTES.includes(pathname)) return '/courses';
    return null;
  }

  // Gate 4 — onboarding, no lock: onboarding routes only.
  if (phase === 'onboarding') {
    const isOnboardingRoute = ONBOARDING_ROUTES.some((r) => pathname.startsWith(r));
    return isOnboardingRoute ? null : '/courses';
  }

  // Gate 5 — phase 'main': everything allowed.
  return null;
}
