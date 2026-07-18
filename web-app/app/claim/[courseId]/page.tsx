'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useWallets, useSignTransaction } from '@privy-io/react-auth/solana';
import { CozyCard, CozySectionLabel, COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { T } from '@/components/theme';
import { HubButton } from '@/components/HubButton';
import { PenaltyBanner } from '@/components/v2/PenaltyBanner';
import { useCourseStore, useUserStore } from '@/stores';
import { getCompletionVoucher, getLockPosition } from '@/services/api/progress/progressApi';
import { fetchWithAuth } from '@/services/api';
import { hasVaultV2Config } from '@/services/solana/vaultV2';
import { ApiError } from '@/services/api/errors';
import type { CompletionVoucherResponse, LockPositionResponse } from '@/services/api/types';
import type { V2ActionPhase } from '@/services/solana/v2Actions';

// CLAIM flow (spec §5): dedicated auth-gated route. Mount fetches ONLY the
// voucher (mockable backend call); every chain interaction runs inside the
// CLAIM click handler via the v2Actions seam. Success persists in
// sessionStorage so refresh/back can never re-submit against the closed lock.

type ClaimPhase =
  | 'loading'
  | 'review'
  | 'signing'
  | 'success'
  | 'error'
  | 'not-configured'
  | 'no-voucher'
  | 'already-claimed'
  | 'expired';

interface ClaimSuccessRecord {
  signature: string;
  principalUi: string | null;
  receivedUi: string | null;
  bps: number;
  lapseCount: number;
  claimedAt: string;
}

const successKey = (courseId: string) => `locked-in-claim-success:${courseId}`;

function readSuccessRecord(courseId: string): ClaimSuccessRecord | null {
  try {
    const raw = sessionStorage.getItem(successKey(courseId));
    return raw ? (JSON.parse(raw) as ClaimSuccessRecord) : null;
  } catch {
    return null;
  }
}

const PHASE_COPY: Record<V2ActionPhase, string> = {
  building: 'Building transaction…',
  'awaiting-signature': 'Waiting for wallet approval…',
  sending: 'Sending transaction…',
  confirming: 'Confirming on-chain…',
  success: 'Claimed!',
  error: 'Transaction failed',
};

// Contrast-audit style for small money copy on CozyCard glass (10-13px):
// brighter muted white + shadow so the painted backdrop can't wash it out.
const MUTED_STRONG = {
  color: T.textMutedStrong,
  textShadow: '0 1px 2px rgba(0,0,0,0.7)',
} as const;

// Claim dust honesty (docs/mainnet-readiness-checklist.md "Claim dust"): the
// vault floors twice — floor(amount/rate) into shares, floor(shares·rate) back
// out — so a claim can return principal minus 1 atomic unit ($0.000001).
// Surface the tolerance instead of promising exactness.
function DustFootnote() {
  return (
    <p className="font-pixel-mono text-[10px] mt-1" style={MUTED_STRONG}>
      Principal returned (±$0.000001 rounding) — vault share math floors twice,
      so the last micro-cent can round down.
    </p>
  );
}

export default function ClaimPage() {
  const params = useParams<{ courseId: string }>();
  const courseId = params?.courseId ?? '';
  const router = useRouter();

  const authToken = useUserStore((s) => s.authToken);
  const walletAddress = useUserStore((s) => s.walletAddress);
  const course = useCourseStore((s) => s.courses.find((c) => c.id === courseId));
  const courseState = useCourseStore((s) => s.courseStates[courseId]);
  const { wallets: solanaWallets } = useWallets();
  const { signTransaction: privySignTransaction } = useSignTransaction();

  const [phase, setPhase] = useState<ClaimPhase>('loading');
  const [voucher, setVoucher] = useState<CompletionVoucherResponse | null>(null);
  const [position, setPosition] = useState<LockPositionResponse | null>(null);
  const [actionPhase, setActionPhase] = useState<V2ActionPhase | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successRecord, setSuccessRecord] = useState<ClaimSuccessRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Server truth first: the on-chain principal from the position endpoint.
  // The local store's lockAmount is only a fallback — it can go stale (e.g.
  // records the first deposit while the on-chain lock holds more).
  const principalUi =
    position?.principalUi ?? (courseState?.lockAmount ? String(courseState.lockAmount) : null);

  // Live $ figures for the breakdown (display-only, best-effort): total
  // accrued yield and how it splits under the voucher's bps.
  const totalYieldNum =
    position?.liveValueUi != null && position?.principalUi != null
      ? Math.max(0, Number(position.liveValueUi) - Number(position.principalUi))
      : null;

  // Mount: success recovery first (refresh/back safety), then config gate,
  // then the voucher fetch. NO solana imports execute here.
  useEffect(() => {
    if (!courseId) return;
    const existing = readSuccessRecord(courseId);
    if (existing) {
      setSuccessRecord(existing);
      setPhase('success');
      return;
    }
    if (!hasVaultV2Config()) {
      setPhase('not-configured');
      return;
    }
    if (!authToken) return; // AppShell auth gate will redirect if truly signed out
    let cancelled = false;

    const fetchVoucher = () => {
      fetchWithAuth((t) => getCompletionVoucher(courseId, t))
        .then((v) => {
          if (!v) throw new ApiError('Session expired', 401, 'TOKEN_EXPIRED');
          if (cancelled) return;
          if (v.expiry * 1000 <= Date.now()) {
            setPhase('expired');
            return;
          }
          setVoucher(v);
          setPhase('review');
        })
        .catch((error) => {
          if (cancelled) return;
          if (error instanceof ApiError && error.status === 403) {
            setPhase('no-voucher');
          } else if (error instanceof ApiError && error.status === 503) {
            setPhase('not-configured');
          } else {
            setErrorMessage(error instanceof Error ? error.message : 'Could not fetch your voucher');
            setPhase('error');
          }
        });
    };

    // Custody guard: a locally-known lock proceeds straight to the voucher. But
    // v2 locks are NOT hydrated into the store on a fresh device or after PWA
    // storage eviction, so a missing lockAccountAddress must NOT be treated as
    // "already claimed" — that would tell a user their real principal doesn't
    // exist. Verify server truth first: only NONE/CLOSED is genuinely done;
    // ACTIVE proceeds (and heals the store) (audit H1).
    if (courseState?.lockAccountAddress) {
      fetchVoucher();
      // Display-only: the live position feeds the $ breakdown (server
      // principal + accrued yield). Best-effort — the claim itself never
      // depends on it.
      fetchWithAuth((t) => getLockPosition(courseId, t))
        .then((pos) => {
          if (!cancelled && pos) setPosition(pos);
        })
        .catch(() => {});
    } else {
      fetchWithAuth((t) => getLockPosition(courseId, t))
        .then((pos) => {
          if (cancelled) return;
          if (!pos) throw new ApiError('Session expired', 401, 'TOKEN_EXPIRED');
          setPosition(pos);
          // ACTIVE → the lock exists on-chain; proceed. executeClaim derives the
          // lock PDA from (owner, courseId) itself, so the missing store field is
          // not needed for the claim to succeed. Only a SUCCESSFUL read of
          // NONE/CLOSED is genuinely "already claimed".
          if (pos.status === 'ACTIVE') {
            fetchVoucher();
          } else {
            setPhase('already-claimed');
          }
        })
        .catch((error) => {
          if (cancelled) return;
          // Could NOT verify (expired token, RPC/API down) — must never be
          // presented as "already claimed", which would tell a user their real
          // principal is gone. Surface a retryable error instead (audit H1).
          setErrorMessage(
            error instanceof Error ? error.message : 'Could not verify your position',
          );
          setPhase('error');
        });
    }
    return () => {
      cancelled = true;
    };
  }, [courseId, authToken, courseState?.lockAccountAddress]);

  // Honesty note (docs/mainnet-readiness-checklist.md "Platform-fee display"):
  // these percentages derive from voucher.bps ALONE, which is correct only
  // while platform_fee_bps is 0 and unwired. If the voucher/backend ever
  // reports a platform fee, keep/forfeit MUST derive from it instead of
  // assuming user% + pot% == 100 — and only then render a fee row (do not
  // invent a fee display for a fee that doesn't exist).
  const keptPct = voucher ? voucher.bps / 100 : 100;
  const forfeitPct = 100 - keptPct;
  const expiryDate = useMemo(
    () =>
      voucher
        ? new Date(voucher.expiry * 1000).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : null,
    [voucher],
  );

  const handleClaim = useCallback(async () => {
    if (!voucher || !walletAddress || isSubmitting) return;
    setIsSubmitting(true);
    setPhase('signing');
    setErrorMessage(null);
    try {
      // Chain code loads HERE, not at mount — keeps the route mockable.
      const { executeClaim, isTxStubActive } = await import('@/services/solana/v2Actions');
      const { pickSignerWallet, missingSignerMessage } = await import(
        '@/services/solana/pickSignerWallet'
      );
      // Sign with the wallet that OWNS the lock, never wallets[0] — with both
      // an embedded and an external wallet connected, index 0 can be the wrong
      // one and the wallet rejects with the 4100 "not been authorized" error.
      // The e2e tx stub never signs, so its runs skip the signer pre-check.
      const wallet = pickSignerWallet(solanaWallets, walletAddress);
      if (!wallet && !isTxStubActive()) throw new Error(missingSignerMessage(walletAddress));
      const result = await executeClaim(
        walletAddress,
        courseId,
        voucher,
        {
          // Adapt Privy's narrower input type to the seam's shape.
          signTransaction: (args) =>
            privySignTransaction(args as Parameters<typeof privySignTransaction>[0]),
          wallet,
        },
        setActionPhase,
      );
      const record: ClaimSuccessRecord = {
        signature: result.signature,
        // Permanent record: server-truth principal only. If the position fetch
        // hasn't landed yet, store null (renders "In full") rather than
        // freezing the possibly-stale local lockAmount into sessionStorage.
        principalUi: position?.principalUi ?? null,
        receivedUi: result.receivedUi,
        bps: voucher.bps,
        lapseCount: voucher.lapseCount,
        claimedAt: new Date().toISOString(),
      };
      try {
        sessionStorage.setItem(successKey(courseId), JSON.stringify(record));
      } catch {
        // sessionStorage full/blocked — success screen still renders from state
      }
      // Lock is closed on-chain; clear the local custody pointer.
      useCourseStore.getState().clearLockForCourse(courseId);
      setSuccessRecord(record);
      setPhase('success');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Claim failed');
      setPhase('error');
    } finally {
      setIsSubmitting(false);
    }
  }, [voucher, walletAddress, courseId, isSubmitting, principalUi, privySignTransaction, solanaWallets]);

  const backToDashboard = (
    <button
      onClick={() => router.push('/dashboard')}
      className="w-full py-3 rounded-lg border font-pixel text-sm uppercase tracking-[2px] font-bold min-h-[44px] mt-4"
      style={{
        backgroundColor: 'rgba(255,213,128,0.12)',
        borderColor: 'rgba(255,213,128,0.4)',
        color: COZY_TEXT,
        textShadow: COZY_TEXT_SHADOW,
      }}
    >
      Back to dashboard
    </button>
  );

  const shell = (children: React.ReactNode) => (
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
          className="text-2xl font-bold tracking-wide font-pixel mb-5"
          style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
        >
          Claim
        </h1>
        {children}
      </div>
    </div>
  );

  // ── Terminal + transient states, all themed ──
  if (phase === 'loading') {
    return shell(
      <CozyCard data-testid="v2-claim-loading" className="text-center" style={{ padding: 28 }}>
        <p className="font-pixel-mono text-[13px]" style={MUTED_STRONG}>
          Checking your completion voucher…
        </p>
      </CozyCard>,
    );
  }

  if (phase === 'not-configured') {
    return shell(
      <CozyCard className="text-center" style={{ padding: 28 }}>
        <p className="font-pixel text-lg mb-2" style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}>
          Claims aren&apos;t live here yet
        </p>
        <p className="font-pixel-mono text-[12px]" style={MUTED_STRONG}>
          On-chain claims are not enabled in this environment.
        </p>
        {backToDashboard}
      </CozyCard>,
    );
  }

  if (phase === 'no-voucher') {
    return shell(
      <CozyCard data-testid="v2-claim-no-voucher" className="text-center" style={{ padding: 28 }}>
        <p className="font-pixel text-lg mb-2" style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}>
          Finish the course first
        </p>
        <p className="font-pixel-mono text-[12px]" style={MUTED_STRONG}>
          Your stake unlocks when every lesson is complete. Keep going — the vault isn&apos;t
          going anywhere.
        </p>
        {backToDashboard}
      </CozyCard>,
    );
  }

  if (phase === 'already-claimed') {
    return shell(
      <CozyCard data-testid="v2-claim-already-claimed" className="text-center" style={{ padding: 28 }}>
        <p className="font-pixel text-lg mb-2" style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}>
          Nothing to claim
        </p>
        <p className="font-pixel-mono text-[12px]" style={MUTED_STRONG}>
          This position is already claimed or was never locked. Nothing is pending.
        </p>
        {backToDashboard}
      </CozyCard>,
    );
  }

  if (phase === 'expired') {
    return shell(
      <CozyCard className="text-center" style={{ padding: 28 }}>
        <p className="font-pixel text-lg mb-2" style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}>
          Voucher expired
        </p>
        <p className="font-pixel-mono text-[12px]" style={MUTED_STRONG}>
          Head back to the dashboard and reopen the claim — a fresh voucher will be issued.
        </p>
        {backToDashboard}
      </CozyCard>,
    );
  }

  if (phase === 'error') {
    return shell(
      <CozyCard data-testid="v2-claim-error" className="text-center" style={{ padding: 28 }}>
        <p className="font-pixel text-lg mb-2" style={{ color: '#FF8FA3', textShadow: COZY_TEXT_SHADOW }}>
          Something went wrong
        </p>
        <p className="font-pixel-mono text-[12px] mb-4" style={MUTED_STRONG}>
          {errorMessage ?? 'The claim could not be completed. Your funds are untouched.'}
        </p>
        <button
          onClick={() => {
            setPhase('loading');
            setErrorMessage(null);
            // Voucher fetch is idempotent — re-run the mount flow.
            if (authToken) {
              fetchWithAuth((t) => getCompletionVoucher(courseId, t))
                .then((v) => {
                  if (!v) throw new Error('Session expired');
                  setVoucher(v);
                  setPhase(v.expiry * 1000 <= Date.now() ? 'expired' : 'review');
                })
                .catch(() => setPhase('error'));
            }
          }}
          className="w-full py-3 rounded-lg border font-pixel text-sm uppercase tracking-[2px] font-bold min-h-[44px]"
          style={{
            backgroundColor: 'rgba(62,230,138,0.12)',
            borderColor: 'rgba(62,230,138,0.45)',
            color: '#3EE68A',
            textShadow: COZY_TEXT_SHADOW,
          }}
        >
          Retry
        </button>
        {backToDashboard}
      </CozyCard>,
    );
  }

  if (phase === 'success' && successRecord) {
    const keptPctS = successRecord.bps / 100;
    return shell(
      <CozyCard data-testid="v2-claim-success" style={{ padding: 24 }}>
        <div className="text-center mb-4">
          <span className="text-4xl">🏆</span>
          <p className="font-pixel text-xl mt-2" style={{ color: '#3EE68A', textShadow: COZY_TEXT_SHADOW }}>
            Claimed!
          </p>
        </div>
        <div data-testid="v2-claim-breakdown" className="flex flex-col gap-2 mb-4">
          <BreakdownRow label="Principal returned" value={successRecord.principalUi ? `$${successRecord.principalUi}` : 'In full'} />
          <BreakdownRow label="Yield kept" value={`${keptPctS}%`} />
          <BreakdownRow label="To community pot" value={`${100 - keptPctS}%`} />
          {successRecord.receivedUi && (
            <BreakdownRow label="Received (exact)" value={`$${successRecord.receivedUi}`} highlight />
          )}
          <DustFootnote />
        </div>
        <p
          className="font-pixel-mono text-[10px] break-all"
          style={MUTED_STRONG}
          title="Transaction signature"
        >
          tx: {successRecord.signature}
        </p>
        {backToDashboard}
      </CozyCard>,
    );
  }

  // ── Review + signing ──
  return shell(
    <CozyCard data-testid="v2-claim-review" style={{ padding: 24 }}>
      <CozySectionLabel>{course?.title ?? courseId}</CozySectionLabel>
      <p className="font-pixel-mono text-[12px] mb-4" style={MUTED_STRONG}>
        Course complete. Here&apos;s exactly what happens when you claim:
      </p>

      <div className="flex flex-col gap-2 mb-3">
        <BreakdownRow label="Principal returned" value={principalUi ? `$${principalUi}` : 'In full'} />
        <BreakdownRow
          label="Yield you keep"
          value={
            totalYieldNum != null
              ? `${keptPct}% · ≈$${((totalYieldNum * keptPct) / 100).toFixed(4)}`
              : `${keptPct}%`
          }
          highlight={keptPct === 100}
        />
        <BreakdownRow
          label="To community pot"
          value={
            totalYieldNum != null
              ? `${forfeitPct}% · ≈$${((totalYieldNum * forfeitPct) / 100).toFixed(4)}`
              : `${forfeitPct}%`
          }
        />
        <DustFootnote />
      </div>

      {voucher && voucher.lapseCount > 0 && (
        <PenaltyBanner
          lapseCount={voucher.lapseCount}
          forfeitUi={
            totalYieldNum != null && forfeitPct > 0
              ? ((totalYieldNum * forfeitPct) / 100).toFixed(4)
              : null
          }
          className="mb-3"
        />
      )}

      {expiryDate && (
        <p className="font-pixel-mono text-[10px] mb-4" style={MUTED_STRONG}>
          Voucher valid until {expiryDate}
        </p>
      )}

      {phase === 'signing' && (
        <p
          data-testid="v2-claim-status"
          role="status"
          className="font-pixel-mono text-[11px] mb-3"
          style={{ color: COZY_TEXT, opacity: 0.85 }}
        >
          {actionPhase ? PHASE_COPY[actionPhase] : 'Preparing…'}
        </p>
      )}

      <button
        data-testid="v2-claim-submit"
        disabled={isSubmitting || phase === 'signing'}
        onClick={handleClaim}
        className="w-full py-3.5 rounded-lg border font-pixel text-sm uppercase tracking-[2px] font-bold min-h-[44px]"
        style={{
          backgroundColor: 'rgba(62,230,138,0.15)',
          borderColor: 'rgba(62,230,138,0.6)',
          color: '#3EE68A',
          textShadow: COZY_TEXT_SHADOW,
          opacity: isSubmitting || phase === 'signing' ? 0.5 : 1,
        }}
      >
        {phase === 'signing' ? 'Claiming…' : 'Claim principal + yield'}
      </button>
    </CozyCard>,
  );
}

function BreakdownRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-lg border px-3 py-2.5"
      style={{
        backgroundColor: highlight ? 'rgba(62,230,138,0.08)' : 'rgba(255,255,255,0.03)',
        borderColor: highlight ? 'rgba(62,230,138,0.35)' : T.borderDormant,
      }}
    >
      <span className="font-pixel-mono text-[11px] uppercase tracking-[1px]" style={MUTED_STRONG}>
        {label}
      </span>
      <span
        className="font-pixel-mono text-[13px] font-bold"
        style={{ color: highlight ? '#3EE68A' : COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
      >
        {value}
      </span>
    </div>
  );
}
