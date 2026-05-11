'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCourseStore } from '@/stores';
import { getCommunityPotHistory } from '@/services/api/progress/progressApi';
import { fetchWithAuth } from '@/services/api/httpClient';
import type { CommunityPotHistoryWindow } from '@/services/api/types';
import { T } from '@/components/theme';
import { CozyCard, CozySectionLabel } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';

const AMBER = '#FFD580';

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

const statusColor = (s: string) =>
  s === 'Paid' || s === 'Distributed'
    ? T.green
    : s === 'Failed'
      ? T.crimson
      : s === 'Not eligible'
        ? T.textMuted
        : T.textSecondary;

const statusBg = (s: string) =>
  s === 'Paid' || s === 'Distributed'
    ? 'rgba(62,230,138,0.08)'
    : s === 'Failed'
      ? 'rgba(255,68,102,0.08)'
      : 'rgba(255,255,255,0.04)';

export default function CommunityPotPage() {
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const activeCourseIds = useCourseStore((s) => s.activeCourseIds);
  const courseStates = useCourseStore((s) => s.courseStates);
  const courses = useCourseStore((s) => s.courses);
  const [history, setHistory] = useState<CommunityPotHistoryWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bgFailed, setBgFailed] = useState(false);

  const fetchPotData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const resp = await fetchWithAuth((token) => getCommunityPotHistory(token));
      if (signal?.aborted) return;
      if (!resp) {
        setError('Connect wallet to view community pot.');
        setLoading(false);
        return;
      }
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
    return () => {
      controller.abort();
    };
  }, [fetchPotData]);

  // Resolve "current" window: prefer an OPEN entry, else the newest item.
  const currentWindow =
    history.find((w) => w.status === 'OPEN') ?? history[0] ?? null;
  const currentPotAmount = currentWindow?.totalRedirectedAmountUi ?? '0';
  const currentLabel = currentWindow
    ? `${currentWindow.windowLabel} · ${renderWindowStatus(currentWindow.status)}`
    : `${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })} · Open`;

  // Sort timeline newest first by closedAt (fall back to original order, which
  // the API returns newest-first already).
  const events = [...history].sort((a, b) => {
    const aTime = a.closedAt ? Date.parse(a.closedAt) : Number.MAX_SAFE_INTEGER;
    const bTime = b.closedAt ? Date.parse(b.closedAt) : Number.MAX_SAFE_INTEGER;
    return bTime - aTime;
  });

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      {/* Tavern interior backdrop — fixed, pixelated, with onError fallback. */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {!bgFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/images/tavern/tavernbackground.png"
            alt=""
            draggable={false}
            className="w-full h-full object-cover select-none"
            style={{ imageRendering: 'pixelated' }}
            onError={() => setBgFailed(true)}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(14,14,28,0.30) 0%, rgba(14,14,28,0.55) 60%, rgba(14,14,28,0.78) 100%)',
          }}
        />
      </div>

      <HubButton />

      <div className="relative z-10 max-w-[1100px] mx-auto px-[18px] pb-20">
        <div className="pt-20" />

        <h1
          className="text-3xl font-bold tracking-wide mb-1"
          style={{
            fontFamily: 'var(--font-pixel), Georgia, serif',
            color: AMBER,
            textShadow: '0 1px 2px rgba(0,0,0,0.85)',
          }}
        >
          Community Pot
        </h1>
        <div className="mb-5" />

        {/* Hero strip: pot + per-course chips */}
        <CozyCard className="mb-5" style={{ padding: 20 }}>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p
                className="font-pixel-mono text-[10px] uppercase tracking-[2px]"
                style={{ color: T.textMuted }}
              >
                Current Window Pot
              </p>
              {loading ? (
                <p
                  className="text-[13px] mt-2"
                  style={{ color: T.textSecondary }}
                >
                  Reading live pot state...
                </p>
              ) : (
                <>
                  <div className="flex items-baseline gap-2 mt-1">
                    <p
                      className="text-3xl font-bold font-pixel-mono leading-none"
                      style={{ color: T.green }}
                    >
                      {currentPotAmount}
                    </p>
                    <span
                      className="text-[13px] font-pixel-mono"
                      style={{ color: T.green, opacity: 0.6 }}
                    >
                      USDC
                    </span>
                  </div>
                  <p
                    className="font-pixel-mono text-[10px] uppercase tracking-[1.5px] mt-1"
                    style={{ color: AMBER, opacity: 0.85 }}
                  >
                    {currentLabel}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Per-course chip strip */}
          {activeCourseIds.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {activeCourseIds.map((courseId) => {
                const state = courseStates[courseId];
                const course = courses.find((c) => c.id === courseId);
                if (!state || !course) return null;
                const isActive = courseId === activeCourseId;
                const pct = Math.round((state.currentYieldRedirectBps ?? 0) / 100);
                const saversRemaining = Math.max(0, 3 - state.saverCount);
                return (
                  <div
                    key={courseId}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                    style={{
                      backgroundColor: isActive
                        ? 'rgba(212,160,74,0.10)'
                        : 'rgba(255,255,255,0.04)',
                      border: isActive
                        ? '1px solid rgba(212,160,74,0.25)'
                        : '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <span
                      className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
                      style={{ color: isActive ? T.amber : T.textSecondary }}
                    >
                      {course.title}
                    </span>
                    <span
                      className="font-pixel-mono text-[11px] font-bold"
                      style={{ color: T.green }}
                    >
                      {pct}%
                    </span>
                    <span
                      className="font-pixel-mono text-[10px]"
                      style={{ color: T.textMuted }}
                    >
                      {state.saverRecoveryMode
                        ? 'Recovery'
                        : `${saversRemaining}/3 savers`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {error && (
            <div className="mt-4">
              <p className="text-[11px]" style={{ color: T.amber }}>
                {error}
              </p>
              <button
                onClick={() => {
                  setError(null);
                  void fetchPotData();
                }}
                className="mt-2 px-4 py-2 rounded-md border text-[11px] font-semibold uppercase tracking-wide"
                style={{
                  borderColor: `${T.amber}30`,
                  backgroundColor: 'rgba(212,160,74,0.08)',
                  color: T.amber,
                }}
              >
                Retry
              </button>
            </div>
          )}
        </CozyCard>

        {/* Timeline */}
        <CozySectionLabel>Window History</CozySectionLabel>

        {loading ? (
          <CozyCard>
            <p className="text-[13px]" style={{ color: T.textSecondary }}>
              Loading...
            </p>
          </CozyCard>
        ) : events.length === 0 && !error ? (
          <CozyCard>
            <p className="text-[13px]" style={{ color: T.textSecondary }}>
              No windows yet.
            </p>
          </CozyCard>
        ) : (
          <div className="relative pl-[80px] md:pl-[140px]">
            {/* Vertical rail */}
            <div
              className="absolute top-2 bottom-2 w-px left-[60px] md:left-[90px]"
              style={{
                backgroundColor: `${AMBER}30`,
              }}
              aria-hidden
            />

            {events.map((w) => {
              const userPaid = w.userStatus === 'DISTRIBUTED';
              const wStatus = renderWindowStatus(w.status);
              const dotColor = userPaid
                ? T.green
                : w.status === 'OPEN'
                  ? T.amber
                  : T.textMuted;

              return (
                <div key={`event-${w.windowId}`} className="relative mb-5">
                  {/* Date marker (left of rail) */}
                  <div
                    className="absolute -left-[80px] md:-left-[140px] top-2 w-[56px] md:w-[100px] text-right"
                    style={{ color: T.textSecondary }}
                  >
                    <p
                      className="font-pixel-mono text-[12px] font-bold uppercase tracking-[1px]"
                      style={{ color: AMBER, opacity: 0.85 }}
                    >
                      {w.windowLabel}
                    </p>
                    <p
                      className="font-pixel-mono text-[9px] uppercase tracking-[1px] mt-0.5"
                      style={{ color: T.textMuted }}
                    >
                      {wStatus}
                    </p>
                  </div>

                  {/* Dot on rail */}
                  <div
                    className="absolute w-3 h-3 rounded-full -left-[24px] md:-left-[36px]"
                    style={{
                      top: 8,
                      backgroundColor: dotColor,
                      boxShadow: `0 0 0 3px rgba(14,14,28,0.85), 0 0 8px ${dotColor}80`,
                    }}
                    aria-hidden
                  />

                  {/* Event card */}
                  <CozyCard
                    style={{
                      padding: 18,
                      borderLeftWidth: userPaid ? 3 : 1,
                      borderLeftColor: userPaid
                        ? T.green
                        : 'rgba(58, 143, 168, 0.55)',
                      backgroundColor: userPaid
                        ? 'rgba(62,230,138,0.06)'
                        : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p
                        className="text-[14px] font-bold font-pixel"
                        style={{ color: userPaid ? T.green : T.textPrimary }}
                      >
                        {userPaid
                          ? 'You were paid'
                          : `Window ${wStatus.toLowerCase()}`}
                      </p>
                      {userPaid && w.userPayoutAmountUi && (
                        <span
                          className="text-[14px] font-bold font-pixel-mono"
                          style={{ color: T.green }}
                        >
                          +{w.userPayoutAmountUi} USDC
                        </span>
                      )}
                      {!userPaid &&
                        (w.userStatus === 'FAILED' ||
                          w.userStatus === 'PUBLISHING' ||
                          w.userStatus === 'PENDING') && (
                          <span
                            className="font-pixel-mono text-[10px] uppercase tracking-[1px] px-2.5 py-0.5 rounded-xl"
                            style={{
                              color: statusColor(
                                renderRecipientStatus(w.userStatus),
                              ),
                              background: statusBg(
                                renderRecipientStatus(w.userStatus),
                              ),
                              border: `1px solid ${statusColor(renderRecipientStatus(w.userStatus))}30`,
                            }}
                          >
                            {renderRecipientStatus(w.userStatus)}
                          </span>
                        )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                      <div>
                        <p
                          className="font-pixel-mono text-[9px] uppercase tracking-[1px]"
                          style={{ color: T.textMuted }}
                        >
                          Total Pot
                        </p>
                        <p
                          className="text-[12px] font-bold font-pixel-mono mt-0.5"
                          style={{ color: T.textPrimary }}
                        >
                          {w.totalRedirectedAmountUi}
                        </p>
                      </div>
                      <div>
                        <p
                          className="font-pixel-mono text-[9px] uppercase tracking-[1px]"
                          style={{ color: T.textMuted }}
                        >
                          Distributed
                        </p>
                        <p
                          className="text-[12px] font-bold font-pixel-mono mt-0.5"
                          style={{ color: T.green }}
                        >
                          {w.distributedAmountUi}
                        </p>
                      </div>
                      <div>
                        <p
                          className="font-pixel-mono text-[9px] uppercase tracking-[1px]"
                          style={{ color: T.textMuted }}
                        >
                          Remaining
                        </p>
                        <p
                          className="text-[12px] font-bold font-pixel-mono mt-0.5"
                          style={{ color: T.textMuted }}
                        >
                          {w.remainingAmountUi}
                        </p>
                      </div>
                    </div>

                    <p
                      className="font-pixel-mono text-[9px] mt-3 pt-3"
                      style={{
                        color: T.textMuted,
                        borderTop: '1px dashed rgba(255,255,255,0.06)',
                      }}
                    >
                      {w.eligibleRecipientCount} eligible ·{' '}
                      {w.distributionCount} paid · {w.redirectCount} redirected
                    </p>

                    {userPaid && w.userDistributedAt && (
                      <p
                        className="font-pixel-mono text-[10px] mt-2"
                        style={{ color: T.textMuted }}
                      >
                        Paid{' '}
                        {new Date(w.userDistributedAt).toLocaleDateString(
                          'en-US',
                          {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          },
                        )}
                        {w.userTransactionSignature && (
                          <>
                            {' · tx '}
                            {w.userTransactionSignature.slice(0, 12)}...
                          </>
                        )}
                      </p>
                    )}

                    {w.userLastError && (
                      <p
                        className="text-[11px] mt-2"
                        style={{ color: T.amber }}
                      >
                        {w.userLastError}
                      </p>
                    )}
                  </CozyCard>
                </div>
              );
            })}
          </div>
        )}

        {/* How Distribution Works */}
        <CozyCard className="mt-6" style={{ padding: 24 }}>
          <p
            className="text-sm font-semibold mb-2"
            style={{
              fontFamily: 'var(--font-pixel), Georgia, serif',
              color: T.textMuted,
            }}
          >
            How Distribution Works
          </p>
          <p
            className="text-[13px] leading-7"
            style={{ color: T.textSecondary }}
          >
            When players break their streak, a percentage of their yield is
            redirected to the Community Pot. This pool is distributed among
            active streak holders proportional to their streak length. The
            longer you maintain your streak, the larger your share.
          </p>
        </CozyCard>
      </div>
    </div>
  );
}
