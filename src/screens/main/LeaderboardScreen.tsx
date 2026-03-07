import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ApiError, getLeaderboard, type LeaderboardEntry, type LeaderboardResponse } from '@/services/api';
import { refreshAuthSession } from '@/services/api/auth/authApi';
import { useUserStore } from '@/stores';

const PAGE_SIZE = 10;

function renderStatus(status: LeaderboardEntry['streakStatus']) {
  return status === 'active' ? 'Active' : 'Broken';
}

export function LeaderboardScreen() {
  const navigation = useNavigation();
  const authToken = useUserStore((s) => s.authToken);
  const refreshToken = useUserStore((s) => s.refreshToken);
  const setAuthSession = useUserStore((s) => s.setAuthSession);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const refreshBackendAccessToken = useCallback(async () => {
    if (!refreshToken) {
      throw new Error('Connect your wallet again to read the leaderboard.');
    }

    const refreshed = await refreshAuthSession({ refreshToken });
    setAuthSession(refreshed.accessToken, refreshed.refreshToken);
    return refreshed.accessToken;
  }, [refreshToken, setAuthSession]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const loadLeaderboard = async () => {
        setLoading(true);
        let backendAccessToken = authToken;

        if (!backendAccessToken && refreshToken) {
          backendAccessToken = await refreshBackendAccessToken();
        }

        if (!backendAccessToken) {
          if (!active) return;
          setLeaderboard(null);
          setErrorMessage('Connect your wallet again to read the leaderboard.');
          setLoading(false);
          return;
        }

        try {
          const response = await getLeaderboard(backendAccessToken, {
            page,
            pageSize: PAGE_SIZE,
          });
          if (!active) return;
          setLeaderboard(response);
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
              const retried = await getLeaderboard(refreshedToken, {
                page,
                pageSize: PAGE_SIZE,
              });
              if (!active) return;
              setLeaderboard(retried);
              setErrorMessage(null);
              setLoading(false);
              return;
            } catch (refreshError) {
              if (!active) return;
              setLeaderboard(null);
              setErrorMessage(
                refreshError instanceof Error
                  ? refreshError.message
                  : 'Unable to read the leaderboard.',
              );
              setLoading(false);
              return;
            }
          }

          if (!active) return;
          setLeaderboard(null);
          setErrorMessage(
            error instanceof Error ? error.message : 'Unable to read the leaderboard.',
          );
          setLoading(false);
        }
      };

      void loadLeaderboard();
      return () => {
        active = false;
      };
    }, [authToken, page, refreshBackendAccessToken, refreshToken]),
  );

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">Leaderboard</Text>
        <Text className="mt-1 text-sm text-neutral-500">
          Ranked by active streak, then locked principal, with Community Pot projection
        </Text>
        {leaderboard ? (
          <Text className="mt-1 text-xs text-neutral-600">
            {leaderboard.source === 'materialized' && leaderboard.snapshotAt
              ? `Snapshot updated ${new Date(leaderboard.snapshotAt).toLocaleString()}`
              : 'Live fallback view'}
          </Text>
        ) : null}

        {loading ? (
          <Text className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-500">
            Loading leaderboard...
          </Text>
        ) : errorMessage ? (
          <Text className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300">
            {errorMessage}
          </Text>
        ) : leaderboard ? (
          <>
            <View className="mt-6 flex-row gap-3">
              <View className="flex-1 rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
                <Text className="text-xs uppercase text-purple-300">Current Pot</Text>
                <Text className="mt-2 text-2xl font-bold text-white">
                  {leaderboard.currentPotSizeUi} USDC
                </Text>
              </View>
              <View className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
                <Text className="text-xs uppercase text-neutral-500">Next Window</Text>
                <Text className="mt-2 text-lg font-semibold text-white">
                  {leaderboard.nextDistributionWindowLabel ?? 'TBD'}
                </Text>
              </View>
            </View>

            {leaderboard.currentUser ? (
              <View className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                <Text className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                  Your Rank
                </Text>
                <View className="mt-3 flex-row items-center justify-between">
                  <Text className="text-3xl font-bold text-white">
                    #{leaderboard.currentUser.rank}
                  </Text>
                  <Text className="text-sm text-emerald-300">
                    {leaderboard.currentUser.projectedCommunityPotShareUi} USDC projected
                  </Text>
                </View>
                <Text className="mt-2 text-sm text-neutral-400">
                  {leaderboard.currentUser.displayIdentity}
                </Text>
                <Text className="mt-1 text-xs text-neutral-500">
                  Streak: {leaderboard.currentUser.streakLength}
                  {' \u00B7 '}
                  Principal: {leaderboard.currentUser.lockedPrincipalAmountUi} USDC
                  {' \u00B7 '}
                  Courses: {leaderboard.currentUser.activeCourseCount}
                </Text>
              </View>
            ) : null}

            <View className="mt-6 mb-8">
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
                  Rankings
                </Text>
                <Text className="text-xs text-neutral-500">
                  Page {leaderboard.page} / {leaderboard.totalPages}
                  {' \u00B7 '}
                  {leaderboard.totalEntries} total
                </Text>
              </View>
              {leaderboard.entries.map((entry) => (
                <View
                  key={entry.walletAddress}
                  className={`mb-3 rounded-xl border p-4 ${
                    entry.isCurrentUser
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-neutral-700 bg-neutral-900'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-3">
                      <Text className="text-lg font-bold text-white">#{entry.rank}</Text>
                      <View>
                        <Text className="text-base font-semibold text-white">
                          {entry.displayIdentity}
                        </Text>
                        <Text className="text-xs text-neutral-500">
                          {renderStatus(entry.streakStatus)}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-sm text-purple-300">
                      {entry.projectedCommunityPotShareUi} USDC
                    </Text>
                  </View>
                  <Text className="mt-3 text-xs text-neutral-500">
                    Streak: {entry.streakLength}
                    {' \u00B7 '}
                    Courses: {entry.activeCourseCount}
                    {' \u00B7 '}
                    Principal: {entry.lockedPrincipalAmountUi} USDC
                  </Text>
                  {entry.recentActivityDate ? (
                    <Text className="mt-1 text-xs text-neutral-500">
                      Last active: {entry.recentActivityDate}
                    </Text>
                  ) : null}
                </View>
              ))}

              <View className="mt-2 flex-row gap-3">
                <Pressable
                  className={`flex-1 rounded-xl border px-4 py-3 ${
                    page <= 1
                      ? 'border-neutral-800 bg-neutral-900'
                      : 'border-neutral-700 bg-neutral-900 active:opacity-80'
                  }`}
                  disabled={page <= 1}
                  onPress={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <Text className="text-center text-sm font-semibold text-white">
                    Previous
                  </Text>
                </Pressable>
                <Pressable
                  className={`flex-1 rounded-xl border px-4 py-3 ${
                    leaderboard.page >= leaderboard.totalPages
                      ? 'border-neutral-800 bg-neutral-900'
                      : 'border-neutral-700 bg-neutral-900 active:opacity-80'
                  }`}
                  disabled={leaderboard.page >= leaderboard.totalPages}
                  onPress={() =>
                    setPage((current) =>
                      Math.min(leaderboard.totalPages, current + 1),
                    )
                  }
                >
                  <Text className="text-center text-sm font-semibold text-white">Next</Text>
                </Pressable>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
