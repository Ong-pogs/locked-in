import { describe, it, expect } from 'vitest';
import { flowGuardRedirect, isArenaRoute } from '../../lib/flowGuard';

const signedIn = {
  walletAddress: 'Wa11et1111111111111111111111111111111111',
  isAuthenticated: true,
  phase: 'onboarding' as const,
  hasActiveLock: false,
};

const MATCH = '/arena/342883f5-cc14-4f5f-8a9e-f0bf382139fc';

describe('isArenaRoute', () => {
  it('matches the hub and anything beneath it', () => {
    expect(isArenaRoute('/arena')).toBe(true);
    expect(isArenaRoute(MATCH)).toBe(true);
    expect(isArenaRoute('/arena/join/KJ4MAWC6')).toBe(true);
  });

  it('does not match a route that merely starts with the same letters', () => {
    expect(isArenaRoute('/arenaFoo')).toBe(false);
    expect(isArenaRoute('/arena-history')).toBe(false);
  });
});

describe('flow guard — the Arena never requires an active lock', () => {
  // The regression: a signed-in player with no lock clicked "Find an opponent",
  // got matched, and was thrown to /courses the instant the match page mounted.
  it('lets a signed-in player with NO lock onto a match page', () => {
    expect(flowGuardRedirect({ ...signedIn, pathname: MATCH })).toBeNull();
  });

  it('lets a signed-in player with no lock onto the arena hub', () => {
    expect(flowGuardRedirect({ ...signedIn, pathname: '/arena' })).toBeNull();
  });

  it('still lets a LOGGED-OUT visitor see an invite (the growth loop)', () => {
    expect(flowGuardRedirect({
      pathname: '/arena/join/KJ4MAWC6',
      walletAddress: null,
      isAuthenticated: false,
      phase: 'auth',
      hasActiveLock: false,
    })).toBeNull();
  });

  it('lets a fully onboarded player onto a match page', () => {
    expect(flowGuardRedirect({
      ...signedIn, phase: 'main', hasActiveLock: true, pathname: MATCH,
    })).toBeNull();
  });

  it('lets a player with an active lock onto a match page', () => {
    expect(flowGuardRedirect({
      ...signedIn, hasActiveLock: true, pathname: MATCH,
    })).toBeNull();
  });
});

describe('flow guard — auth gates still apply to match pages', () => {
  it('sends a logged-out visitor on a match page to the village', () => {
    expect(flowGuardRedirect({
      pathname: MATCH,
      walletAddress: null,
      isAuthenticated: false,
      phase: 'auth',
      hasActiveLock: false,
    })).toBe('/village');
  });

  it('sends a wallet-less but "authenticated" state to the village', () => {
    expect(flowGuardRedirect({
      ...signedIn, walletAddress: null, pathname: MATCH,
    })).toBe('/village');
  });

  it('sends phase "auth" to the village even when signed in', () => {
    expect(flowGuardRedirect({
      ...signedIn, phase: 'auth', pathname: MATCH,
    })).toBe('/village');
  });
});

describe('flow guard — existing behaviour is unchanged', () => {
  it('still forces an unlocked onboarding user off a main route', () => {
    expect(flowGuardRedirect({ ...signedIn, pathname: '/lessons/sw-1' })).toBe('/courses');
  });

  it('still allows onboarding routes during onboarding', () => {
    expect(flowGuardRedirect({ ...signedIn, pathname: '/onboarding/deposit' })).toBeNull();
  });

  it('still sends an onboarding route to courses once a lock exists', () => {
    // /courses itself can never reach this gate — it is in PUBLIC_ROUTES, which
    // returns first. /onboarding/tutorial is the only route the rule can act on.
    expect(flowGuardRedirect({
      ...signedIn, hasActiveLock: true, pathname: '/onboarding/tutorial',
    })).toBe('/courses');
  });

  it('still allows the deposit page with an active lock', () => {
    expect(flowGuardRedirect({
      ...signedIn, hasActiveLock: true, pathname: '/onboarding/deposit',
    })).toBeNull();
  });

  it('still lets a logged-out reader see the public legal pages', () => {
    for (const p of ['/terms', '/privacy', '/risk', '/village', '/courses']) {
      expect(flowGuardRedirect({
        pathname: p, walletAddress: null, isAuthenticated: false,
        phase: 'auth', hasActiveLock: false,
      })).toBeNull();
    }
  });

  it('allows everything once phase is main', () => {
    for (const p of ['/lessons/sw-1', '/claim/swaps-and-dexs', MATCH]) {
      expect(flowGuardRedirect({
        ...signedIn, phase: 'main', hasActiveLock: true, pathname: p,
      })).toBeNull();
    }
  });
});
