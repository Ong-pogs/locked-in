import { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useCourseStore } from '@/stores/courseStore';
import { BREW_MODE_LIST, type BrewModeId } from '@/types';

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getMode(modeId: string | null) {
  return BREW_MODE_LIST.find((mode) => mode.id === modeId) ?? null;
}

export function AlchemyScreen() {
  const navigation = useNavigation();
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const startBrewForCourse = useCourseStore((s) => s.startBrewForCourse);
  const tickBrewForCourse = useCourseStore((s) => s.tickBrewForCourse);
  const cancelBrewForCourse = useCourseStore((s) => s.cancelBrewForCourse);
  const [selectedMode, setSelectedMode] = useState<BrewModeId>('slow');
  const [now, setNow] = useState(() => Date.now());

  const activeState = activeCourseId ? courseStates[activeCourseId] ?? null : null;
  const activeMode = getMode(activeState?.brewModeId ?? null);
  const fuelBalance = activeState?.fuelCounter ?? 0;
  const fuelCap = activeState?.fuelCap ?? 7;
  const gauntletActive = activeState?.gauntletActive ?? true;
  const brewStatus = activeState?.brewStatus ?? 'IDLE';
  const ichorBalance = activeState?.ichorBalance ?? 0;
  const canBrew = fuelBalance > 0 && !gauntletActive;

  useEffect(() => {
    if (!activeCourseId || brewStatus !== 'BREWING') {
      return;
    }

    const tick = () => {
      setNow(Date.now());
      tickBrewForCourse(activeCourseId);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeCourseId, brewStatus, tickBrewForCourse]);

  const remainingMs = useMemo(() => {
    if (brewStatus !== 'BREWING' || !activeState?.brewEndsAt) {
      return 0;
    }

    return Math.max(0, new Date(activeState.brewEndsAt).getTime() - now);
  }, [activeState?.brewEndsAt, brewStatus, now]);

  const progress = useMemo(() => {
    if (
      brewStatus !== 'BREWING' ||
      !activeState?.brewStartedAt ||
      !activeState?.brewEndsAt
    ) {
      return 0;
    }

    const start = new Date(activeState.brewStartedAt).getTime();
    const end = new Date(activeState.brewEndsAt).getTime();
    const total = end - start;
    if (total <= 0) return 1;

    return Math.min(1, Math.max(0, (now - start) / total));
  }, [activeState?.brewEndsAt, activeState?.brewStartedAt, brewStatus, now]);

  const accrued = useMemo(() => {
    if (brewStatus !== 'BREWING' || !activeState?.brewStartedAt || !activeMode) {
      return 0;
    }

    const elapsedHours =
      Math.max(0, now - new Date(activeState.brewStartedAt).getTime()) /
      (60 * 60 * 1000);

    return Math.floor(activeMode.ichorPerHour * elapsedHours);
  }, [activeMode, activeState?.brewStartedAt, brewStatus, now]);

  const handleConfirmBrew = useCallback(() => {
    if (!activeCourseId || !canBrew || brewStatus === 'BREWING') {
      return;
    }

    startBrewForCourse(activeCourseId, selectedMode);
  }, [activeCourseId, brewStatus, canBrew, selectedMode, startBrewForCourse]);

  const handleCancel = useCallback(() => {
    if (!activeCourseId) {
      return;
    }

    cancelBrewForCourse(activeCourseId);
  }, [activeCourseId, cancelBrewForCourse]);

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView className="flex-1 px-6 pt-4">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="text-neutral-400">{'\u2190'} Back</Text>
        </Pressable>

        <Text className="mt-4 text-2xl font-bold text-white">Brew Ichor</Text>
        <Text className="mt-1 text-sm text-neutral-500">
          Fuel powers the Brewer. Ichor accrues while the brew is active.
        </Text>

        <View className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <View className="flex-row justify-between">
            <View>
              <Text className="text-xs uppercase tracking-wide text-neutral-500">
                Current Brew
              </Text>
              <Text className="mt-1 text-base font-semibold text-white">
                {brewStatus === 'BREWING' && activeMode ? activeMode.label : 'None'}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-xs uppercase tracking-wide text-neutral-500">
                Ichor Balance
              </Text>
              <Text className="mt-1 text-base font-bold text-emerald-400">
                {Math.floor(ichorBalance)}
              </Text>
            </View>
          </View>

          <View className="mt-4 flex-row justify-between">
            <View>
              <Text className="text-xs uppercase tracking-wide text-neutral-500">
                Fuel
              </Text>
              <Text className="mt-1 text-base font-bold text-orange-400">
                {fuelBalance}/{fuelCap}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-xs uppercase tracking-wide text-neutral-500">
                Brewer
              </Text>
              <Text className="mt-1 text-base font-semibold text-white">
                {gauntletActive ? 'Locked' : canBrew ? 'Ready' : 'Stopped'}
              </Text>
            </View>
          </View>
        </View>

        {brewStatus === 'BREWING' ? (
          <View className="mt-4">
            <View className="rounded-xl border border-amber-800 bg-amber-950/30 p-5">
              <Text className="text-center text-lg font-bold text-amber-400">
                {activeMode?.symbol} {activeMode?.label ?? 'Active Brew'}
              </Text>

              <Text className="mt-4 text-center text-3xl font-bold text-white">
                {formatTime(remainingMs)}
              </Text>
              <Text className="mt-1 text-center text-xs text-neutral-500">remaining</Text>

              <View className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800">
                <View
                  className="h-full rounded-full bg-amber-500"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </View>

              <Text className="mt-4 text-center text-sm text-neutral-400">
                Ichor accumulating:
              </Text>
              <Text className="mt-1 text-center text-xl font-bold text-emerald-400">
                +{accrued}
              </Text>

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
          <View className="mt-4">
            {BREW_MODE_LIST.map((mode) => {
              const isSelected = selectedMode === mode.id;
              return (
                <Pressable
                  key={mode.id}
                  onPress={() => canBrew && setSelectedMode(mode.id)}
                  className={`mt-3 rounded-xl border p-4 ${
                    isSelected
                      ? 'border-amber-500 bg-amber-950/30'
                      : 'border-neutral-700 bg-neutral-900'
                  } ${!canBrew ? 'opacity-40' : ''}`}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-3">
                      <Text className="text-2xl">{mode.symbol}</Text>
                      <View>
                        <Text
                          className={`text-base font-semibold ${
                            isSelected ? 'text-amber-400' : 'text-white'
                          }`}
                        >
                          {mode.label}
                        </Text>
                        <Text className="text-xs text-neutral-500">
                          {mode.durationLabel}
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

            <Pressable
              className={`mt-5 rounded-xl py-4 ${
                canBrew ? 'bg-purple-700' : 'bg-neutral-800'
              }`}
              onPress={handleConfirmBrew}
              disabled={!canBrew}
            >
              <Text className="text-center text-base font-bold text-white">
                {gauntletActive
                  ? 'GAUNTLET LOCKED'
                  : fuelBalance <= 0
                    ? 'FUEL REQUIRED'
                    : 'CONFIRM BREW'}
              </Text>
            </Pressable>
          </View>
        )}

        <View className="mb-8 mt-6 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <Text className="text-center text-sm text-neutral-500">
            Fuel is the brewing resource for this course.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
