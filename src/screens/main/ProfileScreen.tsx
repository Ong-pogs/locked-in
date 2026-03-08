import { useCallback, useState } from 'react';
import { Alert, ActivityIndicator, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
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
import { useFlameStore, useResurfaceStore, useStreakStore, useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';
import {
  T,
  ts,
  ScreenBackground,
  BackButton,
  ParchmentCard,
  MenuRow,
  StatBox,
} from '@/theme';

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
    { label: 'Streak Status', screen: 'StreakStatus' as const, icon: '\u2739', color: T.amber },
    { label: 'Leaderboard', screen: 'Leaderboard' as const, icon: '\u2694', color: T.amber },
    { label: 'Ichor Shop', screen: 'IchorShop' as const, icon: '\u2697', color: T.teal },
    { label: 'Community Pot', screen: 'CommunityPot' as const, icon: '\u26b2', color: T.amber },
    { label: 'Inventory', screen: 'Inventory' as const, icon: '\u2692', color: T.rust },
    { label: 'Resurface Receipts', screen: 'ResurfaceHistory' as const, icon: '\u21ba', color: T.teal },
  ];

  return (
    <ScreenBackground>
      <ScrollView style={s.scrollView} contentContainerStyle={ts.scrollContent}>
        <BackButton onPress={() => navigation.goBack()} />

        <Text style={ts.pageTitle}>Profile</Text>
        {activeCourse && (
          <Text style={s.courseSubtitle}>{activeCourse.title}</Text>
        )}

        {/* Stats row */}
        <View style={s.statsRow}>
          <StatBox label="Streak" value={streak} color={T.amber} />
          <StatBox label="Ichor" value={Math.floor(ichor)} color={T.teal} />
          <StatBox
            label="Fuel"
            value={`${fuel}/${fuelCap}`}
            color={T.rust}
          />
          <StatBox label="Savers" value={`${3 - saverCount}/3`} color={T.violet} />
        </View>

        {/* Course Switcher */}
        {lockedCourseIds.length > 1 && (
          <View style={s.section}>
            <Text style={ts.sectionLabel}>Switch Course</Text>
            {lockedCourseIds.map((courseId) => {
              const course = courses.find((c) => c.id === courseId);
              if (!course) return null;
              const isActive = courseId === activeCourseId;
              return (
                <Pressable
                  key={courseId}
                  onPress={() => {
                    setActiveCourse(courseId);
                    navigation.goBack();
                  }}
                >
                  {({ pressed }) => (
                    <ParchmentCard
                      style={[
                        s.courseSwitcherItem,
                        isActive ? s.courseSwitcherItemActive : {},
                      ]}
                      opacity={isActive ? 0.45 : 0.25}
                    >
                      <Text
                        style={[
                          s.courseSwitcherText,
                          isActive ? { color: T.amber } : null,
                          pressed ? { opacity: 0.8 } : null,
                        ]}
                      >
                        {course.title}
                        {isActive ? ' (active)' : ''}
                      </Text>
                    </ParchmentCard>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Menu Items */}
        <View style={s.section}>
          {menuItems.map((item) => (
            <MenuRow
              key={item.screen}
              icon={item.icon}
              label={item.label}
              color={item.color}
              onPress={() => navigation.navigate(item.screen)}
            />
          ))}
        </View>

        {/* Resurface section */}
        {activeLockAccountAddress ? (
          <ParchmentCard style={s.resurfaceCard} opacity={0.3}>
            <Text style={ts.sectionLabel}>Resurface</Text>
            <Text style={s.resurfaceTitle}>
              Unlock & reclaim your locked funds
            </Text>

            {isLoadingLock ? (
              <View style={s.loadingRow}>
                <ActivityIndicator size="small" color={T.textSecondary} />
                <Text style={s.loadingText}>Reading live lock state...</Text>
              </View>
            ) : lockSnapshot ? (
              <>
                <Text style={s.lockDetail}>
                  Principal: {lockSnapshot.principalAmountUi} USDC
                </Text>
                <Text style={s.lockDetail}>
                  Locked SKR: {lockSnapshot.skrLockedAmountUi}
                </Text>
                <Text style={s.lockDetail}>
                  Unlock at: {new Date(lockSnapshot.lockEndDate).toLocaleString()}
                </Text>
                <Text style={s.lockHint}>
                  {lockSnapshot.unlockEligible
                    ? 'This lock can be resurfaced now.'
                    : 'This lock is still active on-chain.'}
                </Text>
              </>
            ) : (
              <Text style={s.lockUnavailable}>
                Live lock state is unavailable right now.
              </Text>
            )}

            {unlockStatusMessage ? (
              <View style={s.statusMessageBox}>
                <Text style={s.statusMessageText}>{unlockStatusMessage}</Text>
              </View>
            ) : null}

            <Pressable
              disabled={isUnlocking || !lockSnapshot?.unlockEligible}
              onPress={() => {
                void handleUnlock();
              }}
            >
              <View
                style={[
                  ts.primaryBtn,
                  s.unlockBtn,
                  (isUnlocking || !lockSnapshot?.unlockEligible) ? s.unlockBtnDisabled : {},
                ]}
              >
                <Text
                  style={[
                    ts.primaryBtnText,
                    (isUnlocking || !lockSnapshot?.unlockEligible) ? { color: T.textSecondary } : {},
                  ]}
                >
                  {isUnlocking ? 'Unlocking...' : 'Unlock & Resurface'}
                </Text>
              </View>
            </Pressable>
          </ParchmentCard>
        ) : null}

        {/* Danger zone */}
        <View style={s.dangerZone}>
          {__DEV__ && activeCourseId && activeState?.gauntletActive && (
            <Pressable
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
                        const streak = Math.max(useStreakStore.getState().currentStreak, 1);
                        useFlameStore.getState().updateFromStreak(streak);
                        navigation.goBack();
                      },
                    },
                  ],
                );
              }}
            >
              <View style={[ts.secondaryBtn, s.actionBtn, { borderColor: 'rgba(153,69,255,0.2)' }]}>
                <Text style={s.actionBtnIcon}>{'\u269B'}</Text>
                <Text style={[s.actionBtnText, { color: T.violet }]}>
                  Skip Gauntlet (DEV)
                </Text>
              </View>
            </Pressable>
          )}

          <View style={ts.divider} />

          <Pressable
            onPress={() => {
              navigation.replace('CourseBrowser');
            }}
          >
            <View style={[ts.secondaryBtn, s.actionBtn]}>
              <Text style={s.actionBtnIcon}>{'\u2637'}</Text>
              <Text style={s.actionBtnText}>Browse Courses</Text>
            </View>
          </Pressable>
          <Pressable
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
            <View style={[ts.secondaryBtn, s.actionBtn, { borderColor: 'rgba(255,68,102,0.15)' }]}>
              <Text style={s.actionBtnIcon}>{'\u2715'}</Text>
              <Text style={[s.actionBtnText, { color: T.crimson }]}>Disconnect</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}

const s = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  courseSubtitle: {
    fontSize: 13,
    color: T.textSecondary,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  section: {
    marginTop: 20,
  },
  courseSwitcherItem: {
    marginBottom: 8,
    padding: 14,
  },
  courseSwitcherItemActive: {
    borderColor: `${T.amber}50`,
  },
  courseSwitcherText: {
    fontSize: 14,
    fontWeight: '600',
    color: T.textPrimary,
  },
  resurfaceCard: {
    marginTop: 20,
    padding: 18,
  },
  resurfaceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: T.textPrimary,
    marginTop: 6,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  loadingText: {
    fontSize: 13,
    color: T.textSecondary,
  },
  lockDetail: {
    fontSize: 13,
    color: T.textPrimary,
    marginTop: 8,
  },
  lockHint: {
    fontSize: 11,
    color: T.textSecondary,
    marginTop: 6,
  },
  lockUnavailable: {
    fontSize: 13,
    color: T.textSecondary,
    marginTop: 10,
  },
  statusMessageBox: {
    marginTop: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.borderDormant,
    backgroundColor: T.bgCard,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statusMessageText: {
    fontSize: 13,
    color: T.textPrimary,
  },
  unlockBtn: {
    marginTop: 14,
  },
  unlockBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: T.borderDormant,
  },
  dangerZone: {
    marginTop: 20,
    gap: 10,
    paddingBottom: 32,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  actionBtnIcon: {
    fontSize: 16,
    color: T.textMuted,
    width: 22,
    textAlign: 'center',
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: T.textSecondary,
  },
});
