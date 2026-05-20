'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Minus, Plus } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, useSignTransaction } from '@privy-io/react-auth/solana';
import { useCourseStore, useUserStore } from '@/stores';
import { defaultCourseLockPolicyForDifficulty } from '@/types';
import type { CourseLockPolicy, CourseDifficulty } from '@/types';
import {
  buildLockFundsTransaction,
  hasLockVaultConfig,
  fetchWalletDepositBalances,
  type LockDurationDays as SolanaLockDuration,
} from '@/services/solana';
import { CLUSTER } from '@/services/solana/connection';
import { claimFaucet } from '@/services/api/faucet/faucetApi';
import { fetchWithAuth } from '@/services/api/httpClient';
import { connection } from '@/services/solana/connection';
import { T } from '@/components/theme';
import { CozyCard, CozySectionLabel } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

// Cozy palette constants — match the Sheet prototype exactly
const AMBER = '#FFD580';
const COZY_BORDER = 'rgba(58, 143, 168, 0.45)';
const COZY_TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.85)';

const DIFFICULTY_COLORS: Record<CourseDifficulty, string> = {
  beginner: T.green,
  intermediate: T.teal,
  advanced: T.crimson,
};

const CATEGORY_COLORS: Record<string, string> = {
  solana: T.violet,
  web3: T.teal,
  defi: T.teal,
  security: T.crimson,
  rust: T.rust,
};

// Lock duration presets supported by the on-chain program
type LockDurationDays = 14 | 30 | 45 | 60 | 90 | 180 | 365;
const LOCK_DURATIONS: LockDurationDays[] = [14, 30, 45, 60, 90, 180, 365];
const PRINCIPAL_PRESETS = [1, 5, 10, 25, 50, 100, 250, 500];

const IS_DEVNET = CLUSTER === 'devnet';

// Wrap in Suspense — useSearchParams requires it in Next.js 16
export default function OnboardingDepositPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ backgroundColor: T.bg }}
        >
          <p
            className="font-pixel-mono text-sm"
            style={{ color: T.textSecondary }}
          >
            Loading...
          </p>
        </div>
      }
    >
      <DepositContent />
    </Suspense>
  );
}

function DepositContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const courseId = searchParams.get('courseId') ?? '';
  const walletAddress = useUserStore((s) => s.walletAddress);
  const activateCourse = useCourseStore((s) => s.activateCourse);
  const courses = useCourseStore((s) => s.courses);
  const { user: privyUser } = usePrivy();
  const { wallets: solanaWallets } = useWallets();
  const { signTransaction: privySignTransaction } = useSignTransaction();

  // Pick the right wallet: Google users → embedded, wallet users → external
  const isGoogleUser = !!privyUser?.google;
  const isEmbedded = (w: (typeof solanaWallets)[number]) =>
    'isPrivyWallet' in w.standardWallet && !!(w.standardWallet as Record<string, unknown>).isPrivyWallet;
  const activeWallet = isGoogleUser
    ? (solanaWallets.find(isEmbedded) ?? null)
    : (solanaWallets.find((w) => !isEmbedded(w)) ?? null);

  // Wallet balances
  const [balances, setBalances] = useState<{ stableBalanceUi: string; skrBalanceUi: string; solBalanceUi: string } | null>(null);

  // Fetch wallet balances on mount
  useEffect(() => {
    if (!walletAddress || !hasLockVaultConfig()) return;
    fetchWalletDepositBalances(walletAddress)
      .then(setBalances)
      .catch(() => setBalances(null));
  }, [walletAddress]);

  const course = useMemo(
    () => courses.find((c) => c.id === courseId) ?? null,
    [courses, courseId],
  );

  // Guard: never let the user lock funds against a missing or unknown
  // courseId. Without this, /onboarding/deposit?courseId=anything would
  // render and call activateCourse('', ...) — corrupting the store under
  // key "". Wait until the courses array has loaded so we don't bounce
  // on a transient empty list.
  useEffect(() => {
    if (!courseId) {
      router.replace('/courses');
      return;
    }
    if (courses.length > 0 && !course) {
      router.replace('/courses');
    }
  }, [courseId, course, courses.length, router]);

  // Resolve lock policy from course or defaults
  const courseLockPolicy: CourseLockPolicy = useMemo(
    () =>
      course?.lockPolicy ??
      defaultCourseLockPolicyForDifficulty(course?.difficulty ?? 'beginner'),
    [course],
  );

  // Filter durations to what the policy allows
  const availableLockDurations = useMemo(
    () =>
      LOCK_DURATIONS.filter(
        (d) =>
          d >= courseLockPolicy.minLockDurationDays &&
          d <= courseLockPolicy.maxLockDurationDays,
      ),
    [courseLockPolicy],
  );

  // Build principal presets including policy-specific values
  const principalPresets = useMemo(() => {
    const max = courseLockPolicy.maxPrincipalAmountUi
      ? Number(courseLockPolicy.maxPrincipalAmountUi)
      : null;
    const values = new Set<number>(PRINCIPAL_PRESETS);
    values.add(Number(courseLockPolicy.minPrincipalAmountUi));
    if (courseLockPolicy.demoPrincipalAmountUi) {
      values.add(Number(courseLockPolicy.demoPrincipalAmountUi));
    }
    if (max != null) values.add(max);

    return Array.from(values)
      .filter((v) => Number.isFinite(v) && v > 0)
      .filter((v) => max == null || v <= max)
      .sort((a, b) => a - b);
  }, [courseLockPolicy]);

  const [lockDuration, setLockDuration] = useState<LockDurationDays>(30);
  const [principalAmount, setPrincipalAmount] = useState('1');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Faucet state
  const [faucetClaiming, setFaucetClaiming] = useState(false);
  const [faucetClaimed, setFaucetClaimed] = useState(false);
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);

  const faucetDisabled = faucetClaiming || faucetClaimed;

  const handleClaimFaucet = async () => {
    setFaucetClaiming(true);
    setFaucetMessage(null);
    try {
      const resp = await fetchWithAuth((token) => claimFaucet(token));
      if (!resp) {
        setFaucetMessage('Connect wallet first.');
        setFaucetClaiming(false);
        return;
      }
      if (!resp.claimed) {
        setFaucetClaimed(true);
        setFaucetMessage(resp.message ?? 'Already claimed.');
        setFaucetClaiming(false);
        return;
      }
      const parts: string[] = [];
      if (resp.sol.signature) parts.push(`${resp.sol.amountSol} SOL`);
      if (resp.sol.error) parts.push(`SOL skipped`);
      parts.push(`${resp.usdc.amountUsdc} USDC`);
      setFaucetMessage(`Claimed ${parts.join(' + ')}!`);
      setFaucetClaimed(true);
      // Refresh wallet balances
      if (walletAddress) {
        fetchWalletDepositBalances(walletAddress)
          .then(setBalances)
          .catch(() => {});
      }
    } catch (err) {
      setFaucetMessage(err instanceof Error ? err.message : 'Claim failed.');
    } finally {
      setFaucetClaiming(false);
    }
  };

  // Clamp lock duration to what the policy allows
  useEffect(() => {
    setLockDuration((current) => {
      if (availableLockDurations.includes(current)) return current;
      return availableLockDurations[0] ?? 30;
    });
  }, [availableLockDurations]);

  // Find nearest preset index for slider — keeps slider in sync if user types a custom amount
  const sliderIdx = useMemo(() => {
    const amountNum = Number(principalAmount) || 0;
    const exact = principalPresets.findIndex((p) => p === amountNum);
    if (exact >= 0) return exact;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < principalPresets.length; i++) {
      const d = Math.abs(principalPresets[i] - amountNum);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    return nearest;
  }, [principalAmount, principalPresets]);

  // Build on-chain lock transaction, sign with wallet, send to network
  const handleDeposit = async () => {
    if (isSubmitting) return; // Guard against double-click
    setIsSubmitting(true);

    try {
      if (!walletAddress) {
        setStatusMessage('Connect your wallet before creating a lock.');
        return;
      }

      if (!/^\d+\.?\d{0,6}$/.test(principalAmount.trim())) {
        setStatusMessage('Enter a valid amount (up to 6 decimal places).');
        return;
      }

      const amount = Number(principalAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setStatusMessage('Enter a valid USDC amount.');
        return;
      }

      const min = Number(courseLockPolicy.minPrincipalAmountUi);
      const max = courseLockPolicy.maxPrincipalAmountUi
        ? Number(courseLockPolicy.maxPrincipalAmountUi)
        : null;
      const demo = courseLockPolicy.demoPrincipalAmountUi
        ? Number(courseLockPolicy.demoPrincipalAmountUi)
        : null;
      if (amount < min && amount !== demo) {
        setStatusMessage(
          `This course requires at least ${courseLockPolicy.minPrincipalAmountUi} USDC.`,
        );
        return;
      }
      if (max != null && amount > max) {
        setStatusMessage(
          `This course allows at most ${courseLockPolicy.maxPrincipalAmountUi} USDC.`,
        );
        return;
      }

      if (!hasLockVaultConfig()) {
        setStatusMessage('LockVault program not configured. Check env vars.');
        return;
      }

      // Re-validate wallet balance before building transaction
      try {
        const freshBalances = await fetchWalletDepositBalances(walletAddress);
        setBalances(freshBalances);
        const usdcBalance = Number(freshBalances.stableBalanceUi);
        if (usdcBalance < amount) {
          setStatusMessage(`Insufficient USDC. You have ${freshBalances.stableBalanceUi} USDC.`);
          return;
        }
      } catch {
        // If balance fetch fails, proceed with stale balance — the on-chain tx will fail if insufficient
        console.warn('[deposit] Could not re-fetch balance before tx');
      }

      setStatusMessage('Building transaction...');

      // 1. Build the lock transaction (derives PDAs, encodes instruction data)
      const buildResult = await buildLockFundsTransaction({
        ownerAddress: walletAddress,
        courseId,
        stableAmountUi: principalAmount,
        skrAmountUi: '0',
        lockDurationDays: lockDuration as SolanaLockDuration,
      });

      setStatusMessage('Waiting for wallet approval...');

      // 2. Sign via the correct wallet (embedded for Google, external for Phantom)
      const wallet = activeWallet;
      if (!wallet) {
        throw new Error('No Solana wallet available. Please reconnect.');
      }
      const txBytes = buildResult.transaction.serialize({ requireAllSignatures: false });
      const { signedTransaction } = await privySignTransaction({
        transaction: txBytes,
        wallet,
      });

      setStatusMessage('Sending transaction...');

      // 3. Send signed transaction to the network
      const signature = await connection.sendRawTransaction(
        signedTransaction as Buffer,
        { skipPreflight: false, preflightCommitment: 'confirmed' },
      );

      setStatusMessage('Confirming transaction...');

      // 4. Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      // 5. Activate course in store with on-chain lock data
      activateCourse(courseId, {
        amount,
        duration: lockDuration,
        lockAccountAddress: buildResult.lockAccountAddress,
        stableMintAddress: buildResult.stableMintAddress,
        skrAmount: 0,
      });

      setStatusMessage('Lock created successfully!');
      useUserStore.getState().setOnboardingPhase('main');
      // Send the user to /courses so they can confirm their enrollment
      // (now Active) and pick the next move — start the lesson, see other
      // courses, etc. The village hub doesn't add anything actionable here.
      router.push('/courses');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed';
      console.error('[deposit] Lock transaction failed:', error);
      setStatusMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDisabled = isSubmitting;

  const diffColor = DIFFICULTY_COLORS[course?.difficulty ?? 'beginner'];
  const catColor = CATEGORY_COLORS[course?.category ?? 'solana'] ?? T.teal;
  const courseTitle = course?.title ?? 'Selected Course';
  const lessonCount = course?.totalLessons ?? 0;
  const courseTagline =
    course?.description ?? 'Create the on-chain lock to start learning.';

  const amountNum = Number(principalAmount) || 0;

  const handleAmountStep = (delta: number) => {
    const next = Math.max(0, amountNum + delta);
    setPrincipalAmount(String(next));
  };

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Bg layer — vault.png with onError fallback + 3-stop indigo gradient overlay */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/vault/vaultbg.png"
          alt=""
          draggable={false}
          className="w-full h-full object-cover select-none"
          style={{ imageRendering: 'pixelated' }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(14,14,28,0.30) 0%, rgba(14,14,28,0.55) 60%, rgba(14,14,28,0.78) 100%)',
          }}
        />
      </div>

      <HubButton />

      <div className="relative z-10 max-w-[1100px] mx-auto px-[18px] pb-24">
        <div className="pt-20" />

        {/* Course header */}
        <div className="relative mb-6">
          {/* Soft radial scrim — kills the pixel-noise behind the header text
              while letting the vault bg breathe through the rest of the page. */}
          <div
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              top: -16,
              left: -24,
              right: -24,
              bottom: -16,
              background:
                'radial-gradient(ellipse at 30% 50%, rgba(14,14,28,0.93) 0%, rgba(14,14,28,0.78) 45%, rgba(14,14,28,0.32) 75%, rgba(14,14,28,0) 100%)',
              filter: 'blur(2px)',
              zIndex: 0,
            }}
          />
          <div className="relative" style={{ zIndex: 1 }}>
            <h1
              className="font-pixel text-3xl md:text-4xl font-bold tracking-wide mb-3"
              style={{
                color: AMBER,
                textShadow:
                  '0 0 10px rgba(0,0,0,0.95), 0 2px 0 rgba(0,0,0,0.95), 0 4px 12px rgba(0,0,0,0.85)',
              }}
            >
              {courseTitle}
            </h1>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {course?.difficulty && (
                <span
                  className="font-pixel-mono text-[10px] font-bold uppercase tracking-[1.5px] px-2 py-[3px] rounded"
                  style={{
                    color: diffColor,
                    backgroundColor: `${diffColor}22`,
                    border: `1px solid ${diffColor}55`,
                    textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                  }}
                >
                  {course.difficulty}
                </span>
              )}
              {course?.category && (
                <span
                  className="font-pixel-mono text-[10px] font-bold uppercase tracking-[1.5px] px-2 py-[3px] rounded"
                  style={{
                    color: catColor,
                    backgroundColor: `${catColor}22`,
                    border: `1px solid ${catColor}55`,
                    textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                  }}
                >
                  {course.category}
                </span>
              )}
              {lessonCount > 0 && (
                <span
                  className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
                  style={{
                    color: 'rgba(255,255,255,0.78)',
                    textShadow: '0 0 6px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.95)',
                  }}
                >
                  {lessonCount} lessons
                </span>
              )}
            </div>
            <p
              className="font-pixel-mono text-[12px]"
              style={{
                color: 'rgba(255,255,255,0.82)',
                textShadow: '0 0 8px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.95)',
              }}
            >
              {courseTagline}
            </p>
          </div>
        </div>

        {/* Single CozyCard wrapping the whole form */}
        <CozyCard>
          {/* Amount section */}
          <CozySectionLabel>Amount (USDC)</CozySectionLabel>
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => handleAmountStep(-1)}
              className="w-11 h-11 rounded-lg flex items-center justify-center transition-colors hover:brightness-125 cursor-pointer"
              style={{
                backgroundColor: 'rgba(0,0,0,0.35)',
                border: `1px solid ${COZY_BORDER}`,
                color: AMBER,
              }}
              aria-label="Decrease amount"
            >
              <Minus size={18} />
            </button>
            <input
              type="number"
              inputMode="decimal"
              value={principalAmount}
              onChange={(e) => setPrincipalAmount(e.target.value)}
              placeholder={courseLockPolicy.minPrincipalAmountUi}
              aria-label="USDC deposit amount"
              className="font-pixel-mono flex-1 text-center text-2xl font-bold py-2.5 rounded-lg outline-none"
              style={{
                color: AMBER,
                backgroundColor: 'rgba(0,0,0,0.35)',
                border: `1px solid ${COZY_BORDER}`,
                textShadow: COZY_TEXT_SHADOW,
              }}
            />
            <button
              type="button"
              onClick={() => handleAmountStep(1)}
              className="w-11 h-11 rounded-lg flex items-center justify-center transition-colors hover:brightness-125 cursor-pointer"
              style={{
                backgroundColor: 'rgba(0,0,0,0.35)',
                border: `1px solid ${COZY_BORDER}`,
                color: AMBER,
              }}
              aria-label="Increase amount"
            >
              <Plus size={18} />
            </button>
          </div>

          {/* Slider bound to principalPresets */}
          {principalPresets.length > 1 && (
            <div className="mb-3">
              <input
                type="range"
                min={0}
                max={principalPresets.length - 1}
                value={sliderIdx}
                onChange={(e) =>
                  setPrincipalAmount(String(principalPresets[Number(e.target.value)]))
                }
                aria-label="Quick amount slider"
                className="w-full"
                style={{ accentColor: AMBER }}
              />
              <div className="flex justify-between mt-1 px-0.5">
                {principalPresets.map((p) => (
                  <span
                    key={p}
                    className="font-pixel-mono text-[10px]"
                    style={{
                      color: amountNum === p ? AMBER : T.textMuted,
                      textShadow: amountNum === p ? COZY_TEXT_SHADOW : undefined,
                    }}
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Preset pills (highlighted when matching) */}
          <div className="flex flex-wrap gap-1.5 mt-1">
            {principalPresets.map((value) => {
              const selected = amountNum === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPrincipalAmount(String(value))}
                  className="px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors cursor-pointer"
                  style={{
                    fontFamily: 'var(--font-pixel-mono), monospace',
                    border: `1px solid ${selected ? AMBER : COZY_BORDER}`,
                    backgroundColor: selected
                      ? `${AMBER}22`
                      : 'rgba(0,0,0,0.25)',
                    color: selected ? AMBER : T.textSecondary,
                  }}
                >
                  {value}
                </button>
              );
            })}
          </div>

          {/* Duration segmented pill toggle */}
          <div className="mt-5">
            <CozySectionLabel>Duration</CozySectionLabel>
            <div
              className="flex flex-wrap gap-1 p-1 rounded-lg"
              style={{
                backgroundColor: 'rgba(0,0,0,0.35)',
                border: `1px solid ${COZY_BORDER}`,
              }}
              role="radiogroup"
              aria-label="Lock duration"
            >
              {availableLockDurations.map((d) => {
                const sel = lockDuration === d;
                return (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    onClick={() => setLockDuration(d)}
                    className="py-2.5 rounded-md transition-all cursor-pointer flex-1 basis-[calc(25%-3px)] sm:basis-0 min-w-[60px]"
                    style={{
                      fontFamily: 'var(--font-pixel-mono), monospace',
                      backgroundColor: sel ? AMBER : 'transparent',
                      color: sel ? '#1a1408' : T.textPrimary,
                      fontWeight: 700,
                      fontSize: 13,
                      letterSpacing: '1.5px',
                      boxShadow: sel
                        ? `0 0 14px ${AMBER}55, inset 0 1px 0 rgba(255,255,255,0.25)`
                        : 'none',
                    }}
                  >
                    {d}d
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status message — inline */}
          {statusMessage && (
            <div
              className="mt-4 px-3 py-2 rounded-lg"
              style={{
                backgroundColor: 'rgba(0,0,0,0.32)',
                border: `1px solid ${COZY_BORDER}`,
              }}
            >
              <p
                className="font-pixel-mono text-[12px]"
                style={{ color: T.textSecondary }}
              >
                {statusMessage}
              </p>
            </div>
          )}

          {/* Wallet inline strip */}
          <div className="mt-5 mb-4">
            <div
              className="flex items-center justify-center gap-3 px-3 py-2 rounded-lg flex-wrap"
              style={{
                backgroundColor: 'rgba(0,0,0,0.32)',
                border: `1px solid ${COZY_BORDER}`,
              }}
            >
              {[
                { label: 'USDC', value: balances?.stableBalanceUi ?? '...' },
                { label: 'SOL', value: balances?.solBalanceUi ?? '...' },
              ].map((it, i, arr) => (
                <div key={it.label} className="flex items-center gap-1.5">
                  <span
                    className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
                    style={{ color: T.textMuted }}
                  >
                    {it.label}
                  </span>
                  <span
                    className="font-pixel-mono text-[12px] font-bold"
                    style={{ color: AMBER, textShadow: COZY_TEXT_SHADOW }}
                  >
                    {it.value}
                  </span>
                  {i < arr.length - 1 && (
                    <span style={{ color: T.borderDormant }}> · </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Claim Test Tokens — devnet only */}
          {IS_DEVNET && (
            <div className="mb-4 text-center">
              <button
                type="button"
                onClick={handleClaimFaucet}
                disabled={faucetDisabled}
                className="text-[11px] underline-offset-2 hover:underline transition-opacity hover:opacity-80 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  fontFamily: 'var(--font-pixel-mono), monospace',
                  color: faucetClaimed ? T.textMuted : T.teal,
                  letterSpacing: '0.5px',
                }}
              >
                {faucetClaiming
                  ? 'Claiming test tokens...'
                  : faucetClaimed
                    ? 'Test tokens claimed'
                    : 'Need test tokens? Claim Test Tokens →'}
              </button>
              {faucetMessage && (
                <p
                  className="font-pixel-mono text-[10px] mt-1"
                  style={{ color: faucetClaimed ? T.green : AMBER }}
                >
                  {faucetMessage}
                </p>
              )}
            </div>
          )}

          {/* Deposit CTA */}
          <button
            type="button"
            onClick={handleDeposit}
            disabled={isDisabled}
            className="w-full py-3.5 rounded-lg font-bold text-sm transition-all hover:brightness-110 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              fontFamily: 'var(--font-pixel), Georgia, serif',
              background: `linear-gradient(135deg, ${AMBER}, #d4a04a)`,
              color: '#1a1408',
              letterSpacing: '1.5px',
              boxShadow:
                '0 4px 16px rgba(255,213,128,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            {isSubmitting ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 inline"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Creating Lock...
              </>
            ) : (
              <>◆ DEPOSIT &amp; START LEARNING ◆</>
            )}
          </button>
        </CozyCard>
      </div>
    </div>
  );
}
