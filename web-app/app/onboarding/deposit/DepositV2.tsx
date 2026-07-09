'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWallets, useSignTransaction } from '@privy-io/react-auth/solana';
import { T } from '@/components/theme';
import { CozySectionLabel, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { DepositFormV2 } from '@/components/v2/DepositFormV2';
import { useCourseStore, useUserStore } from '@/stores';
import { fetchWalletDepositBalances } from '@/services/solana/lockVault';
import type { V2ActionPhase } from '@/services/solana/v2Actions';

// v2 deposit page: $10–50, no duration — the lock releases on course
// completion. Builds via vaultV2 (open_lock + lock_funds), NEVER the v1 path.

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

  // Wallet balance + vault TVL — best-effort reads, graceful fallbacks.
  useEffect(() => {
    if (!walletAddress) return;
    fetchWalletDepositBalances(walletAddress)
      .then((b) => setWalletBalanceUi(b.stableBalanceUi))
      .catch(() => setWalletBalanceUi(null));
    import('@/services/solana/vaultV2')
      .then((m) => m.readVaultV2Config())
      .then((config) => setCurrentTvlUi(Number(config.currentTvlUi) || 0))
      .catch(() => setCurrentTvlUi(0));
  }, [walletAddress]);

  const handleSubmit = async (amountUi: string) => {
    if (!walletAddress || !courseId) return;
    setPhase('building');
    setStatusMessage(null);
    try {
      const { executeDeposit } = await import('@/services/solana/v2Actions');
      const wallet = solanaWallets[0] ?? null;
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
          <DepositFormV2
            courseTitle={course?.title ?? courseId}
            currentTvlUi={currentTvlUi}
            walletBalanceUi={walletBalanceUi}
            phase={phase}
            statusMessage={statusMessage}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    </div>
  );
}
