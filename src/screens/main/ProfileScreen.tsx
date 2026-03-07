import { useCallback, useState } from 'react';
import { Alert, ActivityIndicator, View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '@/navigation/types';
import {
  ApiError,
  createUnlockReceipt,
} from '@/services/api';
import { refreshAuthSession } from '@/services/api/auth/authApi';
import {
  buildUnlockFundsTransaction,
  connection,
  disconnectWallet,
  fetchLockAccountSnapshot,
  hasLockVaultConfig,
  signTransaction,
  type LockAccountSnapshot,
} from '@/services/solana';
import { useResurfaceStore, useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';

type Nav = NativeStackNavigationProp<MainStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();

  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const setActiveCourse = useCourseStore((s) => s.setActiveCourse);
  const deactivateCourse = useCourseStore((s) => s.deactivateCourse);
  const refreshCourseRuntime = useCourseStore((s) => s.refreshCourseRuntime);
  const syncLockSnapshot = useCourseStore((s) => s.syncLockSnapshot);
  const resetLessonProgressForCourse = useCourseStore(
    (s) => s.resetLessonProgressForCourse,
  );

  const lockedCourseIds = activeCourseIds.filter((courseId) =>
    Boolean(courseStates[courseId]?.lockAccountAddress),
  );
  const activeState = activeCourseId ? courseStates[activeCourseId] : null;
  const activeLockAccountAddress = activeState?.lockAccountAddress ?? null;
  const activeCourse = activeCourseId
    ? courses.find((c) => c.id === activeCourseId)
    : null;
  const walletAddress = useUserStore((s) => s.walletAddress);
  const authToken = useUserStore((s) => s.authToken);
  const refreshToken = useUserStore((s) => s.refreshToken);
  const setAuthSession = useUserStore((s) => s.setAuthSession);
  const walletAuthToken = useUserStore((s) => s.walletAuthToken);
  const disconnect = useUserStore((s) => s.disconnect);
  const addResurfaceReceipt = useResurfaceStore((s) => s.addReceipt);
  const [lockSnapshot, setLockSnapshot] = useState<LockAccountSnapshot | null>(null);
  const [isLoadingLock, setIsLoadingLock] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockStatusMessage, setUnlockStatusMessage] = useState<string | null>(null);

  const refreshBackendAccessToken = useCallback(async () => {
    if (!refreshToken) {
      throw new Error('Connect your wallet again before syncing the unlock receipt.');
    }

    const refreshed = await refreshAuthSession({ refreshToken });
    setAuthSession(refreshed.accessToken, refreshed.refreshToken);
    return refreshed.accessToken;
  }, [refreshToken, setAuthSession]);

  const streak = activeState?.currentStreak ?? 0;
  const ichor = activeState?.ichorBalance ?? 0;
  const fuel = activeState?.fuelCounter ?? 0;
  const fuelCap = activeState?.fuelCap ?? 7;
  const saverCount = activeState?.saverCount ?? 0;

  useFocusEffect(
    useCallback(() => {
      if (activeCourseId && authToken) {
        void refreshCourseRuntime(activeCourseId, authToken).catch(() => {
          // Keep last synced runtime visible if refresh fails.
        });
      }

      if (
        activeCourseId &&
        walletAddress &&
        activeLockAccountAddress &&
        hasLockVaultConfig()
      ) {
        setIsLoadingLock(true);
        void fetchLockAccountSnapshot({
          ownerAddress: walletAddress,
          courseId: activeCourseId,
        })
          .then((snapshot) => {
            setUnlockStatusMessage(null);
            syncLockSnapshot(activeCourseId, snapshot);
            setLockSnapshot(snapshot);
          })
          .catch((error) => {
            const message =
              error instanceof Error ? error.message : 'Unable to read live lock state.';
            setUnlockStatusMessage(message);
            setLockSnapshot(null);
          })
          .finally(() => {
            setIsLoadingLock(false);
          });
      } else {
        setIsLoadingLock(false);
        setLockSnapshot(null);
      }
    }, [
      activeCourseId,
      activeLockAccountAddress,
      authToken,
      refreshCourseRuntime,
      syncLockSnapshot,
      walletAddress,
    ]),
  );

  const handleUnlock = async () => {
    if (!activeCourseId || !walletAddress || !walletAuthToken) {
      setUnlockStatusMessage('Connect your wallet again before resurfacing.');
      return;
    }

    try {
      setIsUnlocking(true);
      setUnlockStatusMessage('Building unlock transaction...');

      const buildResult = await buildUnlockFundsTransaction({
        ownerAddress: walletAddress,
        courseId: activeCourseId,
      });

      setUnlockStatusMessage('Requesting wallet approval...');
      const signedTransaction = await signTransaction(
        walletAddress,
        buildResult.transaction,
        walletAuthToken,
      );

      setUnlockStatusMessage('Submitting transaction...');
      const rawTransaction = signedTransaction.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed',
      });

      setUnlockStatusMessage('Confirming unlock on-chain...');
      await connection.confirmTransaction(signature, 'confirmed');

      const unlockedAt = new Date().toISOString();

      if (lockSnapshot && walletAddress && activeCourseId) {
        const localReceipt = {
          id: signature,
          walletAddress,
          courseId: activeCourseId,
          courseTitle: activeCourse?.title ?? activeCourseId,
          lockAccountAddress: lockSnapshot.lockAccountAddress,
          principalAmountUi: lockSnapshot.principalAmountUi,
          skrLockedAmountUi: lockSnapshot.skrLockedAmountUi,
          unlockedAt,
          unlockTxSignature: signature,
          lockEndDate: lockSnapshot.lockEndDate,
          source: 'local' as const,
        };
        addResurfaceReceipt(localReceipt);

        let backendAccessToken = authToken;
        if (!backendAccessToken && refreshToken) {
          try {
            backendAccessToken = await refreshBackendAccessToken();
          } catch {
            backendAccessToken = null;
          }
        }

        if (backendAccessToken) {
          try {
            const receipt = await createUnlockReceipt(
              {
                courseId: activeCourseId,
                lockAccountAddress: lockSnapshot.lockAccountAddress,
                principalAmountUi: lockSnapshot.principalAmountUi,
                skrLockedAmountUi: lockSnapshot.skrLockedAmountUi,
                lockEndDate: lockSnapshot.lockEndDate,
                unlockedAt,
                unlockTxSignature: signature,
              },
              backendAccessToken,
            );
            addResurfaceReceipt({
              id: receipt.unlockTxSignature,
              walletAddress: receipt.walletAddress,
              courseId: receipt.courseId,
              courseTitle: activeCourse?.title ?? receipt.courseId,
              lockAccountAddress: receipt.lockAccountAddress,
              principalAmountUi: receipt.principalAmountUi,
              skrLockedAmountUi: receipt.skrLockedAmountUi,
              unlockedAt: receipt.unlockedAt,
              unlockTxSignature: receipt.unlockTxSignature,
              lockEndDate: receipt.lockEndAt,
              verifiedBlockTime: receipt.verifiedBlockTime,
              source: 'backend',
            });
          } catch (error) {
            if (
              error instanceof ApiError &&
              (error.code === 'TOKEN_EXPIRED' || error.status === 401) &&
              refreshToken
            ) {
              try {
                const refreshedToken = await refreshBackendAccessToken();
                const receipt = await createUnlockReceipt(
                  {
                    courseId: activeCourseId,
                    lockAccountAddress: lockSnapshot.lockAccountAddress,
                    principalAmountUi: lockSnapshot.principalAmountUi,
                    skrLockedAmountUi: lockSnapshot.skrLockedAmountUi,
                    lockEndDate: lockSnapshot.lockEndDate,
                    unlockedAt,
                    unlockTxSignature: signature,
                  },
                  refreshedToken,
                );
                addResurfaceReceipt({
                  id: receipt.unlockTxSignature,
                  walletAddress: receipt.walletAddress,
                  courseId: receipt.courseId,
                  courseTitle: activeCourse?.title ?? receipt.courseId,
                  lockAccountAddress: receipt.lockAccountAddress,
                  principalAmountUi: receipt.principalAmountUi,
                  skrLockedAmountUi: receipt.skrLockedAmountUi,
                  unlockedAt: receipt.unlockedAt,
                  unlockTxSignature: receipt.unlockTxSignature,
                  lockEndDate: receipt.lockEndAt,
                  verifiedBlockTime: receipt.verifiedBlockTime,
                  source: 'backend',
                });
              } catch {
                // Keep the local receipt if backend sync still fails.
              }
            }
          }
        }
      }

      deactivateCourse(activeCourseId);
      setUnlockStatusMessage(`Unlocked: ${signature.slice(0, 8)}...`);
      navigation.replace('ResurfaceHistory', { receiptId: signature });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to unlock this course yet.';
      setUnlockStatusMessage(message);
    } finally {
      setIsUnlocking(false);
    }
  };

  const menuItems = [
    { label: 'Streak Status', screen: 'StreakStatus' as const, icon: '\u2739' },
    { label: 'Leaderboard', screen: 'Leaderboard' as const, icon: '\u2694' },
    { label: 'Ichor Shop', screen: 'IchorShop' as const, icon: '\u2697' },
    { label: 'Community Pot', screen: 'CommunityPot' as const, icon: '\u26b2' },
    { label: 'Inventory', screen: 'Inventory' as const, icon: '\u2692' },
    { label: 'Resurface Receipts', screen: 'ResurfaceHistory' as const, icon: '\u21ba' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">Profile</Text>
        {activeCourse && (
          <Text className="mt-1 text-sm text-neutral-500">
            {activeCourse.title}
          </Text>
        )}

        {/* Stats row */}
        <View className="mt-6 flex-row gap-3">
          <View className="flex-1 items-center rounded-xl border border-neutral-700 bg-neutral-900 p-3">
            <Text className="text-xs uppercase text-neutral-500">Streak</Text>
            <Text className="mt-1 text-xl font-bold text-white">{streak}</Text>
          </View>
          <View className="flex-1 items-center rounded-xl border border-neutral-700 bg-neutral-900 p-3">
            <Text className="text-xs uppercase text-neutral-500">Ichor</Text>
            <Text className="mt-1 text-xl font-bold text-amber-400">
              {Math.floor(ichor)}
            </Text>
          </View>
          <View className="flex-1 items-center rounded-xl border border-neutral-700 bg-neutral-900 p-3">
            <Text className="text-xs uppercase text-neutral-500">Fuel</Text>
            <Text className="mt-1 text-xl font-bold text-orange-400">
              {fuel}
              <Text className="text-sm text-neutral-600">/{fuelCap}</Text>
            </Text>
          </View>
          <View className="flex-1 items-center rounded-xl border border-neutral-700 bg-neutral-900 p-3">
            <Text className="text-xs uppercase text-neutral-500">Savers</Text>
            <Text className="mt-1 text-xl font-bold text-purple-400">
              {3 - saverCount}/3
            </Text>
          </View>
        </View>

        {/* Course Switcher */}
        {lockedCourseIds.length > 1 && (
          <View className="mt-6">
            <Text className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
              Switch Course
            </Text>
            {lockedCourseIds.map((courseId) => {
              const course = courses.find((c) => c.id === courseId);
              if (!course) return null;
              const isActive = courseId === activeCourseId;
              return (
                <Pressable
                  key={courseId}
                  className={`mb-2 rounded-xl border p-3 ${
                    isActive
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-neutral-700 bg-neutral-900'
                  } active:opacity-80`}
                  onPress={() => {
                    setActiveCourse(courseId);
                    navigation.goBack();
                  }}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      isActive ? 'text-amber-400' : 'text-white'
                    }`}
                  >
                    {course.title}
                    {isActive ? ' (active)' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Menu Items */}
        <View className="mt-6">
          {menuItems.map((item) => (
            <Pressable
              key={item.screen}
              className="flex-row items-center gap-4 border-b border-neutral-800 py-4 active:opacity-70"
              onPress={() => navigation.navigate(item.screen)}
            >
              <Text className="w-6 text-center text-lg text-neutral-500">
                {item.icon}
              </Text>
              <Text className="text-base font-medium text-white">
                {item.label}
              </Text>
              <Text className="ml-auto text-neutral-600">{'\u203A'}</Text>
            </Pressable>
          ))}
        </View>

        {activeLockAccountAddress ? (
          <View className="mt-6 rounded-2xl border border-sky-500/25 bg-sky-500/5 p-5">
            <Text className="text-xs uppercase tracking-[2px] text-neutral-500">
              Resurface
            </Text>
            <Text className="mt-2 text-lg font-semibold text-white">
              Unlock & reclaim your locked funds
            </Text>

            {isLoadingLock ? (
              <View className="mt-4 flex-row items-center gap-3">
                <ActivityIndicator size="small" color="#a3a3a3" />
                <Text className="text-sm text-neutral-400">Reading live lock state...</Text>
              </View>
            ) : lockSnapshot ? (
              <>
                <Text className="mt-3 text-sm text-neutral-300">
                  Principal: {lockSnapshot.principalAmountUi} USDC
                </Text>
                <Text className="mt-1 text-sm text-neutral-300">
                  Locked SKR: {lockSnapshot.skrLockedAmountUi}
                </Text>
                <Text className="mt-1 text-sm text-neutral-300">
                  Unlock at: {new Date(lockSnapshot.lockEndDate).toLocaleString()}
                </Text>
                <Text className="mt-1 text-xs text-neutral-500">
                  {lockSnapshot.unlockEligible
                    ? 'This lock can be resurfaced now.'
                    : 'This lock is still active on-chain.'}
                </Text>
              </>
            ) : (
              <Text className="mt-3 text-sm text-neutral-500">
                Live lock state is unavailable right now.
              </Text>
            )}

            {unlockStatusMessage ? (
              <View className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
                <Text className="text-sm text-neutral-300">{unlockStatusMessage}</Text>
              </View>
            ) : null}

            <Pressable
              className={`mt-4 rounded-xl px-4 py-4 ${
                isUnlocking || !lockSnapshot?.unlockEligible
                  ? 'bg-neutral-700'
                  : 'bg-sky-600 active:bg-sky-700'
              }`}
              disabled={isUnlocking || !lockSnapshot?.unlockEligible}
              onPress={() => {
                void handleUnlock();
              }}
            >
              <Text className="text-center text-base font-semibold text-white">
                {isUnlocking ? 'Unlocking...' : 'Unlock & Resurface'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Danger zone */}
        <View className="mt-6 gap-3 pb-8">
          {__DEV__ && activeCourseId && activeState?.gauntletActive && (
            <Pressable
              className="rounded-xl border border-purple-500/30 bg-purple-500/10 py-3 active:opacity-80"
              onPress={() => {
                Alert.alert(
                  'Skip Gauntlet (DEV)',
                  'This skips the 1-week gauntlet and triggers the cinematic.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Skip',
                      onPress: () => {
                        useCourseStore.getState().skipGauntletForCourse(activeCourseId);
                        navigation.goBack();
                      },
                    },
                  ],
                );
              }}
            >
              <Text className="text-center text-sm font-semibold text-purple-300">
                Skip Gauntlet (DEV)
              </Text>
            </Pressable>
          )}
          {__DEV__ && activeCourseId && (
            <Pressable
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 py-3 active:opacity-80"
              onPress={() => {
                Alert.alert(
                  'Reset Lesson Progress',
                  'This clears local lesson completion for the active course so you can retake it.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset',
                      style: 'destructive',
                      onPress: () => {
                        resetLessonProgressForCourse(activeCourseId);
                        navigation.goBack();
                      },
                    },
                  ],
                );
              }}
            >
              <Text className="text-center text-sm font-semibold text-amber-300">
                Reset Lesson Progress
              </Text>
            </Pressable>
          )}
          <Pressable
            className="rounded-xl border border-neutral-700 bg-neutral-900 py-3 active:opacity-80"
            onPress={() => {
              navigation.replace('CourseBrowser');
            }}
          >
            <Text className="text-center text-sm font-semibold text-neutral-400">
              Browse Courses
            </Text>
          </Pressable>
          <Pressable
            className="rounded-xl border border-red-500/30 bg-red-500/10 py-3 active:opacity-80"
            onPress={() => {
              Alert.alert(
                'Disconnect Wallet',
                'This clears the cached wallet session on the device and in the wallet app.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Disconnect',
                    style: 'destructive',
                    onPress: () => {
                      void disconnectWallet(walletAuthToken ?? '').finally(() => {
                        disconnect();
                      });
                    },
                  },
                ],
              );
            }}
          >
            <Text className="text-center text-sm font-semibold text-red-400">
              Disconnect
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
