'use client';

import { useCallback, useEffect, useState } from 'react';
import { T } from '../../components/theme';
import { fetchWithAuth } from '../../services/api/httpClient';
import { ApiError } from '../../services/api/errors';
import { getSeason, getMyStake, stakeSeason } from '../../services/api/arena/arenaApi';
import { getUserEnrollments } from '../../services/api/progress/progressApi';
import { listCourses } from '../../services/api/content/contentApi';
import { CourseSelect, type StakeableCourse } from './CourseSelect';
import { YieldLadder } from './YieldLadder';
import { describeStake, daysRemaining, type StakeTone } from '../../lib/arenaStake';
import { combinedKeptBps } from '../../components/v2/PenaltyBanner';
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
  const [courses, setCourses] = useState<StakeableCourse[]>([]);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [s, k, e, cat] = await Promise.all([
        getSeason().catch(() => null),
        fetchWithAuth((t) => getMyStake(t)).catch(() => null),
        fetchWithAuth((t) => getUserEnrollments(t)).catch(() => null),
        listCourses().catch(() => []),
      ]);
      if (!live) return;
      setSeason(s);
      setStake(k);
      // Real titles, not course ids — the picker used to show the reader
      // "blockchain-wallets". Finished courses are left out entirely: offering
      // one just to reject it on submit is worse than not listing it.
      const titleById = new Map(cat.map((c) => [c.id, c.title]));
      setCourses(
        (e?.enrollments ?? [])
          .filter((x) => !x.runtime?.courseCompletedAt)
          .map((x) => ({
            id: x.courseId,
            title: titleById.get(x.courseId) ?? x.courseId,
            keptPct: combinedKeptBps(x.runtime?.lapseCount ?? 0, 0) / 100,
          })),
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
      await fetchWithAuth((t) => stakeSeason(t, chosen, CONSENT_VERSION));
      // Re-read rather than trusting the POST body. That response is the raw
      // inserted row — it has no live delta, no season end, no lapse count and
      // no isCurrentSeason, all of which this panel renders. Using it directly
      // showed a freshly staked player the "last staked season" block instead
      // of their standing.
      const fresh = await fetchWithAuth((t) => getMyStake(t));
      setStake(fresh);
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
  // PENDING means the stake is still riding, including in the window between a
  // season ending and the cron settling it. `!== false` rather than a truthy
  // check so a response that omits the flag reads as live: a staked player
  // must never be shown a settled result they have not actually got yet.
  const liveStake = stake && stake.outcome === 'PENDING' && stake.isCurrentSeason !== false
    ? stake
    : null;
  const settledStake = stake && stake.outcome !== 'PENDING' ? stake : null;

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
  const chosenCourse = courses.find((c) => c.id === chosen) ?? null;
  // keptPct is combinedKeptBps(lapses, 0)/100, so invert it back to the tier
  // index the ladder needs: 100 -> 0 lapses, 50 -> 1, 0 -> 2.
  const chosenLapses = chosenCourse
    ? (chosenCourse.keptPct === 100 ? 0 : chosenCourse.keptPct === 50 ? 1 : 2)
    : 0;
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

      <p className="mt-1.5 text-[12px]" style={{ color: T.textMutedStrong }}>
        Put a locked course on the line for this season.
      </p>

      <div className="mt-3">
        <CourseSelect
          courses={courses}
          value={chosen}
          onChange={(id) => { setChosen(id); setConfirming(false); setError(null); }}
        />
      </div>

      {courses.length === 0 && (
        <p className="mt-2 text-[11px]" style={{ color: T.textMuted }}>
          You have no locked courses yet. Lock one to stake a season.
        </p>
      )}

      {/* The bet, in two numbers, read off the course actually selected. */}
      {chosenCourse && (
        <div className="mt-3">
          <YieldLadder lapseCount={chosenLapses} />
        </div>
      )}

      <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: T.textMuted }}>
        {days > 0 ? `${days} ${days === 1 ? 'day' : 'days'} left · ` : ''}
        no early exit once staked · worth cents today, not dollars
      </p>

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
