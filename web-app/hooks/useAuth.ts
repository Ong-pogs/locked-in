'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, useSignMessage } from '@privy-io/react-auth/solana';
import { useUserStore, useCourseStore } from '@/stores';
import { createAuthChallenge, verifyAuthChallenge } from '@/services/api/auth/authApi';

// Cookie flag for proxy auth guard (server-side check)
function setAuthCookie(value: boolean) {
  if (value) {
    document.cookie = 'locked-in-auth=1; path=/; max-age=604800; samesite=lax';
  } else {
    document.cookie = 'locked-in-auth=; path=/; max-age=0';
  }
}

/**
 * Nuclear client-state wipe — deletes every cookie, localStorage entry, and
 * sessionStorage entry visible to JS. Preserves the `locked-in-tutorial-done`
 * cookie so returning users don't replay the tutorial.
 *
 * We go scorched-earth because narrower approaches (only `privy:*` keys,
 * only cookies containing "privy") didn't fully clear Privy's session —
 * Privy uses a mix of cookie names and storage locations that changes
 * between versions, and we can't afford to miss one.
 */
function wipeClientAuthState() {
  if (typeof window === 'undefined') return;
  try {
    const tutorialDoneBackup = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('locked-in-tutorial-done='));

    localStorage.clear();
    sessionStorage.clear();

    const hostname = window.location.hostname;
    const parentDomain = hostname.split('.').slice(-2).join('.');
    const expiry = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0].trim();
      if (!name) continue;
      document.cookie = `${name}=; ${expiry}; path=/`;
      document.cookie = `${name}=; ${expiry}; path=/; domain=${hostname}`;
      if (parentDomain !== hostname) {
        document.cookie = `${name}=; ${expiry}; path=/; domain=.${parentDomain}`;
      }
    }

    // Restore the tutorial flag so returning users don't re-see the tutorial
    if (tutorialDoneBackup) {
      document.cookie = `${tutorialDoneBackup}; path=/; max-age=31536000; samesite=lax`;
    }
  } catch {
    // ignore — best-effort cleanup
  }
}

/**
 * Auth hook — uses Privy for wallet management, our backend for JWT.
 *
 * Flow: Privy login (Google or wallet) → get Solana wallet → challenge-sign-verify → JWT
 *
 * Backend doesn't know about Privy. It just sees an Ed25519 signature.
 */
export function useAuth() {
  const { ready: privyReady, authenticated: privyAuthenticated, logout: privyLogout, user: privyUser } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signMessage } = useSignMessage();
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInProgress, setAuthInProgress] = useState(false);

  // Track if Privy was ever authenticated this session — skip cleanup until first auth
  const privyWasAuthenticatedRef = useRef(false);

  useEffect(() => {
    if (privyAuthenticated) {
      privyWasAuthenticatedRef.current = true;
    }
  }, [privyAuthenticated]);

  const walletAddress = useUserStore((s) => s.walletAddress);
  const accessToken = useUserStore((s) => s.authToken);
  const setWallet = useUserStore((s) => s.setWallet);
  const setAuthSession = useUserStore((s) => s.setAuthSession);
  const disconnectUser = useUserStore((s) => s.disconnect);

  // Detect embedded (Privy) wallet — the Solana hook uses standardWallet, not walletClientType.
  const isEmbedded = (w: (typeof wallets)[number]) =>
    'isPrivyWallet' in w.standardWallet && !!(w.standardWallet as Record<string, unknown>).isPrivyWallet;

  // Google login → embedded wallet ONLY (auto-signs via Privy UI, no Phantom popup).
  //   If not ready yet, solanaWallet stays null — auth effect waits until it appears.
  // Wallet login → prefer external wallet (the one the user connected).
  const isGoogleUser = !!privyUser?.google;
  const embeddedWallet = wallets.find(isEmbedded) ?? null;
  const externalWallet = wallets.find((w) => !isEmbedded(w)) ?? null;
  // Google → wait for embedded wallet only.
  // Wallet → wait for external wallet only.
  // Both avoid falling back to the wrong wallet type.
  const solanaWallet = isGoogleUser ? embeddedWallet : externalWallet;
  const connectedAddress = solanaWallet?.address ?? null;

  // Authenticate with our backend using the Privy-managed wallet
  const authenticate = useCallback(async () => {
    if (!solanaWallet) {
      setAuthError('No Solana wallet available. Please try again.');
      return;
    }

    setAuthError(null);
    setAuthInProgress(true);

    try {
      const address = solanaWallet.address;

      // 1. Request challenge from backend
      const challenge = await createAuthChallenge({ walletAddress: address });

      // 2. Sign the challenge message using Privy wallet
      const messageBytes = new TextEncoder().encode(challenge.message);
      const result = await signMessage({
        message: messageBytes,
        wallet: solanaWallet,
      });

      // 3. Convert signature to base64 for backend verification
      const signature = btoa(
        String.fromCharCode(...result.signature),
      );

      // 4. Verify with backend to get JWT
      const authSession = await verifyAuthChallenge({
        walletAddress: address,
        challengeId: challenge.challengeId,
        signature,
      });

      // 5. Store in Zustand (persisted to localStorage)
      setWallet(address);
      useCourseStore.getState().bindToWallet(address);
      setAuthSession(authSession.accessToken, authSession.refreshToken);
      setAuthCookie(true);
    } catch (error) {
      console.error('[auth] Authentication failed:', error);
      const message = error instanceof Error ? error.message : 'Authentication failed';
      setAuthError(message);
    } finally {
      setAuthInProgress(false);
    }
  }, [solanaWallet, signMessage, setWallet, setAuthSession]);

  // Keep the proxy auth cookie in sync with the Zustand JWT.
  // Without this, an expired/cleared cookie + still-valid JWT in localStorage
  // wedges the user on '/' because the proxy bounces every other route, while
  // the sidebar still renders (driven by isAuthenticated). The cookie is the
  // server-side source of truth, but Zustand is the client-side one — they
  // must match.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const hasCookie = document.cookie.includes('locked-in-auth=1');
    if (accessToken && !hasCookie) {
      setAuthCookie(true);
    } else if (!accessToken && hasCookie) {
      setAuthCookie(false);
    }
  }, [accessToken]);

  // Track whether user just logged in this session (not a page reload)
  // Backed by sessionStorage so it survives page reloads within the same tab
  const [freshLogin, setFreshLoginState] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('locked-in-fresh-login') === '1';
  });
  const setFreshLogin = useCallback((v: boolean) => {
    setFreshLoginState(v);
    if (v) sessionStorage.setItem('locked-in-fresh-login', '1');
    else sessionStorage.removeItem('locked-in-fresh-login');
  }, []);

  // Guard ref prevents the effect from firing multiple times when wallets array updates
  const authGuardRef = useRef(false);

  // Only auto-authenticate after a FRESH login (user clicked sign-in), not on page reload
  useEffect(() => {
    if (
      freshLogin &&
      !authGuardRef.current &&
      privyAuthenticated &&
      walletsReady &&
      solanaWallet &&
      !accessToken &&
      !authInProgress &&
      !authError
    ) {
      authGuardRef.current = true;
      setFreshLogin(false);
      authenticate();
    }
  }, [freshLogin, privyAuthenticated, walletsReady, solanaWallet, accessToken, authInProgress, authError, authenticate, setFreshLogin]);

  // Manual retry — called from UI
  const retry = useCallback(() => {
    authGuardRef.current = false;
    setAuthError(null);
    authenticate();
  }, [authenticate]);

  // Disconnect — clears Privy + all app state and reloads the page.
  // Note: Privy's session cookies live on auth.privy.io (cross-origin).
  // We can't clear those from JS — only Privy's own logout() can invalidate
  // them server-side. If the session somehow survives, we detect that
  // on the next Sign In click via `ensureFreshSession` below.
  const handleDisconnect = useCallback(async () => {
    await privyLogout();
    await new Promise((r) => setTimeout(r, 800));
    disconnectUser();
    useCourseStore.getState().reset();
    setAuthCookie(false);
    setAuthError(null);
    wipeClientAuthState();
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, [privyLogout, disconnectUser]);

  // Cleanup: if Privy logs out externally (session expiry, etc.), clear
  // our state the same way a manual disconnect does.
  useEffect(() => {
    if (privyReady && !privyAuthenticated && walletAddress && privyWasAuthenticatedRef.current) {
      disconnectUser();
      useCourseStore.getState().reset();
      setAuthCookie(false);
      wipeClientAuthState();
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }
  }, [privyReady, privyAuthenticated, walletAddress, disconnectUser]);


  // Called by WalletConnect after user deliberately clicks sign-in
  const markFreshLogin = useCallback(() => {
    authGuardRef.current = false;
    setFreshLogin(true);
  }, [setFreshLogin]);

  // If Privy still considers the user authenticated (stale cross-origin
  // session that survived our last disconnect), log out first so the
  // next `login()` call opens the wallet-selection modal instead of
  // throwing "already logged in" and auto-signing with the old wallet.
  // Call this BEFORE `login()` whenever you're about to prompt sign-in.
  const ensureFreshSession = useCallback(async () => {
    if (!privyAuthenticated) return;
    await privyLogout();
    await new Promise((r) => setTimeout(r, 500));
  }, [privyAuthenticated, privyLogout]);

  return {
    isReady: privyReady && walletsReady,
    isConnected: privyAuthenticated && !!connectedAddress,
    isAuthenticated: !!accessToken,
    walletAddress: connectedAddress,
    authError,
    authInProgress,
    loginMethod: privyUser?.google ? 'google' as const : privyAuthenticated ? 'wallet' as const : null,
    authenticate,
    markFreshLogin,
    ensureFreshSession,
    retry,
    disconnect: handleDisconnect,
  };
}
