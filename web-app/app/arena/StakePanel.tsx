'use client';

import { useCallback, useEffect, useState } from 'react';
import { T } from '../../components/theme';
import { fetchWithAuth } from '../../services/api/httpClient';
import { ApiError } from '../../services/api/errors';
import { getSeason, getMyStake, stakeSeason } from '../../services/api/arena/arenaApi';
import { getUserEnrollments } from '../../services/api/progress/progressApi';
import { describeStake, daysRemaining, type StakeTone } from '../../lib/arenaStake';
import type { ArenaSeason, ArenaStakeEntry } from '../../types/arena';

// Versioned so a later change of terms is distinguishable from this one in
// arena.season_entries.consent_version.
const CONSENT_VERSION = 'arena-stake-v1';

const TONE_COLOR: Record<StakeTone, string> = {
  neutral: T.textPrimary,
  good: T.green,
  danger: T.crimson,
};

function messageFor(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === 'ARENA_STAKE_NO_LOCK') {
    return 'You need an active lock on that course before you can stake it.';
  }
  if (code === 'ARENA_STAKE_COURSE_SETTLED') {
    return 'That course is already finished — its yield is locked in and cannot be staked.';
  }
  if (code === 'ARENA_SEASON_CLOSED') {
    return 'No season is open right now. Check back shortly.';
  }
  return 'Could not stake that course. Try again in a moment.';
}

export function StakePanel() {
  const [season, setSeason] = useState<ArenaSeason | null>(null);
  const [stake, setStake] = useState<ArenaStakeEntry | null>(null);
  const [courses, setCourses] = useState<string[]>([]);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [s, k, e] = await Promise.all([
        getSeason().catch(() => null),
        fetchWithAuth((t) => getMyStake(t)).catch(() => null),
        fetchWithAuth((t) => getUserEnrollments(t)).catch(() => null),
      ]);
      if (!live) return;
      setSeason(s);
      setStake(k);
      // Only courses that can actually be staked. Offering a finished course
      // just to reject it on submit is a worse experience than not listing it.
      setCourses(
        (e?.enrollments ?? [])
          .filter((x) => !x.runtime?.courseCompletedAt)
          .map((x) => x.courseId),
      );
      setLoaded(true);
    })();
    return () => { live = false; };
  }, []);

  const onStake = useCallback(async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchWithAuth((t) => stakeSeason(t, chosen, CONSENT_VERSION));
      setStake(r.entry);
      setConfirming(false);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }, [chosen]);

  // Nothing to say until we know whether a season exists.
  if (!loaded || (!season && !stake)) return null;

  // A stake is "live" only while its own season is still running. A settled one
  // is a result to read once, not a state to be stuck in — otherwise staking
  // is a thing a wallet can do exactly once, ever.
  const liveStake = stake && stake.outcome === 'PENDING' && stake.isCurrentSeason
    ? stake
    : null;
  const settledStake = stake && stake !== liveStake ? stake : null;

  // ---------- Staked right now: the standing indicator ----------
  if (liveStake) {
    const d = describeStake(liveStake);
    const live = true;
    const stake = liveStake;
    return (
      <section
        className="mb-5 rounded-lg p-4"
        style={{
          background: T.bgCard,
          border: `1px solid ${d.tone === 'danger' ? 'rgba(255,68,102,0.38)' : T.borderAlive}`,
        }}
        data-testid="arena-stake-standing"
        aria-live="polite"
      >
        <div
          className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
          style={{ color: T.textMuted }}
        >
          {live ? 'Your stake this season' : 'Your last staked season'}
        </div>

        <div
          className="mt-1 font-pixel text-[15px]"
          style={{ color: TONE_COLOR[d.tone] }}
          data-testid="arena-stake-headline"
        >
          {d.headline}
        </div>

        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: T.textMutedStrong }}>
          {d.detail}
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <dt
              className="font-pixel-mono text-[9px] uppercase tracking-[1px]"
              style={{ color: T.textMuted }}
            >
              Staked course
            </dt>
            <dd className="mt-0.5 text-[12px] break-words" style={{ color: T.textPrimary }}>
              {stake.courseId}
            </dd>
          </div>
          <div>
            <dt
              className="font-pixel-mono text-[9px] uppercase tracking-[1px]"
              style={{ color: T.textMuted }}
            >
              Staked rating
            </dt>
            <dd
              className="mt-0.5 font-pixel text-[14px]"
              style={{ color: TONE_COLOR[d.tone], fontVariantNumeric: 'tabular-nums' }}
              data-testid="arena-stake-delta"
            >
              {stake.stakedDelta > 0 ? `+${stake.stakedDelta}` : stake.stakedDelta}
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  // ---------- Not staked this season: last result, then the opt-in ----------
  const days = season ? daysRemaining(season.endsAt) : 0;
  const settled = settledStake ? describeStake(settledStake) : null;

  return (
    <>
    {settled && settledStake && (
      <section
        className="mb-3 rounded-lg p-4"
        style={{
          background: T.bgCard,
          border: `1px solid ${settled.tone === 'danger' ? 'rgba(255,68,102,0.38)' : T.borderAlive}`,
        }}
        data-testid="arena-stake-settled"
      >
        <div
          className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
          style={{ color: T.textMuted }}
        >
          Your last staked season
        </div>
        <div className="mt-1 font-pixel text-[15px]" style={{ color: TONE_COLOR[settled.tone] }}>
          {settled.headline}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: T.textMutedStrong }}>
          {settled.detail}
        </p>
        <p className="mt-1 text-[11px]" style={{ color: T.textMuted }}>
          Staked {settledStake.courseId}.
        </p>
      </section>
    )}
    <section
      className="mb-5 rounded-lg p-4"
      style={{ background: T.bgCard, border: `1px solid ${T.borderDormant}` }}
      data-testid="arena-stake-optin"
    >
      <div
        className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
        style={{ color: T.textMuted }}
      >
        Stake a course
      </div>

      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: T.textMutedStrong }}>
        Put one of your locked courses on this season. Finish level or ahead across your staked
        matches and it keeps <strong style={{ color: T.green }}>all</strong> of its yield. Finish
        behind and it keeps <strong style={{ color: T.crimson }}>half</strong> instead.{' '}
        <strong style={{ color: T.textPrimary }}>Your deposit is never at risk either way.</strong>
      </p>

      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: T.textMuted }}>
        Yields here are small today — the difference is currently worth cents, not dollars.
        {days > 0 ? ` ${days} ${days === 1 ? 'day' : 'days'} left in this season.` : ''} Once you
        stake, it is bound for the whole season; there is no early exit.
      </p>

      <label
        className="mt-3 block font-pixel-mono text-[9px] uppercase tracking-[1px]"
        style={{ color: T.textMuted }}
        htmlFor="arena-stake-course"
      >
        Course
      </label>
      <select
        id="arena-stake-course"
        data-testid="arena-stake-course"
        className="mt-1 w-full rounded-md px-3 py-2 text-[12px]"
        style={{
          background: T.bgCardActive,
          border: `1px solid ${T.borderDormant}`,
          color: T.textPrimary,
        }}
        value={chosen}
        onChange={(e) => { setChosen(e.target.value); setConfirming(false); setError(null); }}
      >
        <option value="">Choose a locked course…</option>
        {courses.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      {courses.length === 0 && (
        <p className="mt-2 text-[11px]" style={{ color: T.textMuted }}>
          You have no locked courses yet. Lock one to stake a season.
        </p>
      )}

      {error && (
        <p className="mt-2 text-[12px]" style={{ color: T.crimson }} data-testid="arena-stake-error">
          {error}
        </p>
      )}

      {!confirming ? (
        <button
          type="button"
          data-testid="arena-stake-submit"
          className="mt-3 w-full rounded-lg px-4 py-2.5 font-pixel text-[13px] transition-colors disabled:opacity-40"
          style={{
            background: T.bgCardActive,
            border: `1px solid ${T.borderAlive}`,
            color: T.amber,
          }}
          disabled={!chosen || busy}
          onClick={() => setConfirming(true)}
        >
          Stake this course
        </button>
      ) : (
        <div className="mt-3" data-testid="arena-stake-confirm">
          <p className="text-[12px] leading-relaxed" style={{ color: T.textPrimary }}>
            Stake <strong style={{ color: T.amber }}>{chosen}</strong> for the whole season?
            This cannot be undone.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="arena-stake-confirm-yes"
              className="flex-1 rounded-lg px-4 py-2.5 font-pixel text-[13px] transition-colors disabled:opacity-40"
              style={{
                background: 'rgba(212,160,74,0.10)',
                border: `1px solid ${T.borderAlive}`,
                color: T.amber,
              }}
              disabled={busy}
              onClick={onStake}
            >
              {busy ? 'Staking…' : 'Yes, stake it'}
            </button>
            <button
              type="button"
              data-testid="arena-stake-confirm-no"
              className="flex-1 rounded-lg px-4 py-2.5 font-pixel text-[13px] transition-colors disabled:opacity-40"
              style={{
                background: T.bgCardActive,
                border: `1px solid ${T.borderDormant}`,
                color: T.textMutedStrong,
              }}
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
    </>
  );
}
