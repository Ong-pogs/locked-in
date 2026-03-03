import { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTokenStore, useBrewStore } from '@/stores';
import { BREW_MODE_LIST, type BrewModeId } from '@/types';

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function AlchemyScreen() {
  const navigation = useNavigation();
  const { fullTokens, fragments, dailyEarned, walletCap, spendTokens } = useTokenStore();
  const brew = useBrewStore();
  const [selectedMode, setSelectedMode] = useState<BrewModeId>('slow');
  const [remainingMs, setRemainingMs] = useState(0);
  const [progress, setProgress] = useState(0);
  const [accrued, setAccrued] = useState(0);

  // Tick timer every second while brewing
  useEffect(() => {
    if (brew.status !== 'BREWING') return;
    const tick = () => {
      brew.tickBrew();
      setRemainingMs(brew.getRemainingMs());
      setProgress(brew.getProgress());
      setAccrued(brew.getCurrentIchorAccrued());
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [brew.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirmBrew = useCallback(() => {
    const mode = BREW_MODE_LIST.find((m) => m.id === selectedMode);
    if (!mode) return;
    if (!spendTokens(mode.cost)) return;
    brew.startBrew(selectedMode);
  }, [selectedMode, spendTokens, brew]);

  const handleCancel = useCallback(() => {
    brew.cancelBrew();
  }, [brew]);

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">Brew Ichor</Text>
        <Text className="mt-1 text-sm text-neutral-500">
          Transmute M-Tokens into Ichor
        </Text>

        {/* Status card */}
        <View className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <View className="flex-row justify-between">
            <View>
              <Text className="text-xs uppercase tracking-wide text-neutral-500">Current Brew</Text>
              <Text className="mt-1 text-base font-semibold text-white">
                {brew.status === 'BREWING' && brew.activeModeId
                  ? BREW_MODE_LIST.find((m) => m.id === brew.activeModeId)?.label ?? 'None'
                  : 'None'}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-xs uppercase tracking-wide text-neutral-500">Ichor Balance</Text>
              <Text className="mt-1 text-base font-bold text-emerald-400">
                {Math.floor(brew.ichorBalance)}
              </Text>
            </View>
          </View>
        </View>

        {brew.status === 'BREWING' ? (
          /* ── BREWING STATE ── */
          <View className="mt-4">
            <View className="rounded-xl border border-amber-800 bg-amber-950/30 p-5">
              <Text className="text-center text-lg font-bold text-amber-400">
                {BREW_MODE_LIST.find((m) => m.id === brew.activeModeId)?.symbol}{' '}
                {BREW_MODE_LIST.find((m) => m.id === brew.activeModeId)?.label}
              </Text>

              {/* Countdown */}
              <Text className="mt-4 text-center text-3xl font-bold text-white">
                {formatTime(remainingMs)}
              </Text>
              <Text className="mt-1 text-center text-xs text-neutral-500">remaining</Text>

              {/* Progress bar */}
              <View className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800">
                <View
                  className="h-full rounded-full bg-amber-500"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </View>

              {/* Ichor accruing */}
              <Text className="mt-4 text-center text-sm text-neutral-400">
                Ichor accumulating:
              </Text>
              <Text className="mt-1 text-center text-xl font-bold text-emerald-400">
                +{accrued}
              </Text>

              {/* Cancel */}
              <Pressable
                className="mt-5 rounded-lg border border-red-900 bg-red-950/30 py-3"
                onPress={handleCancel}
              >
                <Text className="text-center text-sm font-semibold text-red-400">
                  Cancel Brew
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          /* ── IDLE STATE ── */
          <View className="mt-4">
            {/* Brew mode cards */}
            {BREW_MODE_LIST.map((mode) => {
              const isSelected = selectedMode === mode.id;
              const canAfford = fullTokens >= mode.cost;
              return (
                <Pressable
                  key={mode.id}
                  onPress={() => canAfford && setSelectedMode(mode.id)}
                  className={`mt-3 rounded-xl border p-4 ${
                    isSelected
                      ? 'border-amber-500 bg-amber-950/30'
                      : 'border-neutral-700 bg-neutral-900'
                  } ${!canAfford ? 'opacity-40' : ''}`}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-3">
                      <Text className="text-2xl">{mode.symbol}</Text>
                      <View>
                        <Text className={`text-base font-semibold ${isSelected ? 'text-amber-400' : 'text-white'}`}>
                          {mode.label}
                        </Text>
                        <Text className="text-xs text-neutral-500">
                          {mode.durationLabel} &middot; {mode.cost}M token
                        </Text>
                      </View>
                    </View>
                    <View className="items-end">
                      <Text className="text-sm font-bold text-emerald-400">
                        {mode.ichorPerHour}/hr
                      </Text>
                      {mode.bonusPercent > 0 && (
                        <Text className="text-xs text-amber-400">
                          +{mode.bonusPercent}% rate
                        </Text>
                      )}
                    </View>
                  </View>
                  <Text className="mt-2 text-xs text-neutral-500">
                    Total: {Math.round(mode.ichorPerHour * (mode.durationMs / (60 * 60 * 1000)))} Ichor
                  </Text>
                </Pressable>
              );
            })}

            {/* Confirm button */}
            <Pressable
              className={`mt-5 rounded-xl py-4 ${
                fullTokens >= (BREW_MODE_LIST.find((m) => m.id === selectedMode)?.cost ?? 1)
                  ? 'bg-purple-700'
                  : 'bg-neutral-800'
              }`}
              onPress={handleConfirmBrew}
              disabled={fullTokens < (BREW_MODE_LIST.find((m) => m.id === selectedMode)?.cost ?? 1)}
            >
              <Text className="text-center text-base font-bold text-white">
                CONFIRM BREW
              </Text>
            </Pressable>
          </View>
        )}

        {/* M Token balance footer */}
        <View className="mt-6 mb-8 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <Text className="text-center text-2xl font-bold text-emerald-400">
            {fullTokens} M
          </Text>
          <Text className="mt-1 text-center text-xs text-neutral-500">
            Fragments: {fragments.toFixed(2)} | Today: {dailyEarned.toFixed(1)}/1.0 | Cap: {fullTokens}/{walletCap}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
