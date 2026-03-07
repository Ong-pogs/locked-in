import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ApiError,
  getYieldHistory,
  type YieldHistoryEntry,
  type YieldHistoryResponse,
} from '@/services/api';
import {
  buildRedeemIchorTransaction,
  connection,
  fetchLockAccountSnapshot,
  fetchRedemptionVaultBalance,
  getIchorRedemptionQuote,
  hasLockVaultConfig,
  signTransaction,
  type LockAccountSnapshot,
} from '@/services/solana';
import { useCourseStore } from '@/stores/courseStore';
import { useUserStore } from '@/stores';
import { refreshAuthSession } from '@/services/api/auth/authApi';

function renderHarvestStatus(status: YieldHistoryEntry['lockVaultStatus']) {
  if (status === 'published') return 'Published';
  if (status === 'publishing') return 'Publishing';
  if (status === 'failed') return 'Failed';
  return 'Pending';
}

function renderSplitterStatus(entry: YieldHistoryEntry) {
  const isLegacyManualHarvest =
    entry.kind === 'MANUAL' &&
    entry.yieldSplitterStatus === 'pending' &&
    entry.lockVaultStatus === 'published';
  if (isLegacyManualHarvest) {
    return 'Legacy';
  }
  return renderHarvestStatus(entry.yieldSplitterStatus);
}

function renderHarvestReason(reason: string | null) {
  if (reason === 'HARVEST_APPLIED') return 'Applied';
  if (reason === 'HARVEST_SKIPPED') return 'Skipped';
  return reason ?? 'Pending';
}

export function IchorShopScreen() {
  const navigation = useNavigation();

  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const syncLockSnapshot = useCourseStore((s) => s.syncLockSnapshot);
  const walletAddress = useUserStore((s) => s.walletAddress);
  const walletAuthToken = useUserStore((s) => s.walletAuthToken);
  const authToken = useUserStore((s) => s.authToken);
  const refreshToken = useUserStore((s) => s.refreshToken);
  const setAuthSession = useUserStore((s) => s.setAuthSession);
  const activeLockAccountAddress = activeCourseId
    ? courseStates[activeCourseId]?.lockAccountAddress ?? null
    : null;

  const [lockSnapshot, setLockSnapshot] = useState<LockAccountSnapshot | null>(null);
  const [redemptionVaultBalanceUi, setRedemptionVaultBalanceUi] = useState('0');
  const [isLoadingLock, setIsLoadingLock] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ichorAmount, setIchorAmount] = useState('1000');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [yieldHistory, setYieldHistory] = useState<YieldHistoryResponse | null>(null);
  const [yieldHistoryLoading, setYieldHistoryLoading] = useState(true);
  const [yieldHistoryError, setYieldHistoryError] = useState<string | null>(null);

  const refreshBackendAccessToken = useCallback(async () => {
    if (!refreshToken) {
      throw new Error('Connect your wallet again to read harvest history.');
    }

    const refreshed = await refreshAuthSession({ refreshToken });
    setAuthSession(refreshed.accessToken, refreshed.refreshToken);
    return refreshed.accessToken;
  }, [refreshToken, setAuthSession]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const loadYieldHistory = async () => {
        if (!activeCourseId) {
          if (!active) return;
          setYieldHistory(null);
          setYieldHistoryError(null);
          setYieldHistoryLoading(false);
          return;
        }

        if (active) {
          setYieldHistoryLoading(true);
        }

        let backendAccessToken = authToken;
        if (!backendAccessToken && refreshToken) {
          try {
            backendAccessToken = await refreshBackendAccessToken();
          } catch (error) {
            if (!active) return;
            setYieldHistory(null);
            setYieldHistoryError(
              error instanceof Error
                ? error.message
                : 'Connect your wallet again to read harvest history.',
            );
            setYieldHistoryLoading(false);
            return;
          }
        }

        if (!backendAccessToken) {
          if (!active) return;
          setYieldHistory(null);
          setYieldHistoryError('Connect your wallet again to read harvest history.');
          setYieldHistoryLoading(false);
          return;
        }

        try {
          const response = await getYieldHistory(activeCourseId, backendAccessToken);
          if (!active) return;
          setYieldHistory(response);
          setYieldHistoryError(null);
          setYieldHistoryLoading(false);
        } catch (error) {
          if (
            error instanceof ApiError &&
            (error.code === 'TOKEN_EXPIRED' || error.status === 401) &&
            refreshToken
          ) {
            try {
              const refreshedToken = await refreshBackendAccessToken();
              const retried = await getYieldHistory(activeCourseId, refreshedToken);
              if (!active) return;
              setYieldHistory(retried);
              setYieldHistoryError(null);
              setYieldHistoryLoading(false);
              return;
            } catch (refreshError) {
              if (!active) return;
              setYieldHistory(null);
              setYieldHistoryError(
                refreshError instanceof Error
                  ? refreshError.message
                  : 'Unable to read yield history.',
              );
              setYieldHistoryLoading(false);
              return;
            }
          }

          if (!active) return;
          setYieldHistory(null);
          setYieldHistoryError(
            error instanceof Error ? error.message : 'Unable to read yield history.',
          );
          setYieldHistoryLoading(false);
        }
      };

      void loadYieldHistory();

      if (
        !activeCourseId ||
        !walletAddress ||
        !activeLockAccountAddress ||
        !hasLockVaultConfig()
      ) {
        if (active) {
          setLockSnapshot(null);
          setIsLoadingLock(false);
        }
        return () => {
          active = false;
        };
      }

      setIsLoadingLock(true);
      void Promise.all([
        fetchLockAccountSnapshot({
          ownerAddress: walletAddress,
          courseId: activeCourseId,
        }),
        fetchRedemptionVaultBalance(),
      ])
        .then(([snapshot, redemptionVault]) => {
          if (!active) return;
          setStatusMessage(null);
          if (activeCourseId) {
            syncLockSnapshot(activeCourseId, snapshot);
          }
          setLockSnapshot(snapshot);
          setRedemptionVaultBalanceUi(redemptionVault.balanceUi);
        })
        .catch((error) => {
          if (!active) return;
          const message =
            error instanceof Error ? error.message : 'Unable to read live Ichor state.';
          setStatusMessage(message);
          setLockSnapshot(null);
          setRedemptionVaultBalanceUi('0');
        })
        .finally(() => {
          if (!active) return;
          setIsLoadingLock(false);
        });

      return () => {
        active = false;
      };
    }, [
      activeCourseId,
      activeLockAccountAddress,
      authToken,
      refreshBackendAccessToken,
      refreshToken,
      syncLockSnapshot,
      walletAddress,
    ]),
  );

  const quote = useMemo(() => {
    if (!lockSnapshot) return null;

    try {
      return getIchorRedemptionQuote(ichorAmount, lockSnapshot.ichorLifetimeTotal);
    } catch {
      return null;
    }
  }, [ichorAmount, lockSnapshot]);

  const availableIchor = lockSnapshot?.ichorCounter ?? 0;
  const redemptionVaultBalance = Number(redemptionVaultBalanceUi || '0');
  const recentHarvests = yieldHistory?.entries ?? [];
  const canRedeem =
    Boolean(lockSnapshot?.gauntletComplete) &&
    availableIchor > 0 &&
    redemptionVaultBalance > 0 &&
    !isSubmitting &&
    Boolean(quote) &&
    Number(ichorAmount) > 0 &&
    Number(ichorAmount) <= availableIchor;

  const handleRedeem = async () => {
    if (!activeCourseId || !walletAddress || !walletAuthToken) {
      setStatusMessage('Connect your wallet again before redeeming Ichor.');
      return;
    }

    try {
      setIsSubmitting(true);
      setStatusMessage('Building redemption transaction...');

      const buildResult = await buildRedeemIchorTransaction({
        ownerAddress: walletAddress,
        courseId: activeCourseId,
        ichorAmount,
      });

      setStatusMessage('Requesting wallet approval...');
      const signedTransaction = await signTransaction(
        walletAddress,
        buildResult.transaction,
        walletAuthToken,
      );

      setStatusMessage('Submitting transaction...');
      const rawTransaction = signedTransaction.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed',
      });

      setStatusMessage('Confirming redemption on-chain...');
      await connection.confirmTransaction(signature, 'confirmed');

      setStatusMessage(`Redeemed: ${signature.slice(0, 8)}...`);

      const refreshed = await fetchLockAccountSnapshot({
        ownerAddress: walletAddress,
        courseId: activeCourseId,
      });
      syncLockSnapshot(activeCourseId, refreshed);
      setLockSnapshot(refreshed);
      const redemptionVault = await fetchRedemptionVaultBalance();
      setRedemptionVaultBalanceUi(redemptionVault.balanceUi);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to redeem Ichor right now.';
      setStatusMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">Ichor Shop</Text>
        <Text className="mt-1 text-sm text-neutral-500">
          Exchange Ichor for USDC
        </Text>

        {isLoadingLock ? (
          <View className="mt-6 flex-row items-center gap-3">
            <ActivityIndicator size="small" color="#a3a3a3" />
            <Text className="text-sm text-neutral-400">Reading live Ichor state...</Text>
          </View>
        ) : (
          <>
            <View className="mt-6 items-center rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
              <Text className="text-xs uppercase tracking-wide text-neutral-500">
                Available Ichor
              </Text>
              <Text className="mt-2 text-4xl font-bold text-amber-400">
                {availableIchor.toLocaleString()}
              </Text>
              <Text className="mt-2 text-xs text-neutral-500">
                Lifetime total: {lockSnapshot?.ichorLifetimeTotal ?? 0}
              </Text>
            </View>

            <View className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-5">
              <Text className="text-sm font-semibold text-neutral-400">
                Exchange Rate
              </Text>
              <Text className="mt-2 text-lg text-white">
                1,000 Ichor = {lockSnapshot?.conversionRateLabel ?? '0.90 USDC'}
              </Text>
              <Text className="mt-1 text-xs text-neutral-600">
                Current tier is based on lifetime Ichor earned on this lock.
              </Text>
              <Text className="mt-1 text-xs text-neutral-600">
                Redemption vault liquidity: {redemptionVaultBalanceUi} USDC
              </Text>
            </View>

            <View className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-5">
              <Text className="text-sm font-semibold text-neutral-400">Harvest Summary</Text>
              {yieldHistoryLoading ? (
                <Text className="mt-3 text-sm text-neutral-500">Loading harvest history...</Text>
              ) : yieldHistoryError ? (
                <Text className="mt-3 text-xs text-amber-300">{yieldHistoryError}</Text>
              ) : (
                <>
                  <View className="mt-3 flex-row justify-between">
                    <View>
                      <Text className="text-xs uppercase text-neutral-500">Gross Yield</Text>
                      <Text className="mt-1 text-lg font-bold text-white">
                        {yieldHistory?.totalGrossYieldUi ?? '0'} USDC
                      </Text>
                    </View>
                    <View>
                      <Text className="text-xs uppercase text-neutral-500">Platform Fee</Text>
                      <Text className="mt-1 text-lg font-bold text-white">
                        {yieldHistory?.totalPlatformFeeUi ?? '0'} USDC
                      </Text>
                    </View>
                  </View>
                  <View className="mt-4 flex-row justify-between">
                    <View>
                      <Text className="text-xs uppercase text-neutral-500">Redirected</Text>
                      <Text className="mt-1 text-lg font-bold text-white">
                        {yieldHistory?.totalRedirectedUi ?? '0'} USDC
                      </Text>
                    </View>
                    <View>
                      <Text className="text-xs uppercase text-neutral-500">Ichor Awarded</Text>
                      <Text className="mt-1 text-lg font-bold text-amber-400">
                        {Number(yieldHistory?.totalIchorAwarded ?? '0').toLocaleString()}
                      </Text>
                    </View>
                  </View>
                  <Text className="mt-3 text-xs text-neutral-600">
                    Total harvests: {yieldHistory?.totalHarvests ?? 0}
                  </Text>
                </>
              )}
            </View>

            <View className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-5">
              <Text className="text-xs uppercase tracking-[2px] text-neutral-500">
                Redeem Amount
              </Text>
              <TextInput
                className="mt-3 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-lg text-white"
                keyboardType="number-pad"
                value={ichorAmount}
                onChangeText={setIchorAmount}
                placeholder="1000"
                placeholderTextColor="#737373"
              />

              <Text className="mt-4 text-sm font-semibold text-neutral-400">
                Quote
              </Text>
              <Text className="mt-2 text-lg text-white">
                {quote ? `${quote.usdcOutUi} USDC` : '--'}
              </Text>
              <Text className="mt-1 text-xs text-neutral-600">
                Redemption is available only after gauntlet completion.
              </Text>
            </View>

            {statusMessage ? (
              <View className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4">
                <Text className="text-sm text-neutral-300">{statusMessage}</Text>
              </View>
            ) : null}

            <View className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-5">
              <Text className="text-sm font-semibold text-neutral-400">Recent Harvests</Text>
              {yieldHistoryLoading ? (
                <Text className="mt-3 text-sm text-neutral-500">Loading harvest receipts...</Text>
              ) : yieldHistoryError ? (
                <Text className="mt-3 text-xs text-amber-300">{yieldHistoryError}</Text>
              ) : recentHarvests.length === 0 ? (
                <Text className="mt-3 text-sm text-neutral-500">No harvest history yet.</Text>
              ) : (
                recentHarvests.map((entry) => (
                  <View
                    key={entry.harvestId}
                    className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-semibold uppercase text-neutral-500">
                        {entry.kind}
                      </Text>
                      <Text className="text-xs text-neutral-500">
                        {renderHarvestStatus(entry.lockVaultStatus)}
                      </Text>
                    </View>
                    <Text className="mt-2 text-sm font-semibold text-white">
                      {renderHarvestReason(entry.reason)}
                    </Text>
                    <Text className="mt-1 text-xs text-neutral-600">
                      {new Date(entry.harvestedAt).toLocaleString()}
                    </Text>
                    <Text className="mt-3 text-sm text-neutral-300">
                      Gross: {entry.grossYieldAmountUi} USDC
                      {' \u00B7 '}Fee: {entry.platformFeeAmountUi} USDC
                      {' \u00B7 '}Redirect: {entry.redirectedAmountUi} USDC
                    </Text>
                    <Text className="mt-1 text-sm text-amber-400">
                      Ichor awarded: {Number(entry.ichorAwarded).toLocaleString()}
                    </Text>
                    <Text className="mt-2 text-xs text-neutral-600">
                      Splitter: {renderSplitterStatus(entry)}
                      {' \u00B7 '}LockVault: {renderHarvestStatus(entry.lockVaultStatus)}
                      {' \u00B7 '}Pot: {renderHarvestStatus(entry.communityPotStatus)}
                    </Text>
                    {entry.lockVaultTransactionSignature ? (
                      <Text className="mt-1 text-xs text-neutral-600">
                        Lock tx: {entry.lockVaultTransactionSignature.slice(0, 12)}...
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </View>

            <Pressable
              className={`mt-6 mb-8 rounded-xl py-4 ${
                canRedeem ? 'bg-purple-700 active:opacity-80' : 'bg-neutral-700'
              }`}
              disabled={!canRedeem}
              onPress={() => {
                void handleRedeem();
              }}
            >
              <Text className="text-center text-base font-bold text-white">
                {isSubmitting ? 'Redeeming...' : 'EXCHANGE ICHOR'}
              </Text>
              <Text className="mt-1 text-center text-xs text-purple-300">
                {availableIchor <= 0
                  ? 'No Ichor available yet'
                  : redemptionVaultBalance <= 0
                    ? 'Protocol redemption vault has no USDC yet'
                    : 'Owner-signed on-chain redemption'}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
