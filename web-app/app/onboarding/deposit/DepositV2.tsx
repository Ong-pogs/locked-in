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
import { connection } from '@/services/solana/connection';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { fetchWithAuth } from '@/services/api/httpClient';
import { getLockEligibility } from '@/services/api/locks/locksApi';
import {
  clearPendingEnroll,
  enrollLockWithRetry,
  writePendingEnroll,
} from '@/services/enroll/pendingEnroll';
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

// SOL gas gate.
//
// A deposit is TWO transactions and open_lock_v2 pays RENT, not just fees: the
// LockV2 PDA (8 + 82 bytes → ~0.00152 SOL) and the lock's collateral ATA (165
// bytes → ~0.00204 SOL), both `payer = owner`. That is ~0.0036 SOL of rent
// before a single signature fee.
//
// This bites hardest on the likeliest mainnet path: Google login → Privy
// embedded wallet → someone sends the user USDC and nothing else. The devnet
// faucet that drips SOL is devnet-gated, so mainnet has no safety net — without
// this gate the user signs, the chain rejects for lamports, and they read a raw
// RPC string while wondering whether their USDC moved.
const MIN_SOL_LAMPORTS = 0.005 * LAMPORTS_PER_SOL;
const MIN_SOL_UI = '0.005';
const ACCOUNT_RENT_SOL_UI = '~0.0036';

// 'unknown' deliberately does NOT block. Unlike the eligibility gate — where a
// missing answer could mean locking against a course that can never be
// completed — a failed balance read is only a missing warning. Blocking a
// funded user out of their deposit on an RPC blip is the worse failure, and the
// on-chain rejection is now mapped to honest copy either way.
type SolGateState =
  | { status: 'checking' }
  | { status: 'ok' }
  | { status: 'insufficient'; lamports: number }
  | { status: 'unknown' };

function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

async function readSolGate(owner: string): Promise<SolGateState> {
  try {
    const lamports = await connection.getBalance(new PublicKey(owner));
    return lamports >= MIN_SOL_LAMPORTS ? { status: 'ok' } : { status: 'insufficient', lamports };
  } catch {
    return { status: 'unknown' };
  }
}

/**
 * Turn a chain/SDK/wallet failure into copy a human can act on, without ever
 * claiming money is lost when the truth is unknown.
 *
 * Two rules hold this together:
 *   - Only say "nothing moved" where that is provably true (the wallet refused
 *     to sign, the blockhash expired, we never got past a pre-flight gate).
 *   - When a transaction is in flight and unconfirmed, say exactly that and
 *     tell the user NOT to retry — a second deposit against the same lock is
 *     how someone ends up double-funding.
 * The raw message is never discarded; it is rendered as a details line and
 * logged, so support can debug without the user reciting an RPC error.
 */
function describeDepositError(error: unknown): { message: string; detail: string | null } {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const lower = raw.toLowerCase();
  const detail = raw.trim().length > 0 ? raw : null;

  if (error instanceof Error && error.name === 'TransactionPendingError') {
    return {
      message:
        'Your transaction was sent and is still confirming — it has NOT failed. ' +
        'Do not deposit again. Reopen this course in a minute to see the result.',
      detail,
    };
  }

  if (lower.includes('user rejected') || lower.includes('user denied') || lower.includes('4001')) {
    return {
      message: 'You cancelled the signature. Nothing was deposited — your funds never left your wallet.',
      detail: null,
    };
  }

  if (
    lower.includes('insufficient lamports') ||
    lower.includes('insufficient funds for rent') ||
    lower.includes('found no record of a prior credit')
  ) {
    return {
      message:
        `Not enough SOL to pay network fees. A deposit needs about ${MIN_SOL_UI} SOL for fees ` +
        `plus ${ACCOUNT_RENT_SOL_UI} SOL of one-time account rent. Nothing was deposited — ` +
        'top up SOL and try again.',
      detail,
    };
  }

  // Token program error 0x1 = insufficient funds on the token account.
  if (lower.includes('custom program error: 0x1') || lower.includes('insufficient funds')) {
    return {
      message:
        'Your wallet does not hold enough USDC for this amount. Nothing was deposited — ' +
        'lower the amount or top up USDC.',
      detail,
    };
  }

  if (lower.includes('expired before it was confirmed') || lower.includes('blockhash not found')) {
    return {
      message:
        'The network dropped the transaction before it was confirmed. Nothing moved — please try again.',
      detail,
    };
  }

  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      message:
        'The Solana network connection is rate-limited right now. Nothing was deposited — wait a moment and try again.',
      detail,
    };
  }

  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('fetch failed')) {
    return {
      message:
        "Couldn't reach the Solana network. If you never approved a signature, nothing was deposited. " +
        'Check your connection and try again.',
      detail,
    };
  }

  // Unmapped: keep the raw text as the headline rather than inventing a
  // reassurance we cannot back up, but never assert the funds are gone.
  return {
    message: raw || 'Deposit failed. Reopen this course to check whether anything was locked.',
    detail: null,
  };
}

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
  const [solGate, setSolGate] = useState<SolGateState>({ status: 'checking' });
  const [solGateTick, setSolGateTick] = useState(0);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

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

  // SOL gas pre-gate, mount-time: paint the "you need SOL" state before the
  // user types an amount, rather than after they approve a signature.
  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    setSolGate({ status: 'checking' });
    readSolGate(walletAddress).then((next) => {
      if (!cancelled) setSolGate(next);
    });
    return () => {
      cancelled = true;
    };
  }, [walletAddress, solGateTick]);

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
    setErrorDetail(null);
    try {
      // Binding SOL gate: re-read right before any transaction is built. The
      // mount-time read can be minutes stale, and the whole point is to never
      // let a user sign a transaction the chain will reject for lamports.
      const gate = await readSolGate(walletAddress);
      if (gate.status === 'insufficient') {
        setSolGate(gate);
        setPhase('idle');
        return;
      }

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

      // Breadcrumb BEFORE any money moves. The lock PDA is pure derivation
      // (owner + courseId), so we can record the intent without the chain.
      // Without this, a tab close / dead battery between lock_funds_v2
      // confirming and the enroll call landing left real locked USDC with no
      // local or server record — invisible in the app. The dashboard's
      // retryPendingEnrolls heals it on next mount; success clears it below.
      try {
        const { deriveLockPda } = await import('@/services/solana/vaultV2');
        const pda = await deriveLockPda(walletAddress, courseId);
        writePendingEnroll(courseId, {
          lockAddress: pda.toBase58(),
          walletAddress,
          attemptedAt: new Date().toISOString(),
        });
      } catch {
        // Derivation/storage failure must not block the deposit — the R14
        // server-side lazy heal still covers this lock.
      }

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
          // Refresh the pre-tx breadcrumb with the chain-confirmed address.
          writePendingEnroll(courseId, {
            lockAddress: result.lockAddress,
            walletAddress,
            attemptedAt: new Date().toISOString(),
          });
        } else {
          // Enrolled server-side — the breadcrumb has done its job.
          clearPendingEnroll(courseId);
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
      // Raw chain/SDK text is kept for support (details line + console) but is
      // never the thing we hand a user who just tried to move money.
      console.error('[deposit-v2] deposit failed', error);
      const described = describeDepositError(error);
      setPhase('error');
      setStatusMessage(described.message);
      setErrorDetail(described.detail);
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
          ) : solGate.status === 'insufficient' ? (
            <CozyCard data-testid="v2-sol-gate-blocked" className="text-center" style={{ padding: 28 }}>
              <p
                className="font-pixel text-lg mb-2"
                style={{ color: '#F0A878', textShadow: COZY_TEXT_SHADOW }}
              >
                You need a little SOL first
              </p>
              <p
                className="font-pixel-mono text-[12px] mb-3"
                style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
              >
                This wallet holds {formatSol(solGate.lamports)} SOL. Locking in needs at least{' '}
                {MIN_SOL_UI} SOL — Solana charges fees in SOL, and your deposit creates two new
                accounts (your lock and its balance account) that each cost a one-time refundable
                rent of {ACCOUNT_RENT_SOL_UI} SOL in total.
              </p>
              <p
                className="font-pixel-mono text-[12px] mb-5"
                style={{ color: T.textMutedStrong, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
              >
                Your USDC is untouched and nothing was deposited. Send at least {MIN_SOL_UI} SOL to
                this wallet from an exchange or another wallet, then come back.
              </p>
              <button
                onClick={() => setSolGateTick((t) => t + 1)}
                className="px-6 py-3 rounded-lg border font-pixel text-sm uppercase tracking-[2px] font-bold min-h-[44px]"
                style={{
                  backgroundColor: 'rgba(255,213,128,0.12)',
                  borderColor: 'rgba(255,213,128,0.4)',
                  color: COZY_TEXT,
                  textShadow: COZY_TEXT_SHADOW,
                }}
              >
                Check again
              </button>
            </CozyCard>
          ) : (
            <>
              <DepositFormV2
                courseTitle={course?.title ?? courseId}
                currentTvlUi={currentTvlUi}
                walletBalanceUi={walletBalanceUi}
                phase={phase}
                statusMessage={statusMessage}
                onSubmit={handleSubmit}
              />
              {phase === 'error' && errorDetail && (
                <p
                  data-testid="v2-deposit-error-detail"
                  className="font-pixel-mono text-[10px] mt-3 break-words"
                  style={{ color: T.textMuted ?? T.textSecondary }}
                >
                  Details for support: {errorDetail}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
