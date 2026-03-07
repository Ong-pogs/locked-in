import { ScrollView, View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ApiError,
  getCourseRuntimeHistory,
  type RuntimeAuditEvent,
  type RuntimeHistoryResponse,
} from '@/services/api';
import { refreshAuthSession } from '@/services/api/auth/authApi';
import { useUserStore } from '@/stores';
import { useCourseStore } from '@/stores/courseStore';

function renderEventTitle(event: RuntimeAuditEvent) {
  if (event.eventType === 'FUEL_BURN') {
    if (event.reason === 'BURNED') return 'Fuel Burned';
    if (event.reason === 'NO_FUEL') return 'Burn Skipped';
    if (event.reason === 'GAUNTLET_LOCKED') return 'Burn Locked';
    return 'Fuel Event';
  }

  if (event.reason === 'FULL_CONSEQUENCE') return 'Full Consequence';
  if (event.reason === 'SAVER_CONSUMED') return 'Saver Consumed';
  if (event.reason === 'GAUNTLET_LOCKED') return 'Miss Locked';
  return 'Miss Event';
}

function renderRelayStatus(status: RuntimeAuditEvent['lockVaultStatus']) {
  if (status === 'published') return 'Published';
  if (status === 'publishing') return 'Publishing';
  if (status === 'failed') return 'Failed';
  return 'Pending';
}

function renderEventRelayStatus(event: RuntimeAuditEvent) {
  const isLegacyManualEvent =
    event.lockVaultStatus === 'pending' &&
    !event.eventId.startsWith('auto-burn:') &&
    !event.eventId.startsWith('auto-miss:');
  if (isLegacyManualEvent) {
    return 'Legacy';
  }
  return renderRelayStatus(event.lockVaultStatus);
}

export function StreakStatusScreen() {
  const navigation = useNavigation();

  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const refreshCourseRuntime = useCourseStore((s) => s.refreshCourseRuntime);
  const authToken = useUserStore((s) => s.authToken);
  const refreshToken = useUserStore((s) => s.refreshToken);
  const setAuthSession = useUserStore((s) => s.setAuthSession);
  const [history, setHistory] = useState<RuntimeHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const activeState = activeCourseId ? courseStates[activeCourseId] : null;
  const activeCourse = activeCourseId
    ? courses.find((c) => c.id === activeCourseId)
    : null;

  const streak = activeState?.currentStreak ?? 0;
  const longestStreak = activeState?.longestStreak ?? 0;
  const saverCount = activeState?.saverCount ?? 0;
  const saversRemaining = Math.max(0, 3 - saverCount);
  const gauntletActive = activeState?.gauntletActive ?? false;
  const gauntletDay = activeState?.gauntletDay ?? 1;
  const saverRecoveryMode = activeState?.saverRecoveryMode ?? false;
  const redirectPercent = Math.round((activeState?.currentYieldRedirectBps ?? 0) / 100);
  const extensionDays = activeState?.extensionDays ?? 0;

  const refreshBackendAccessToken = useCallback(async () => {
    if (!refreshToken) {
      throw new Error('Connect your wallet again to read runtime history.');
    }

    const refreshed = await refreshAuthSession({ refreshToken });
    setAuthSession(refreshed.accessToken, refreshed.refreshToken);
    return refreshed.accessToken;
  }, [refreshToken, setAuthSession]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const loadRuntimeHistory = async () => {
        if (!activeCourseId) {
          if (!active) return;
          setHistory(null);
          setHistoryError(null);
          setHistoryLoading(false);
          return;
        }

        if (active) {
          setHistoryLoading(true);
        }

        let backendAccessToken = authToken;
        if (!backendAccessToken && refreshToken) {
          try {
            backendAccessToken = await refreshBackendAccessToken();
          } catch (error) {
            if (!active) return;
            setHistory(null);
            setHistoryError(
              error instanceof Error
                ? error.message
                : 'Connect your wallet again to read runtime history.',
            );
            setHistoryLoading(false);
            return;
          }
        }

        if (!backendAccessToken) {
          if (!active) return;
          setHistory(null);
          setHistoryError('Connect your wallet again to read runtime history.');
          setHistoryLoading(false);
          return;
        }

        void refreshCourseRuntime(activeCourseId, backendAccessToken).catch(() => {
          // Keep last synced runtime visible if refresh fails.
        });

        try {
          const response = await getCourseRuntimeHistory(activeCourseId, backendAccessToken);
          if (!active) return;
          setHistory(response);
          setHistoryError(null);
          setHistoryLoading(false);
        } catch (error) {
          if (
            error instanceof ApiError &&
            (error.code === 'TOKEN_EXPIRED' || error.status === 401) &&
            refreshToken
          ) {
            try {
              const refreshedToken = await refreshBackendAccessToken();
              const retried = await getCourseRuntimeHistory(activeCourseId, refreshedToken);
              if (!active) return;
              setHistory(retried);
              setHistoryError(null);
              setHistoryLoading(false);
              return;
            } catch (refreshError) {
              if (!active) return;
              setHistory(null);
              setHistoryError(
                refreshError instanceof Error
                  ? refreshError.message
                  : 'Unable to read runtime history.',
              );
              setHistoryLoading(false);
              return;
            }
          }

          if (!active) return;
          setHistory(null);
          setHistoryError(
            error instanceof Error ? error.message : 'Unable to read runtime history.',
          );
          setHistoryLoading(false);
        }
      };

      void loadRuntimeHistory();
      return () => {
        active = false;
      };
    }, [activeCourseId, authToken, refreshBackendAccessToken, refreshCourseRuntime, refreshToken]),
  );

  // Flame state derived from streak
  const flameState = streak >= 3 ? 'BURNING' : streak >= 1 ? 'LIT' : 'COLD';
  const flameColor =
    flameState === 'BURNING'
      ? 'text-amber-400'
      : flameState === 'LIT'
        ? 'text-orange-400'
        : 'text-neutral-600';

  const lampsLit = saversRemaining;

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">
          Streak Status
        </Text>
        {activeCourse && (
          <Text className="mt-1 text-sm text-neutral-500">
            {activeCourse.title}
          </Text>
        )}

        {/* Flame state */}
        <View className="mt-6 items-center rounded-2xl border border-neutral-700 bg-neutral-900 p-6">
          <Text className={`text-4xl font-bold ${flameColor}`}>
            {flameState}
          </Text>
          <Text className="mt-2 text-sm text-neutral-500">
            {flameState === 'BURNING'
              ? 'Your flame burns bright'
              : flameState === 'LIT'
                ? 'Your flame is lit'
                : 'Your flame is cold'}
          </Text>
        </View>

        {/* Streak info */}
        <View className="mt-4 flex-row gap-3">
          <View className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <Text className="text-xs uppercase tracking-wide text-neutral-500">
              Current Streak
            </Text>
            <Text className="mt-1 text-2xl font-bold text-white">
              {streak}
            </Text>
            <Text className="mt-0.5 text-xs text-neutral-600">days</Text>
          </View>
          <View className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <Text className="text-xs uppercase tracking-wide text-neutral-500">
              Longest Streak
            </Text>
            <Text className="mt-1 text-2xl font-bold text-amber-400">
              {longestStreak}
            </Text>
            <Text className="mt-0.5 text-xs text-neutral-600">days</Text>
          </View>
        </View>

        {/* Saver Lamps */}
        <View className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <Text className="text-xs uppercase tracking-wide text-neutral-500">
            Saver Lamps
          </Text>
          <View className="mt-3 flex-row justify-center gap-6">
            {[0, 1, 2].map((i) => (
              <View key={i} className="items-center">
                <Text className="text-3xl">
                  {i < lampsLit ? '\u{1F525}' : '\u{1F4A8}'}
                </Text>
                <Text className="mt-1 text-xs text-neutral-600">
                  {i < lampsLit ? 'Active' : 'Used'}
                </Text>
              </View>
            ))}
          </View>
          <Text className="mt-3 text-center text-xs text-neutral-500">
            {saversRemaining}/3 savers remaining
            {gauntletActive
              ? ` \u00B7 Locked during gauntlet (Day ${gauntletDay}/7)`
              : ''}
          </Text>
        </View>

        <View className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <Text className="text-xs uppercase tracking-wide text-neutral-500">
            Consequence State
          </Text>
          <Text className="mt-2 text-sm text-neutral-300">
            Yield redirect: {redirectPercent}%
          </Text>
          <Text className="mt-1 text-sm text-neutral-300">
            Saver recovery: {saverRecoveryMode ? 'Active' : 'Inactive'}
          </Text>
          <Text className="mt-1 text-sm text-neutral-300">
            Extension total: {extensionDays} day{extensionDays !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Gauntlet status */}
        {gauntletActive && (
          <View className="mt-4 rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
            <Text className="text-sm font-semibold text-purple-400">
              Gauntlet Active
            </Text>
            <Text className="mt-1 text-xs text-neutral-500">
              Day {gauntletDay} of 7 — no savers allowed
            </Text>
          </View>
        )}

        <View className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <Text className="text-xs uppercase tracking-wide text-neutral-500">
            Runtime Audit
          </Text>
          {historyLoading ? (
            <Text className="mt-3 text-sm text-neutral-500">Loading runtime history...</Text>
          ) : historyError ? (
            <Text className="mt-3 text-xs text-amber-300">{historyError}</Text>
          ) : (
            <>
              <Text className="mt-2 text-sm text-neutral-300">
                Burns: {history?.burnCount ?? 0}
                {' \u00B7 '}Misses: {history?.missCount ?? 0}
                {' \u00B7 '}Extensions added: {history?.extensionDaysAdded ?? 0} day
                {(history?.extensionDaysAdded ?? 0) === 1 ? '' : 's'}
              </Text>
              {history?.events.length ? (
                history.events.map((event) => {
                  const saversBefore =
                    event.saverCountBefore == null ? null : Math.max(0, 3 - event.saverCountBefore);
                  const saversAfter =
                    event.saverCountAfter == null ? null : Math.max(0, 3 - event.saverCountAfter);
                  const extensionDelta =
                    event.extensionDaysBefore != null && event.extensionDaysAfter != null
                      ? Math.max(0, event.extensionDaysAfter - event.extensionDaysBefore)
                      : 0;

                  return (
                    <View
                      key={event.eventId}
                      className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                    >
                      <View className="flex-row items-center justify-between">
                        <Text className="text-sm font-semibold text-white">
                          {renderEventTitle(event)}
                        </Text>
                        <Text className="text-xs text-neutral-500">
                          {renderEventRelayStatus(event)}
                        </Text>
                      </View>
                      <Text className="mt-1 text-xs text-neutral-600">
                        {new Date(event.occurredAt).toLocaleString()}
                        {event.eventDay ? ` \u00B7 Day ${event.eventDay}` : ''}
                      </Text>
                      {event.eventType === 'FUEL_BURN' ? (
                        <Text className="mt-3 text-sm text-neutral-300">
                          Fuel: {event.fuelBefore ?? '--'} {'\u2192'} {event.fuelAfter ?? '--'}
                        </Text>
                      ) : (
                        <>
                          <Text className="mt-3 text-sm text-neutral-300">
                            Savers remaining: {saversBefore ?? '--'} {'\u2192'} {saversAfter ?? '--'}
                          </Text>
                          <Text className="mt-1 text-sm text-neutral-300">
                            Redirect: {Math.round((event.redirectBpsBefore ?? 0) / 100)}%
                            {'\u2192'}
                            {Math.round((event.redirectBpsAfter ?? 0) / 100)}%
                          </Text>
                          <Text className="mt-1 text-sm text-neutral-300">
                            Extension: +{extensionDelta} day{extensionDelta === 1 ? '' : 's'}
                          </Text>
                        </>
                      )}
                      {event.lockVaultTransactionSignature ? (
                        <Text className="mt-2 text-xs text-neutral-600">
                          Tx: {event.lockVaultTransactionSignature.slice(0, 12)}...
                        </Text>
                      ) : null}
                      {event.lockVaultLastError ? (
                        <Text className="mt-2 text-xs text-amber-300">
                          {event.lockVaultLastError}
                        </Text>
                      ) : null}
                    </View>
                  );
                })
              ) : (
                <Text className="mt-3 text-sm text-neutral-500">
                  No runtime events recorded yet.
                </Text>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
