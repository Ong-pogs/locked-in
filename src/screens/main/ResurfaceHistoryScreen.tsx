import { ScrollView, View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { MainStackParamList } from '@/navigation/types';
import { ApiError, getUnlockReceipts } from '@/services/api';
import { refreshAuthSession } from '@/services/api/auth/authApi';
import { useResurfaceStore, useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';

type Nav = NativeStackNavigationProp<MainStackParamList>;
type HistoryRoute = RouteProp<MainStackParamList, 'ResurfaceHistory'>;

export function ResurfaceHistoryScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<HistoryRoute>();
  const walletAddress = useUserStore((s) => s.walletAddress);
  const authToken = useUserStore((s) => s.authToken);
  const refreshToken = useUserStore((s) => s.refreshToken);
  const setAuthSession = useUserStore((s) => s.setAuthSession);
  const courses = useCourseStore((s) => s.courses);
  const hydrateReceipts = useResurfaceStore((s) => s.hydrateReceipts);
  const receipts = useResurfaceStore((s) => s.getReceiptsForWallet(walletAddress));
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshBackendAccessToken = useCallback(async () => {
    if (!refreshToken) {
      throw new Error('Connect your wallet again to read resurface receipts.');
    }

    const refreshed = await refreshAuthSession({ refreshToken });
    setAuthSession(refreshed.accessToken, refreshed.refreshToken);
    return refreshed.accessToken;
  }, [refreshToken, setAuthSession]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const loadReceipts = async () => {
        setLoading(true);
        let backendAccessToken = authToken;

        if (!backendAccessToken && refreshToken) {
          try {
            backendAccessToken = await refreshBackendAccessToken();
          } catch (error) {
            if (!active) return;
            setErrorMessage(
              error instanceof Error
                ? error.message
                : 'Connect your wallet again to read resurface receipts.',
            );
            setLoading(false);
            return;
          }
        }

        if (!backendAccessToken) {
          if (!active) return;
          setErrorMessage('Connect your wallet again to read resurface receipts.');
          setLoading(false);
          return;
        }

        try {
          const response = await getUnlockReceipts(backendAccessToken);
          if (!active) return;
          hydrateReceipts(
            response.receipts.map((receipt) => ({
              id: receipt.unlockTxSignature,
              walletAddress: receipt.walletAddress,
              courseId: receipt.courseId,
              courseTitle:
                courses.find((course) => course.id === receipt.courseId)?.title ?? receipt.courseId,
              lockAccountAddress: receipt.lockAccountAddress,
              principalAmountUi: receipt.principalAmountUi,
              skrLockedAmountUi: receipt.skrLockedAmountUi,
              unlockedAt: receipt.unlockedAt,
              unlockTxSignature: receipt.unlockTxSignature,
              lockEndDate: receipt.lockEndAt,
              verifiedBlockTime: receipt.verifiedBlockTime,
              source: 'backend',
            })),
          );
          setErrorMessage(null);
          setLoading(false);
        } catch (error) {
          if (
            error instanceof ApiError &&
            (error.code === 'TOKEN_EXPIRED' || error.status === 401) &&
            refreshToken
          ) {
            try {
              const refreshedToken = await refreshBackendAccessToken();
              const retried = await getUnlockReceipts(refreshedToken);
              if (!active) return;
              hydrateReceipts(
                retried.receipts.map((receipt) => ({
                  id: receipt.unlockTxSignature,
                  walletAddress: receipt.walletAddress,
                  courseId: receipt.courseId,
                  courseTitle:
                    courses.find((course) => course.id === receipt.courseId)?.title ??
                    receipt.courseId,
                  lockAccountAddress: receipt.lockAccountAddress,
                  principalAmountUi: receipt.principalAmountUi,
                  skrLockedAmountUi: receipt.skrLockedAmountUi,
                  unlockedAt: receipt.unlockedAt,
                  unlockTxSignature: receipt.unlockTxSignature,
                  lockEndDate: receipt.lockEndAt,
                  verifiedBlockTime: receipt.verifiedBlockTime,
                  source: 'backend',
                })),
              );
              setErrorMessage(null);
              setLoading(false);
              return;
            } catch (refreshError) {
              if (!active) return;
              setErrorMessage(
                refreshError instanceof Error
                  ? refreshError.message
                  : 'Unable to read resurface receipts.',
              );
              setLoading(false);
              return;
            }
          }

          if (!active) return;
          setErrorMessage(
            error instanceof Error ? error.message : 'Unable to read resurface receipts.',
          );
          setLoading(false);
        }
      };

      void loadReceipts();
      return () => {
        active = false;
      };
    }, [authToken, courses, hydrateReceipts, refreshBackendAccessToken, refreshToken]),
  );

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">Resurface Receipts</Text>
        <Text className="mt-1 text-sm text-neutral-500">
          Unlock confirmations and returned-funds history
        </Text>

        {loading ? (
          <View className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-5">
            <Text className="text-sm text-neutral-400">Loading resurface receipts...</Text>
          </View>
        ) : errorMessage ? (
          <View className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
            <Text className="text-xs text-amber-300">{errorMessage}</Text>
          </View>
        ) : receipts.length === 0 ? (
          <View className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-5">
            <Text className="text-sm text-neutral-400">No resurface receipts yet.</Text>
          </View>
        ) : (
          receipts.map((receipt) => {
            const isLatest = route.params?.receiptId === receipt.id;
            return (
              <View
                key={receipt.id}
                className={`mt-6 rounded-2xl border p-5 ${
                  isLatest
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-neutral-700 bg-neutral-900'
                }`}
              >
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg font-semibold text-white">{receipt.courseTitle}</Text>
                  <Text
                    className={`text-xs uppercase tracking-wide ${
                      isLatest ? 'text-emerald-300' : 'text-neutral-500'
                    }`}
                  >
                    {isLatest ? 'Latest' : 'Receipt'}
                  </Text>
                </View>
                <Text className="mt-3 text-sm text-neutral-300">
                  Principal returned: {receipt.principalAmountUi} USDC
                </Text>
                <Text className="mt-1 text-sm text-neutral-300">
                  SKR returned: {receipt.skrLockedAmountUi}
                </Text>
                <Text className="mt-1 text-sm text-neutral-300">
                  Unlock target: {new Date(receipt.lockEndDate).toLocaleString()}
                </Text>
                <Text className="mt-1 text-sm text-neutral-300">
                  Unlocked at: {new Date(receipt.unlockedAt).toLocaleString()}
                </Text>
                {receipt.verifiedBlockTime ? (
                  <Text className="mt-1 text-sm text-neutral-300">
                    Verified at: {new Date(receipt.verifiedBlockTime).toLocaleString()}
                  </Text>
                ) : null}
                <Text className="mt-3 text-xs text-neutral-500">
                  Lock account: {receipt.lockAccountAddress}
                </Text>
                <Text className="mt-1 text-xs text-neutral-500">
                  Tx: {receipt.unlockTxSignature}
                </Text>
                <Text className="mt-1 text-xs text-neutral-500">
                  Source: {receipt.source === 'backend' ? 'Backend verified' : 'Local pending sync'}
                </Text>
              </View>
            );
          })
        )}

        <Pressable
          className="mt-6 mb-8 rounded-xl bg-neutral-900 py-4 active:opacity-80"
          onPress={() => navigation.navigate('CourseBrowser')}
        >
          <Text className="text-center text-sm font-semibold text-neutral-300">
            Browse Courses
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
