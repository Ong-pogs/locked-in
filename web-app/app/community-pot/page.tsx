'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCourseStore } from '@/stores';
import { getCommunityPotHistory } from '@/services/api/progress/progressApi';
import { fetchWithAuth } from '@/services/api/httpClient';
import type { CommunityPotHistoryWindow } from '@/services/api/types';
import { T } from '@/components/theme';
import { CozyCard, CozySectionLabel } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

function renderWindowStatus(status: CommunityPotHistoryWindow['status']) {
  if (status === 'DISTRIBUTED') return 'Distributed';
  if (status === 'CLOSED') return 'Closed';
  return 'Open';
}

function renderRecipientStatus(status: CommunityPotHistoryWindow['userStatus']) {
  if (status === 'DISTRIBUTED') return 'Paid';
  if (status === 'FAILED') return 'Failed';
  if (status === 'PUBLISHING') return 'Publishing';
  if (status === 'PENDING') return 'Pending';
  return 'Not eligible';
}

export default function CommunityPotPage() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const [history, setHistory] = useState<CommunityPotHistoryWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPotData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const resp = await fetchWithAuth((token) => getCommunityPotHistory(token));
      if (signal?.aborted) return;
      if (!resp) { setError('Connect wallet to view community pot.'); setLoading(false); return; }
      setHistory(resp.windows);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to load.');
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPotData(controller.signal);
    return () => { controller.abort(); };
  }, [fetchPotData]);

  // Filter payouts where user has a result
  const payoutHistory = history.filter(
    (w) => w.userStatus !== 'NONE' && w.userStatus !== 'PENDING',
  );

  // Status pill helpers
  const statusColor = (s: string) =>
    s === 'Paid' || s === 'Distributed' ? T.green
    : s === 'Failed' ? T.crimson
    : s === 'Not eligible' ? T.textMuted
    : T.textSecondary;
  const statusBg = (s: string) =>
    s === 'Paid' || s === 'Distributed' ? 'rgba(62,230,138,0.08)'
    : s === 'Failed' ? 'rgba(255,68,102,0.08)'
    : 'rgba(255,255,255,0.04)';

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Tavern interior backdrop — fixed, pixelated, behind content. */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/tavern/tavernbackground.png"
          alt=""
          draggable={false}
          className="w-full h-full object-cover select-none"
          style={{ imageRendering: 'pixelated' }}
        />
        {/* Indigo gradient overlay — lighter at top (hearth/lanterns visible),
            darker at bottom (so card text reads cleanly). */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(14,14,28,0.30) 0%, rgba(14,14,28,0.55) 60%, rgba(14,14,28,0.78) 100%)',
          }}
        />
      </div>

      <HubButton />

      <div className="relative z-10 max-w-[1100px] mx-auto px-[18px] pb-10">
        <div className="pt-20" />

      <h1
        className="text-3xl font-bold tracking-wide mb-1"
        style={{
          fontFamily: 'var(--font-pixel), Georgia, serif',
          color: '#FFD580',
          textShadow: '0 1px 2px rgba(0,0,0,0.85)',
        }}
      >
        Community Pot
      </h1>
      <p className="text-sm leading-[18px] mb-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
        Shared yield pool from broken streaks
      </p>

      {/* Current Window hero */}
      <CozyCard className="text-center mb-5" style={{ padding: 24 }}>
        <p className="font-pixel-mono text-[9px] uppercase tracking-[1.5px]" style={{ color: T.textMuted }}>
          Current Window Pot
        </p>
        {loading ? (
          <p className="text-[13px] mt-2" style={{ color: T.textSecondary }}>Reading live pot state...</p>
        ) : (
          <>
            <p className="text-4xl font-bold font-pixel-mono mt-2" style={{ color: T.green }}>0 USDC</p>
            <p className="font-pixel-mono text-[10px] mt-1" style={{ color: T.textMuted }}>
              {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })} · Open
            </p>
          </>
        )}
        {error && (
          <div className="mt-2">
            <p className="text-[11px]" style={{ color: T.amber }}>{error}</p>
            <button
              onClick={() => { setError(null); void fetchPotData(); }}
              className="mt-2 mx-auto block px-4 py-2 rounded-md border text-[11px] font-semibold uppercase tracking-wide"
              style={{ borderColor: `${T.amber}30`, backgroundColor: 'rgba(212,160,74,0.08)', color: T.amber }}
            >
              Retry
            </button>
          </div>
        )}
      </CozyCard>

      {/* 2-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Left: Your Payouts */}
        <div>
          <CozySectionLabel>Your Payouts</CozySectionLabel>
          {loading ? (
            <CozyCard><p className="text-[13px]" style={{ color: T.textSecondary }}>Loading...</p></CozyCard>
          ) : payoutHistory.length === 0 ? (
            <CozyCard><p className="text-[13px]" style={{ color: T.textSecondary }}>No payout history yet.</p></CozyCard>
          ) : (
            payoutHistory.map((w) => {
              const label = renderRecipientStatus(w.userStatus);
              return (
                <CozyCard
                  key={`payout-${w.windowId}`}
                  className="mb-3"
                  style={{ padding: 18, borderLeftWidth: 3, borderLeftColor: statusColor(label) === T.green ? T.green : T.textMuted }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[14px] font-bold font-pixel" style={{ color: T.textPrimary }}>{w.windowLabel}</p>
                    <span
                      className="font-pixel-mono text-[10px] uppercase tracking-[1px] px-2.5 py-0.5 rounded-xl"
                      style={{ color: statusColor(label), background: statusBg(label), border: `1px solid ${statusColor(label)}30` }}
                    >
                      {label}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px dashed rgba(255,255,255,0.04)' }}>
                    <span className="text-[12px]" style={{ fontFamily: 'var(--font-pixel), Georgia, serif', color: T.textSecondary }}>Amount</span>
                    <span className="text-[13px] font-bold font-pixel-mono" style={{ color: T.green }}>{w.userPayoutAmountUi ?? '0'} USDC</span>
                  </div>
                  {w.userDistributedAt && (
                    <div className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px dashed rgba(255,255,255,0.04)' }}>
                      <span className="text-[12px]" style={{ fontFamily: 'var(--font-pixel), Georgia, serif', color: T.textSecondary }}>Paid at</span>
                      <span className="font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>{new Date(w.userDistributedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                  )}
                  {w.userTransactionSignature && (
                    <div className="flex justify-between items-center py-1.5">
                      <span className="text-[12px]" style={{ fontFamily: 'var(--font-pixel), Georgia, serif', color: T.textSecondary }}>Tx</span>
                      <span className="font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>{w.userTransactionSignature.slice(0, 12)}...</span>
                    </div>
                  )}
                  {w.userLastError && <p className="text-[11px] mt-2" style={{ color: T.amber }}>{w.userLastError}</p>}
                </CozyCard>
              );
            })
          )}
        </div>

        {/* Right: Per Course + Closed Windows */}
        <div>
          {/* Per Course */}
          {activeCourseIds.length > 0 && (
            <div className="mb-5">
              <CozySectionLabel>Per Course Status</CozySectionLabel>
              {activeCourseIds.map((courseId) => {
                const state = courseStates[courseId];
                const course = courses.find((c) => c.id === courseId);
                if (!state || !course) return null;
                const isActive = courseId === activeCourseId;
                const saversRemaining = Math.max(0, 3 - state.saverCount);

                return (
                  <CozyCard key={courseId} className="mb-3" style={{ padding: 18 }}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[14px] font-bold font-pixel" style={{ color: T.textPrimary }}>{course.title}</p>
                      {isActive && (
                        <span className="font-pixel-mono text-[10px] uppercase tracking-[1px] px-2.5 py-0.5 rounded-xl" style={{ color: T.amber, background: 'rgba(212,160,74,0.08)', border: '1px solid rgba(212,160,74,0.15)' }}>
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px dashed rgba(255,255,255,0.04)' }}>
                      <span className="text-[12px]" style={{ fontFamily: 'var(--font-pixel), Georgia, serif', color: T.textSecondary }}>Redirect Active</span>
                      <span className="text-[13px] font-bold font-pixel-mono" style={{ color: T.green }}>{Math.round((state.currentYieldRedirectBps ?? 0) / 100)}%</span>
                    </div>
                    <div className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px dashed rgba(255,255,255,0.04)' }}>
                      <span className="text-[12px]" style={{ fontFamily: 'var(--font-pixel), Georgia, serif', color: T.textSecondary }}>Savers Remaining</span>
                      <span className="text-[13px] font-bold font-pixel-mono" style={{ color: T.green }}>{saversRemaining}/3</span>
                    </div>
                    <div className="flex justify-between items-center py-1.5">
                      <span className="text-[12px]" style={{ fontFamily: 'var(--font-pixel), Georgia, serif', color: T.textSecondary }}>Recovery Mode</span>
                      <span className="text-[13px] font-bold font-pixel-mono" style={{ color: state.saverRecoveryMode ? T.green : T.green }}>{state.saverRecoveryMode ? 'Active' : 'Inactive'}</span>
                    </div>
                  </CozyCard>
                );
              })}
            </div>
          )}

          {/* Closed Windows */}
          <CozySectionLabel>Closed Windows</CozySectionLabel>
          {loading ? (
            <CozyCard><p className="text-[13px]" style={{ color: T.textSecondary }}>Loading...</p></CozyCard>
          ) : history.length === 0 && !error ? (
            <CozyCard><p className="text-[13px]" style={{ color: T.textSecondary }}>No closed windows yet.</p></CozyCard>
          ) : (
            history.map((w) => {
              const wStatus = renderWindowStatus(w.status);
              return (
                <CozyCard key={`window-${w.windowId}`} className="mb-3" style={{ padding: 18 }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[14px] font-bold font-pixel" style={{ color: T.textPrimary }}>{w.windowLabel}</p>
                    <span
                      className="font-pixel-mono text-[10px] uppercase tracking-[1px] px-2.5 py-0.5 rounded-xl"
                      style={{ color: statusColor(wStatus), background: statusBg(wStatus), border: `1px solid ${statusColor(wStatus)}30` }}
                    >
                      {wStatus}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center">
                      <p className="font-pixel-mono text-[9px] uppercase" style={{ color: T.textMuted }}>Total</p>
                      <p className="text-[13px] font-bold font-pixel-mono" style={{ color: T.textPrimary }}>{w.totalRedirectedAmountUi}</p>
                    </div>
                    <div className="text-center">
                      <p className="font-pixel-mono text-[9px] uppercase" style={{ color: T.textMuted }}>Distributed</p>
                      <p className="text-[13px] font-bold font-pixel-mono" style={{ color: T.green }}>{w.distributedAmountUi}</p>
                    </div>
                    <div className="text-center">
                      <p className="font-pixel-mono text-[9px] uppercase" style={{ color: T.textMuted }}>Remaining</p>
                      <p className="text-[13px] font-bold font-pixel-mono" style={{ color: T.textMuted }}>{w.remainingAmountUi}</p>
                    </div>
                  </div>
                  <p className="font-pixel-mono text-[9px] mt-2" style={{ color: T.textMuted }}>
                    {w.eligibleRecipientCount} eligible · {w.distributionCount} paid · {w.redirectCount} redirected
                  </p>
                </CozyCard>
              );
            })
          )}
        </div>
      </div>

      {/* How Distribution Works */}
      <CozyCard className="mt-5 mb-8" style={{ padding: 24 }}>
        <p className="text-sm font-semibold mb-2" style={{ fontFamily: 'var(--font-pixel), Georgia, serif', color: T.textMuted }}>
          How Distribution Works
        </p>
        <p className="text-[13px] leading-7" style={{ color: T.textSecondary }}>
          When players break their streak, a percentage of their yield is redirected to the Community Pot.
          This pool is distributed among active streak holders proportional to their streak length.
          The longer you maintain your streak, the larger your share.
        </p>
      </CozyCard>
      </div>
    </div>
  );
}
