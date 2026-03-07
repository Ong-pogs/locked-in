import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PublicKey } from '@solana/web3.js';
import type { MainStackParamList, OnboardingStackParamList } from '@/navigation/types';
import {
  connection,
  buildLockFundsTransaction,
  fetchLockAccountSnapshot,
  fetchWalletDepositBalances,
  hasLockVaultConfig,
  signTransaction,
  type LockDurationDays,
} from '@/services/solana';
import { SendTransactionError } from '@solana/web3.js';
import { useCourseStore, useUserStore } from '@/stores';
import { defaultCourseLockPolicyForDifficulty } from '@/types';

type SharedDepositParamList = OnboardingStackParamList & MainStackParamList;
type Nav = NativeStackNavigationProp<SharedDepositParamList, 'Deposit'>;
type DepositRoute = RouteProp<SharedDepositParamList, 'Deposit'>;

const LOCK_DURATIONS: LockDurationDays[] = [14, 30, 45, 60, 90, 180, 365];
const PRINCIPAL_PRESETS = [1, 5, 10, 25, 50, 100, 250, 500];
const MIN_RENT_SOL_BUFFER = 0.01;
const LAMPORTS_PER_SOL = 1_000_000_000;

function inferLockDurationDays(params: {
  lockStartDate: string;
  lockEndDate: string;
  extensionDays: number;
}): LockDurationDays {
  const startMs = new Date(params.lockStartDate).getTime();
  const endMs = new Date(params.lockEndDate).getTime();
  const totalDays = Math.max(
    14,
    Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) - params.extensionDays,
  );

  const exactMatch = LOCK_DURATIONS.find((duration) => duration === totalDays);
  if (exactMatch) {
    return exactMatch;
  }

  const closestLowerMatch = [...LOCK_DURATIONS]
    .reverse()
    .find((duration) => duration <= totalDays);

  return closestLowerMatch ?? 14;
}

export function DepositScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DepositRoute>();
  const walletAddress = useUserStore((s) => s.walletAddress);
  const walletAuthToken = useUserStore((s) => s.walletAuthToken);
  const completeGauntlet = useUserStore((s) => s.completeGauntlet);
  const activateCourse = useCourseStore((s) => s.activateCourse);
  const deactivateCourse = useCourseStore((s) => s.deactivateCourse);
  const syncLockSnapshot = useCourseStore((s) => s.syncLockSnapshot);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const course = useMemo(
    () => courses.find((entry) => entry.id === route.params.courseId) ?? null,
    [courses, route.params.courseId],
  );
  const courseLockPolicy = useMemo(
    () =>
      course?.lockPolicy ??
      defaultCourseLockPolicyForDifficulty(course?.difficulty ?? 'beginner'),
    [course],
  );
  const availableLockDurations = useMemo(
    () =>
      LOCK_DURATIONS.filter(
        (duration) =>
          duration >= courseLockPolicy.minLockDurationDays &&
          duration <= courseLockPolicy.maxLockDurationDays,
      ),
    [courseLockPolicy],
  );
  const policyConfigMessage = useMemo(() => {
    if (availableLockDurations.length > 0) {
      return null;
    }

    return 'This course policy does not overlap with the current on-chain lock presets yet.';
  }, [availableLockDurations]);
  const principalPresets = useMemo(() => {
    const maximumPrincipal = courseLockPolicy.maxPrincipalAmountUi
      ? Number(courseLockPolicy.maxPrincipalAmountUi)
      : null;
    const nextValues = new Set<number>(PRINCIPAL_PRESETS);
    nextValues.add(Number(courseLockPolicy.minPrincipalAmountUi));
    if (courseLockPolicy.demoPrincipalAmountUi) {
      nextValues.add(Number(courseLockPolicy.demoPrincipalAmountUi));
    }
    if (maximumPrincipal != null) {
      nextValues.add(maximumPrincipal);
    }

    return Array.from(nextValues)
      .filter((value) => Number.isFinite(value) && value > 0)
      .filter((value) => maximumPrincipal == null || value <= maximumPrincipal)
      .sort((a, b) => a - b);
  }, [
    courseLockPolicy.demoPrincipalAmountUi,
    courseLockPolicy.maxPrincipalAmountUi,
    courseLockPolicy.minPrincipalAmountUi,
  ]);

  const [lockDuration, setLockDuration] = useState<LockDurationDays>(30);
  const [principalAmount, setPrincipalAmount] = useState('1');
  const [skrAmount, setSkrAmount] = useState('0');
  const [balances, setBalances] = useState<{ stable: string; skr: string; sol: string }>({
    stable: '0',
    skr: '0',
    sol: '0',
  });
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
  const [isRestoringExistingLock, setIsRestoringExistingLock] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [configMessage, setConfigMessage] = useState<string | null>(null);

  const navigateToCourseEntry = () => {
    const routeNames = navigation.getState().routeNames;
    if (routeNames.includes('DungeonHome')) {
      navigation.navigate('DungeonHome');
    }
  };

  useEffect(() => {
    if (!hasLockVaultConfig()) {
      setConfigMessage(
        'LockVault env config is missing. Add the program ID and mint addresses before using real deposits.',
      );
      return;
    }

    setConfigMessage(null);
  }, []);

  useEffect(() => {
    setLockDuration((current) => {
      if (availableLockDurations.includes(current)) {
        return current;
      }

      return availableLockDurations[0] ?? 30;
    });
  }, [availableLockDurations]);

  useEffect(() => {
    setPrincipalAmount((current) => {
      const nextMin = Number(courseLockPolicy.minPrincipalAmountUi);
      const nextMax = courseLockPolicy.maxPrincipalAmountUi
        ? Number(courseLockPolicy.maxPrincipalAmountUi)
        : null;
      const currentValue = Number(current);

      if (!current || !Number.isFinite(currentValue)) {
        return courseLockPolicy.minPrincipalAmountUi;
      }

      if (currentValue < nextMin) {
        return courseLockPolicy.minPrincipalAmountUi;
      }

      if (nextMax != null && currentValue > nextMax) {
        return courseLockPolicy.maxPrincipalAmountUi ?? current;
      }

      return current;
    });
  }, [
    courseLockPolicy.maxPrincipalAmountUi,
    courseLockPolicy.minPrincipalAmountUi,
  ]);

  useEffect(() => {
    if (!walletAddress || !hasLockVaultConfig()) {
      return;
    }

    let cancelled = false;
    setIsRefreshingBalances(true);

    void fetchWalletDepositBalances(walletAddress)
      .then((nextBalances) => {
        if (cancelled) return;
        setBalances({
          stable: nextBalances.stableBalanceUi,
          skr: nextBalances.skrBalanceUi,
          sol: nextBalances.solBalanceUi,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'Unable to load wallet balances.';
        setStatusMessage(message);
      })
      .finally(() => {
        if (cancelled) return;
        setIsRefreshingBalances(false);
      });

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress || !hasLockVaultConfig()) {
      return;
    }

    let cancelled = false;
    setIsRestoringExistingLock(true);
    setStatusMessage('Checking for an existing on-chain lock...');

    void fetchLockAccountSnapshot({
      ownerAddress: walletAddress,
      courseId: route.params.courseId,
    })
      .then((snapshot) => {
        if (cancelled) return;

        const inferredDuration = inferLockDurationDays({
          lockStartDate: snapshot.lockStartDate,
          lockEndDate: snapshot.lockEndDate,
          extensionDays: snapshot.extensionDays,
        });

        activateCourse(route.params.courseId, {
          amount: Number(snapshot.principalAmountUi),
          duration: inferredDuration,
          lockAccountAddress: snapshot.lockAccountAddress,
          skrAmount: Number(snapshot.skrLockedAmountUi),
        });
        syncLockSnapshot(route.params.courseId, snapshot);

        if (snapshot.gauntletComplete) {
          completeGauntlet();
          setStatusMessage('Existing lock found on-chain. Resuming your course...');
          navigateToCourseEntry();
          return;
        }
        completeGauntlet();
        setStatusMessage('Existing lock found on-chain. Entering the dungeon...');
        navigateToCourseEntry();
      })
      .catch((error) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'Unable to read the lock account.';

        if (message.includes('No LockVault account was found')) {
          if (courseStates[route.params.courseId]?.lockAccountAddress) {
            deactivateCourse(route.params.courseId);
          }
          setStatusMessage(null);
          return;
        }

        setStatusMessage(message);
      })
      .finally(() => {
        if (cancelled) return;
        setIsRestoringExistingLock(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activateCourse,
    courseStates,
    completeGauntlet,
    deactivateCourse,
    navigation,
    route.params.courseId,
    syncLockSnapshot,
    walletAddress,
  ]);

  const handleDeposit = async () => {
    if (!walletAddress || !walletAuthToken) {
      setStatusMessage('Connect your wallet again before creating a lock.');
      return;
    }

    if (!hasLockVaultConfig()) {
      setStatusMessage(
        'LockVault env config is missing. Add the program ID and mint addresses first.',
      );
      return;
    }

    if (availableLockDurations.length === 0) {
      setStatusMessage(
        'This course policy is not compatible with the current on-chain lock presets yet.',
      );
      return;
    }

    try {
      setIsSubmitting(true);

      const requestedStable = Number(principalAmount);
      if (!Number.isFinite(requestedStable) || requestedStable <= 0) {
        throw new Error('Enter a valid USDC amount before creating the lock.');
      }

      const minimumPrincipal = Number(courseLockPolicy.minPrincipalAmountUi);
      const demoPrincipalOverride = courseLockPolicy.demoPrincipalAmountUi
        ? Number(courseLockPolicy.demoPrincipalAmountUi)
        : null;
      const isDemoPrincipalOverride =
        demoPrincipalOverride != null && requestedStable === demoPrincipalOverride;
      if (requestedStable < minimumPrincipal && !isDemoPrincipalOverride) {
        throw new Error(
          `This course requires at least ${courseLockPolicy.minPrincipalAmountUi} USDC to start.`,
        );
      }

      const maximumPrincipal = courseLockPolicy.maxPrincipalAmountUi
        ? Number(courseLockPolicy.maxPrincipalAmountUi)
        : null;
      if (maximumPrincipal != null && requestedStable > maximumPrincipal) {
        throw new Error(
          `This course allows up to ${courseLockPolicy.maxPrincipalAmountUi} USDC for a single lock.`,
        );
      }

      if (!availableLockDurations.includes(lockDuration)) {
        throw new Error(
          `This course currently supports ${availableLockDurations.map((duration) => `${duration}d`).join(', ')} lock presets.`,
        );
      }

      const availableStable = Number(balances.stable);
      if (Number.isFinite(requestedStable) && requestedStable > availableStable) {
        throw new Error(
          `Wallet has ${balances.stable} USDC available, which is below the requested deposit of ${principalAmount} USDC.`,
        );
      }

      const requestedSkr = Number(skrAmount || '0');
      const availableSkr = Number(balances.skr);
      if (Number.isFinite(requestedSkr) && requestedSkr > availableSkr) {
        throw new Error(
          `Wallet has ${balances.skr} SKR available, which is below the requested lock amount of ${skrAmount} SKR.`,
        );
      }

      const walletLamports = await connection.getBalance(
        new PublicKey(walletAddress),
        'confirmed',
      );
      if (walletLamports < MIN_RENT_SOL_BUFFER * LAMPORTS_PER_SOL) {
        throw new Error(
          `Wallet needs at least ~${MIN_RENT_SOL_BUFFER.toFixed(2)} SOL to pay rent for the lock accounts.`,
        );
      }

      setStatusMessage('Building lock transaction...');

      const buildResult = await buildLockFundsTransaction({
        ownerAddress: walletAddress,
        courseId: route.params.courseId,
        stableAmountUi: principalAmount,
        skrAmountUi: skrAmount,
        lockDurationDays: lockDuration,
      });

      setStatusMessage('Simulating transaction...');
      try {
        await connection.simulateTransaction(buildResult.transaction);
      } catch (error) {
        if (error instanceof SendTransactionError) {
          const simulationLogs = error.logs?.slice(-6).join(' | ');
          throw new Error(
            simulationLogs
              ? `Deposit simulation failed: ${simulationLogs}`
              : 'Deposit simulation failed before wallet approval. Check the wallet balances and token accounts.',
          );
        }
        throw error;
      }

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

      setStatusMessage('Confirming transaction on-chain...');
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) {
        throw new Error(
          `Deposit transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`,
        );
      }

      const confirmedLockSnapshot = await fetchLockAccountSnapshot({
        ownerAddress: walletAddress,
        courseId: route.params.courseId,
      });
      const confirmedDuration = inferLockDurationDays({
        lockStartDate: confirmedLockSnapshot.lockStartDate,
        lockEndDate: confirmedLockSnapshot.lockEndDate,
        extensionDays: confirmedLockSnapshot.extensionDays,
      });

      activateCourse(route.params.courseId, {
        amount: Number(confirmedLockSnapshot.principalAmountUi),
        duration: confirmedDuration,
        lockAccountAddress: confirmedLockSnapshot.lockAccountAddress,
        stableMintAddress: buildResult.stableMintAddress,
        skrAmount: Number(confirmedLockSnapshot.skrLockedAmountUi),
      });
      syncLockSnapshot(route.params.courseId, confirmedLockSnapshot);
      completeGauntlet();
      navigateToCourseEntry();

      setStatusMessage(`Lock created: ${signature.slice(0, 8)}...`);

      void fetchWalletDepositBalances(walletAddress).then((nextBalances) => {
        setBalances({
          stable: nextBalances.stableBalanceUi,
          skr: nextBalances.skrBalanceUi,
          sol: nextBalances.solBalanceUi,
        });
      });
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : 'Unable to create the lock transaction.';
      const message = rawMessage.includes('Transaction simulation failed')
        ? `${rawMessage} Phantom showing "Unknown" is expected on devnet for this custom program.`
        : rawMessage;
      setStatusMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 32,
          paddingBottom: 48,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-2xl font-bold text-white">Lock Your Funds</Text>
        <Text className="mt-2 text-neutral-400">
          {course?.title ?? 'Selected Course'}
        </Text>
        <Text className="mt-1 text-sm text-neutral-500">
          Create the on-chain lock that starts the gauntlet.
        </Text>

        <View className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
          <Text className="text-xs uppercase tracking-[2px] text-neutral-500">
            Course Lock Policy
          </Text>
          <View className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-4">
            <Text className="text-sm text-neutral-300">
              Minimum deposit: {courseLockPolicy.minPrincipalAmountUi} USDC
            </Text>
            <Text className="mt-1 text-sm text-neutral-300">
              Maximum deposit:{' '}
              {courseLockPolicy.maxPrincipalAmountUi
                ? `${courseLockPolicy.maxPrincipalAmountUi} USDC`
                : 'No course max'}
            </Text>
            <Text className="mt-1 text-sm text-neutral-300">
              Demo preset:{' '}
              {courseLockPolicy.demoPrincipalAmountUi
                ? `${courseLockPolicy.demoPrincipalAmountUi} USDC`
                : 'None'}
            </Text>
            <Text className="mt-1 text-sm text-neutral-300">
              Policy duration: {courseLockPolicy.minLockDurationDays}-
              {courseLockPolicy.maxLockDurationDays} days
            </Text>
            <Text className="mt-1 text-sm text-neutral-500">
              Current on-chain presets:{' '}
              {availableLockDurations.length > 0
                ? availableLockDurations.map((duration) => `${duration}d`).join(' / ')
                : 'None yet'}
            </Text>
          </View>

          <Text className="text-xs uppercase tracking-[2px] text-neutral-500">
            Stablecoin
          </Text>
          <View className="mt-3 rounded-xl border border-emerald-500 bg-emerald-500/10 px-4 py-3">
            <Text className="text-center font-semibold text-emerald-300">
              USDC only
            </Text>
          </View>

          <Text className="mt-5 text-xs uppercase tracking-[2px] text-neutral-500">
            Principal Amount
          </Text>
          <TextInput
            className="mt-3 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-lg text-white"
            keyboardType="decimal-pad"
            value={principalAmount}
            onChangeText={setPrincipalAmount}
            placeholder={courseLockPolicy.minPrincipalAmountUi}
            placeholderTextColor="#737373"
          />
          <View className="mt-3 flex-row flex-wrap gap-2">
            {principalPresets.map((value) => {
              const selected = Number(principalAmount) === value;
              return (
                <Pressable
                  key={value}
                  className={`rounded-full border px-3 py-2 ${selected ? 'border-emerald-500 bg-emerald-500/10' : 'border-neutral-700 bg-neutral-950'}`}
                  onPress={() => setPrincipalAmount(String(value))}
                >
                  <Text
                    className={`text-sm font-semibold ${selected ? 'text-emerald-300' : 'text-neutral-300'}`}
                  >
                    {value} USDC
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="mt-2 text-xs text-neutral-500">
            {courseLockPolicy.demoPrincipalAmountUi
              ? `${courseLockPolicy.demoPrincipalAmountUi} USDC stays available as the demo preset for this course.`
              : 'Course minimums apply to all lock amounts.'}
          </Text>

          <Text className="mt-5 text-xs uppercase tracking-[2px] text-neutral-500">
            Optional SKR Amount
          </Text>
          <TextInput
            className="mt-3 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-lg text-white"
            keyboardType="decimal-pad"
            value={skrAmount}
            onChangeText={setSkrAmount}
            placeholder="0"
            placeholderTextColor="#737373"
          />

          <Text className="mt-5 text-xs uppercase tracking-[2px] text-neutral-500">
            Lock Duration
          </Text>
          <View className="mt-3 flex-row gap-3">
            {availableLockDurations.map((duration) => {
              const selected = lockDuration === duration;
              return (
                <Pressable
                  key={duration}
                  className={`flex-1 rounded-xl border px-3 py-3 ${selected ? 'border-sky-500 bg-sky-500/10' : 'border-neutral-700 bg-neutral-950'}`}
                  onPress={() => setLockDuration(duration)}
                >
                  <Text
                    className={`text-center font-semibold ${selected ? 'text-sky-300' : 'text-white'}`}
                  >
                    {duration}d
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View className="mt-6 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-4">
            <Text className="text-xs uppercase tracking-[2px] text-neutral-500">
              Wallet Balances
            </Text>
            <Text className="mt-3 text-sm text-neutral-300">
              USDC: {balances.stable}
            </Text>
            <Text className="mt-1 text-sm text-neutral-300">SKR: {balances.skr}</Text>
            <Text className="mt-1 text-sm text-neutral-300">SOL: {balances.sol}</Text>
            {isRefreshingBalances ? (
              <View className="mt-3 flex-row items-center gap-2">
                <ActivityIndicator size="small" color="#a3a3a3" />
                <Text className="text-xs text-neutral-500">Refreshing balances...</Text>
              </View>
            ) : null}
          </View>
        </View>

        {configMessage ? (
          <View className="mt-5 rounded-xl border border-amber-700 bg-amber-950/40 p-4">
            <Text className="text-sm text-amber-200">{configMessage}</Text>
          </View>
        ) : null}

        {policyConfigMessage ? (
          <View className="mt-5 rounded-xl border border-amber-700 bg-amber-950/40 p-4">
            <Text className="text-sm text-amber-200">{policyConfigMessage}</Text>
          </View>
        ) : null}

        {statusMessage ? (
          <View className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4">
            <Text className="text-sm text-neutral-300">{statusMessage}</Text>
          </View>
        ) : null}

        <Pressable
          className={`mt-6 rounded-xl px-6 py-4 ${isSubmitting || isRestoringExistingLock || Boolean(configMessage) || Boolean(policyConfigMessage) ? 'bg-neutral-700' : 'bg-emerald-600 active:bg-emerald-700'}`}
          disabled={
            isSubmitting ||
            isRestoringExistingLock ||
            Boolean(configMessage) ||
            Boolean(policyConfigMessage)
          }
          onPress={() => {
            void handleDeposit();
          }}
        >
          <Text className="text-center text-lg font-semibold text-white">
            {isRestoringExistingLock
              ? 'Checking Existing Lock...'
              : isSubmitting
                ? 'Creating Lock...'
                : 'Deposit & Start Gauntlet'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
