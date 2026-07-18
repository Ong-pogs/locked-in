'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWallets, useSignTransaction } from '@privy-io/react-auth/solana';
import { T } from '@/components/theme';
import { CozyCard, CozySectionLabel, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { DepositFormV2 } from '@/components/v2/DepositFormV2';
import { useCourseStore, useUserStore } from '@/stores';
import { readWalletUsdcUi } from '@/services/solana/vaultV2';
import { fetchWithAuth } from '@/services/api/httpClient';
import { getLockEligibility } from '@/services/api/locks/locksApi';
import { enrollLockWithRetry, writePendingEnroll } from '@/services/enroll/pendingEnroll';
import type { LockIneligibleCode } from '@/services/api/types';
import type { V2ActionPhase } from '@/services/solana/v2Actions';

// v2 deposit page: $10–50, no duration — the lock releases on course
// completion. Builds via vaultV2 (open_lock + lock_funds), NEVER the v1 path.

// R12 pre-deposit eligibility gate: money never moves unless the backend
// answered { eligible: true }. 'error' (no response) blocks too — fail closed.
type EligibilityState =
  | { status: 'checking' }
  | { status: 'eligible' }
  | { status: 'ineligible'; code: LockIneligibleCode }
  | { status: 'error' };

const INELIGIBLE_COPY: Record<LockIneligibleCode, { title: string; body: string }> = {
  COURSE_COMPLETED: {
    title: 'Course complete — practice mode',
    body:
      'You already finished this course, so it lives on in practice mode. ' +
      'Relocking a stake here is permanently closed — pick a new course to lock in.',
  },
  COURSE_NOT_LOCKABLE: {
    title: "This course can't hold a stake yet",
    body:
      'No lessons are published for this course, so a lock here could never be completed. ' +
      'Your funds stay in your wallet — choose a course with lessons.',
  },
  COURSE_NOT_FOUND: {
    title: 'Course not found',
    body: "This course doesn't exist on the server. Nothing was deposited — head back and pick another.",
  },
};

export function DepositV2() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: T.bg }}>
          <p className="font-pixel-mono text-sm" style={{ color: T.textSecondary }}>
            Loading...
          </p>
        </div>
      }
    >
      <DepositV2Content />
    </Suspense>
  );
}

function DepositV2Content() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const courseId = searchParams.get('courseId') ?? '';

  const walletAddress = useUserStore((s) => s.walletAddress);
  const courses = useCourseStore((s) => s.courses);
  const course = courses.find((c) => c.id === courseId);
  const activateCourse = useCourseStore((s) => s.activateCourse);

  // Guard (parity with LegacyDeposit): never lock funds against a missing or
  // unknown courseId — otherwise activateCourse('', ...) corrupts the store and
  // USDC locks against a nonexistent course (stuck ~180 days). Wait for the
  // courses list before bouncing so a transient empty list doesn't redirect.
  useEffect(() => {
    if (!courseId) {
      router.replace('/courses');
      return;
    }
    if (courses.length > 0 && !course) {
      router.replace('/courses');
    }
  }, [courseId, course, courses.length, router]);
  const { wallets: solanaWallets } = useWallets();
  const { signTransaction: privySignTransaction } = useSignTransaction();

  const [phase, setPhase] = useState<V2ActionPhase | 'idle'>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [walletBalanceUi, setWalletBalanceUi] = useState<string | null>(null);
  const [currentTvlUi, setCurrentTvlUi] = useState(0);
  const [eligibility, setEligibility] = useState<EligibilityState>({ status: 'checking' });
  const [eligibilityTick, setEligibilityTick] = useState(0);

  // R12 eligibility pre-gate, mount-time: paint the blocked state before the
  // user even types an amount. Fail closed — an error is a block, not a pass.
  // The submit handler re-verifies right before money moves (binding gate).
  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    setEligibility({ status: 'checking' });
    fetchWithAuth((token) => getLockEligibility(courseId, token))
      .then((res) => {
        if (cancelled) return;
        if (res?.eligible === true) {
          setEligibility({ status: 'eligible' });
        } else {
          setEligibility({
            status: 'ineligible',
            code: res?.eligible === false ? res.code : 'COURSE_NOT_LOCKABLE',
          });
        }
      })
      .catch(() => {
        if (!cancelled) setEligibility({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, eligibilityTick]);

  // Wallet balance + vault TVL — best-effort reads, graceful fallbacks.
  useEffect(() => {
    if (!walletAddress) return;
    readWalletUsdcUi(walletAddress)
      .then((ui) => setWalletBalanceUi(ui))
      .catch(() => setWalletBalanceUi(null));
    import('@/services/solana/vaultV2')
      .then((m) => m.readVaultV2Config())
      .then((config) => setCurrentTvlUi(Number(config.currentTvlUi) || 0))
      .catch(() => setCurrentTvlUi(0));
  }, [walletAddress]);

  const handleSubmit = async (amountUi: string) => {
    if (!walletAddress || !courseId) return;
    if (eligibility.status !== 'eligible') return;
    setPhase('building');
    setStatusMessage(null);
    try {
      // R12 binding gate: re-verify eligibility immediately before building
      // any transaction. Fail closed — no positive answer means no deposit
      // (network errors included). This is where spec item 21 protects money.
      let eligible = false;
      let ineligibleCode: LockIneligibleCode | null = null;
      try {
        const res = await fetchWithAuth((token) => getLockEligibility(courseId, token));
        if (res?.eligible === true) eligible = true;
        else if (res?.eligible === false) ineligibleCode = res.code;
      } catch {
        // fall through: eligible stays false
      }
      if (!eligible) {
        if (ineligibleCode) {
          // Server ruled the course un-lockable — flip the page to the
          // blocked state; there is nothing to retry.
          setEligibility({ status: 'ineligible', code: ineligibleCode });
          setPhase('idle');
          return;
        }
        throw new Error(
          "Couldn't confirm this course can be locked. Nothing was deposited — try again.",
        );
      }

      const { executeDeposit, isTxStubActive } = await import('@/services/solana/v2Actions');
      const { pickSignerWallet, missingSignerMessage } = await import(
        '@/services/solana/pickSignerWallet'
      );
      // Sign with the wallet the tx is built for, never wallets[0] — with both
      // an embedded and an external wallet connected, index 0 can be the wrong
      // one and the wallet rejects with the 4100 "not been authorized" error.
      // The e2e tx stub never signs, so its runs skip the signer pre-check.
      const wallet = pickSignerWallet(solanaWallets, walletAddress);
      if (!wallet && !isTxStubActive()) throw new Error(missingSignerMessage(walletAddress));
      const result = await executeDeposit(
        walletAddress,
        courseId,
        amountUi,
        {
          signTransaction: (args) =>
            privySignTransaction(args as Parameters<typeof privySignTransaction>[0]),
          wallet,
        },
        setPhase,
      );

      // R13 enroll-on-deposit: register the lock server-side (both fresh
      // success and alreadyLocked carry lockAddress). On 409 ENROLL_RETRY,
      // enrollLockWithRetry waits retryAfterMs (else 2s/5s/10s) up to 3
      // retries. On persistent failure: persist a pending-enroll record and
      // continue — funds are safe on-chain, the dashboard retries on mount,
      // and the backend heals lazily via the position endpoint (R14).
      if (result.lockAddress) {
        const enrollOutcome = await enrollLockWithRetry(courseId, result.lockAddress);
        if (enrollOutcome.status === 'pending') {
          writePendingEnroll(courseId, {
            lockAddress: result.lockAddress,
            walletAddress,
            attemptedAt: new Date().toISOString(),
          });
        }
      }

      activateCourse(courseId, {
        amount: Number(amountUi),
        duration: 30, // legacy store field — v2 locks have no duration
        lockAccountAddress: result.lockAddress ?? null,
        stableMintAddress: null,
      });
      useUserStore.getState().setOnboardingPhase('main');
      router.push('/village');
    } catch (error) {
      setPhase('error');
      setStatusMessage(error instanceof Error ? error.message : 'Deposit failed');
    }
  };

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/cottage/profilebackground.png"
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
              'linear-gradient(180deg, rgba(14,14,28,0.35) 0%, rgba(14,14,28,0.6) 60%, rgba(14,14,28,0.8) 100%)',
          }}
        />
      </div>
      <HubButton />
      <div className="relative z-10 max-w-[480px] mx-auto px-[18px] pb-12">
        <div className="pt-20" />
        <h1
          className="text-2xl font-bold tracking-wide font-pixel mb-1"
          style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
        >
          Lock in
        </h1>
        <CozySectionLabel>{course?.title ?? 'Selected course'}</CozySectionLabel>
        <div className="mt-3">
          {eligibility.status === 'checking' ? (
            <CozyCard data-testid="v2-eligibility-checking" className="text-center" style={{ padding: 28 }}>
              <p
                className="font-pixel-mono text-[13px]"
                style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
              >
                Checking this course can hold your stake…
              </p>
            </CozyCard>
          ) : eligibility.status === 'ineligible' ? (
            <CozyCard data-testid="v2-eligibility-blocked" className="text-center" style={{ padding: 28 }}>
              <p
                className="font-pixel text-lg mb-2"
                style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
              >
                {INELIGIBLE_COPY[eligibility.code].title}
              </p>
              <p
                className="font-pixel-mono text-[12px] mb-5"
                style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
              >
                {INELIGIBLE_COPY[eligibility.code].body}
              </p>
              <button
                onClick={() => router.push('/courses')}
                className="px-6 py-3 rounded-lg border font-pixel text-sm uppercase tracking-[2px] font-bold min-h-[44px]"
                style={{
                  backgroundColor: 'rgba(255,213,128,0.12)',
                  borderColor: 'rgba(255,213,128,0.4)',
                  color: COZY_TEXT,
                  textShadow: COZY_TEXT_SHADOW,
                }}
              >
                Browse courses
              </button>
            </CozyCard>
          ) : eligibility.status === 'error' ? (
            <CozyCard data-testid="v2-eligibility-error" className="text-center" style={{ padding: 28 }}>
              <p
                className="font-pixel text-lg mb-2"
                style={{ color: '#F0A878', textShadow: COZY_TEXT_SHADOW }}
              >
                Can&apos;t verify this course right now
              </p>
              <p
                className="font-pixel-mono text-[12px] mb-5"
                style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
              >
                Deposits stay blocked until we can confirm this course can hold a stake.
                Nothing was deposited — your funds are untouched.
              </p>
              <button
                onClick={() => setEligibilityTick((t) => t + 1)}
                className="px-6 py-3 rounded-lg border font-pixel text-sm uppercase tracking-[2px] font-bold min-h-[44px]"
                style={{
                  backgroundColor: 'rgba(255,213,128,0.12)',
                  borderColor: 'rgba(255,213,128,0.4)',
                  color: COZY_TEXT,
                  textShadow: COZY_TEXT_SHADOW,
                }}
              >
                Retry
              </button>
            </CozyCard>
          ) : (
            <DepositFormV2
              courseTitle={course?.title ?? courseId}
              currentTvlUi={currentTvlUi}
              walletBalanceUi={walletBalanceUi}
              phase={phase}
              statusMessage={statusMessage}
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
