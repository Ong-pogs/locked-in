import './global.css';

import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fromByteArray } from 'base64-js';
import { AppNavigator } from '@/navigation';
import { DungeonProvider } from '@/components/DungeonProvider';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';
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

/** Reauthorize the cached MWA session on app launch. */
function useAutoReconnect() {
  const walletAuthToken = useUserStore((s) => s.walletAuthToken);
  const walletAddress = useUserStore((s) => s.walletAddress);
  const setWallet = useUserStore((s) => s.setWallet);
  const disconnect = useUserStore((s) => s.disconnect);

  useEffect(() => {
    if (!walletAuthToken || !walletAddress) {
      return;
    }

    reconnectWallet(walletAuthToken)
      .then((session) => {
        setWallet(session.publicKey, session.authToken);
      })
      .catch(() => {
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

    const attemptKey = `${walletAddress}:${walletAuthToken}`;
    if (attemptedKeyRef.current === attemptKey) return;
    attemptedKeyRef.current = attemptKey;

    const bootstrapWithWalletSignature = () =>
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
            console.warn(
              '[lesson-api] backend auth bootstrap failed; backend sync disabled until reconnect',
              error,
            );
          }
          setAuthSession(null, null);
        });

    if (refreshToken) {
      refreshAuthSession({ refreshToken })
        .then((session) => {
          setAuthSession(session.accessToken, session.refreshToken);
        })
        .catch((error) => {
          if (__DEV__) {
            console.warn('[lesson-api] startup refresh failed; retrying wallet challenge', error);
          }
          void bootstrapWithWalletSignature();
        });
      return;
    }

    if (__DEV__) {
      console.info('[lesson-api] missing refresh token; bootstrapping backend auth challenge');
    }

    void bootstrapWithWalletSignature();
  }, [walletAddress, walletAuthToken, refreshToken, setAuthSession]);
}

function useWalletScopedCourseState() {
  const walletAddress = useUserStore((s) => s.walletAddress);
  const bindToWallet = useCourseStore((s) => s.bindToWallet);

  useEffect(() => {
    bindToWallet(walletAddress);
  }, [bindToWallet, walletAddress]);
}

export default function App() {
  useAutoReconnect();
  useBackendSessionBootstrap();
  useWalletScopedCourseState();

  return (
    <AnimatedSplash>
      <SafeAreaProvider>
        <NavigationContainer theme={theme}>
          <DungeonProvider>
            <AppNavigator />
          </DungeonProvider>
          <StatusBar style="light" />
        </NavigationContainer>
      </SafeAreaProvider>
    </AnimatedSplash>
  );
}
