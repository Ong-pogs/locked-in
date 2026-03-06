import './global.css';

import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fromByteArray } from 'base64-js';
import { AppNavigator } from '@/navigation';
import { DungeonProvider } from '@/components/DungeonProvider';
import { useUserStore } from '@/stores';
import { hasRemoteLessonApi } from '@/services/api';
import { issueBackendSession } from '@/services/api/auth/backendAuth';
import { refreshAuthSession } from '@/services/api/auth/authApi';
import { reconnectWallet, signAuthChallengeMessage } from '@/services/solana';

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0a0a0a',
    card: '#111111',
    border: '#222222',
    primary: '#a855f7',
  },
};

const ENABLE_WALLET_AUTO_REAUTHORIZE =
  process.env.EXPO_PUBLIC_ENABLE_WALLET_AUTO_REAUTHORIZE === '1';

/** Optional MWA reauthorize on app launch using cached wallet auth token. */
function useAutoReconnect() {
  const walletAuthToken = useUserStore((s) => s.walletAuthToken);
  const walletAddress = useUserStore((s) => s.walletAddress);
  const setWallet = useUserStore((s) => s.setWallet);
  const disconnect = useUserStore((s) => s.disconnect);

  useEffect(() => {
    if (!ENABLE_WALLET_AUTO_REAUTHORIZE) {
      if (__DEV__) {
        console.info('[wallet] auto reauthorize disabled');
      }
      return;
    }

    // Only attempt if we have a cached session
    if (!walletAuthToken || !walletAddress) return;

    reconnectWallet(walletAuthToken)
      .then((session) => {
        // Refresh the stored token (it may have rotated)
        setWallet(session.publicKey, session.authToken);
      })
      .catch(() => {
        // Token expired or invalid — send back to connect screen
        disconnect();
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Ensure backend session is valid early in app startup.
 * This prevents first auth-required action (e.g. lesson submit) from prompting wallet flow.
 */
function useBackendSessionBootstrap() {
  const walletAddress = useUserStore((s) => s.walletAddress);
  const walletAuthToken = useUserStore((s) => s.walletAuthToken);
  const authToken = useUserStore((s) => s.authToken);
  const refreshToken = useUserStore((s) => s.refreshToken);
  const setAuthSession = useUserStore((s) => s.setAuthSession);
  const attemptedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasRemoteLessonApi()) return;
    if (!walletAddress || !walletAuthToken) return;
    if (authToken) return;

    const attemptKey = `${walletAddress}:${walletAuthToken}:${refreshToken ?? 'no-refresh'}`;
    if (attemptedKeyRef.current === attemptKey) return;
    attemptedKeyRef.current = attemptKey;

    if (refreshToken) {
      refreshAuthSession({ refreshToken })
        .then((session) => {
          setAuthSession(session.accessToken, session.refreshToken);
        })
        .catch((error) => {
          if (__DEV__) {
            console.warn('[lesson-api] startup refresh failed; backend sync disabled until next auth', error);
          }
          setAuthSession(null, null);
        });
      return;
    }

    if (__DEV__) {
      console.info('[lesson-api] missing refresh token; bootstrapping backend auth challenge');
    }

    issueBackendSession(walletAddress, async (message) => {
      const signatureBytes = await signAuthChallengeMessage(
        walletAddress,
        message,
        walletAuthToken,
      );
      return fromByteArray(signatureBytes);
    })
      .then((session) => {
        if (!session) {
          setAuthSession(null, null);
          return;
        }
        setAuthSession(session.accessToken, session.refreshToken);
        if (__DEV__) {
          console.info('[lesson-api] backend auth bootstrap succeeded');
        }
      })
      .catch((error) => {
        if (__DEV__) {
          console.warn('[lesson-api] backend auth bootstrap failed; backend sync disabled until next auth', error);
        }
        setAuthSession(null, null);
      });
  }, [walletAddress, walletAuthToken, authToken, refreshToken, setAuthSession]);
}

export default function App() {
  useAutoReconnect();
  useBackendSessionBootstrap();

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme}>
        <DungeonProvider>
          <AppNavigator />
        </DungeonProvider>
        <StatusBar style="light" />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
