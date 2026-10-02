'use client';

import { useCallback, useEffect, useState } from 'react';
import { T } from '../../components/theme';
import { CozyButton, CozyCard, COZY_BORDER, COZY_TEXT, COZY_TEXT_SHADOW } from '../../components/cozy';
import { fetchWithAuth } from '../../services/api/httpClient';
import { ApiError } from '../../services/api/errors';
import { getSeason, getMyStake, stakeSeason, getStakeableCourses } from '../../services/api/arena/arenaApi';
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

// A losing stake swaps the card's teal edge for crimson at the same strength
// as COZY_BORDER, so the warning is not fainter than a normal card.
const DANGER_BORDER = 'rgba(255,68,102,0.55)';
// Card eyebrow labels in the cozy amber; secondary copy in the stronger muted
// white. Both carry the cozy shadow so small text holds up on the glass.
const EYEBROW_TEXT = { color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW };
const MUTED_TEXT = { color: T.textMutedStrong, textShadow: COZY_TEXT_SHADOW };

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

export function StakePanel({
  onLiveStakeChange,
}: {
  /** Called with the live stake entry, or null when nothing is at stake. */
  onLiveStakeChange?: (live: ArenaStakeEntry | null) => void;
} = {}) {
  const [season, setSeason] = useState<ArenaSeason | null>(null);
  const [stake, setStake] = useState<ArenaStakeEntry | null>(null);
  const [courses, setCourses] = useState<StakeableCourse[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [s, k, e, cat, elig] = await Promise.all([
        getSeason().catch(() => null),
        fetchWithAuth((t) => getMyStake(t)).catch(() => null),
        fetchWithAuth((t) => getUserEnrollments(t)).catch(() => null),
        listCourses().catch(() => []),
        fetchWithAuth((t) => getStakeableCourses(t)).catch(() => ({ courseIds: [] })),
      ]);
      const eligibleIds = elig?.courseIds ?? [];
      if (!live) return;
      setSeason(s);
      setStake(k);
      onLiveStakeChange?.(k && k.outcome === 'PENDING' && k.isCurrentSeason !== false ? k : null);
      // Real titles, not course ids — the picker used to show the reader
      // "blockchain-wallets".
      const titleById = new Map(cat.map((c) => [c.id, c.title]));
      setTitles(Object.fromEntries(titleById));

      // The server decides what is stakeable, using the very same check the
      // opt-in gate runs. Enrollment is not enough — a course in practice mode
      // has no principal locked and a finished course has its tier frozen —
      // and inferring it here from a second data source is how the list ends
      // up promising something the gate then refuses.
      const lapsesById = new Map(
        (e?.enrollments ?? []).map((x) => [x.courseId, x.runtime?.lapseCount ?? 0]),
      );
      setCourses(
        eligibleIds.map((id) => ({
          id,
          title: titleById.get(id) ?? id,
          keptPct: combinedKeptBps(lapsesById.get(id) ?? 0, 0) / 100,
        })),
      );
      setLoaded(true);
    })();
    return () => { live = false; };
  }, [onLiveStakeChange]);

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
      onLiveStakeChange?.(fresh && fresh.outcome === 'PENDING' ? fresh : null);
      setConfirming(false);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }, [chosen, onLiveStakeChange]);

  const titleOf = (id: string) => titles[id] ?? id;

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
      // The <section> keeps its test id and live region; the glass is the
      // CozyCard inside it (CozyCard always renders a <div>).
      <section className="mb-5" data-testid="arena-stake-standing" aria-live="polite">
        <CozyCard style={{ borderColor: d.tone === 'danger' ? DANGER_BORDER : COZY_BORDER }}>
          <div className="font-pixel-mono text-[10px] uppercase tracking-[1px]" style={EYEBROW_TEXT}>
            {live ? 'Your stake this season' : 'Your last staked season'}
          </div>

          <div
            className="mt-1 font-pixel text-[15px]"
            style={{ color: TONE_COLOR[d.tone], textShadow: COZY_TEXT_SHADOW }}
            data-testid="arena-stake-headline"
          >
            {d.headline}
          </div>

          {/* Body face on purpose: the detail quotes yield percentages ("keeps
              50% ... instead of 100%"), and both pixel faces draw 5 like S. */}
          <p className="mt-2 text-[12px] leading-relaxed" style={MUTED_TEXT}>
            {d.detail}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <dt className="font-pixel-mono text-[9px] uppercase tracking-[1px]" style={MUTED_TEXT}>
                Staked course
              </dt>
              {/* A course title, so Pixelify Sans (it has lowercase). */}
              <dd
                className="mt-0.5 font-pixel text-[13px] break-words"
                style={{ color: T.textPrimary, textShadow: COZY_TEXT_SHADOW }}
              >
                {titleOf(stake.courseId)}
              </dd>
            </div>
            <div>
              <dt className="font-pixel-mono text-[9px] uppercase tracking-[1px]" style={MUTED_TEXT}>
                Staked rating
              </dt>
              <dd
                className="mt-0.5 font-pixel-mono text-[15px] font-bold"
                style={{
                  color: TONE_COLOR[d.tone],
                  textShadow: COZY_TEXT_SHADOW,
                  fontVariantNumeric: 'tabular-nums',
                }}
                data-testid="arena-stake-delta"
              >
                {stake.stakedDelta > 0 ? `+${stake.stakedDelta}` : stake.stakedDelta}
              </dd>
            </div>
          </dl>
        </CozyCard>
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
      <section className="mb-3" data-testid="arena-stake-settled">
        <CozyCard style={{ borderColor: settled.tone === 'danger' ? DANGER_BORDER : COZY_BORDER }}>
          <div className="font-pixel-mono text-[10px] uppercase tracking-[1px]" style={EYEBROW_TEXT}>
            Your last staked season
          </div>
          <div
            className="mt-1 font-pixel text-[15px]"
            style={{ color: TONE_COLOR[settled.tone], textShadow: COZY_TEXT_SHADOW }}
          >
            {settled.headline}
          </div>
          {/* Body face: quotes yield percentages, see the live card above. */}
          <p className="mt-2 text-[12px] leading-relaxed" style={MUTED_TEXT}>
            {settled.detail}
          </p>
          <p className="mt-1 font-pixel-mono text-[11px]" style={MUTED_TEXT}>
            Staked {titleOf(settledStake.courseId)}.
          </p>
        </CozyCard>
      </section>
    )}
    <section className="mb-5" data-testid="arena-stake-optin">
      {/* z-20: backdrop-filter makes every CozyCard its own stacking context,
          which would trap the course dropdown's z-50 inside this card and let
          the glass cards and buttons below paint over the open list. */}
      <CozyCard className="z-20">
        <div className="font-pixel-mono text-[10px] uppercase tracking-[1px]" style={EYEBROW_TEXT}>
          Stake a course
        </div>

        <p className="mt-1.5 font-pixel-mono text-[12px] leading-relaxed" style={MUTED_TEXT}>
          Required to enter. Put a locked course on the line for this season.
        </p>

        <div className="mt-3">
          <CourseSelect
            courses={courses}
            value={chosen}
            onChange={(id) => { setChosen(id); setConfirming(false); setError(null); }}
          />
        </div>

        {courses.length === 0 && (
          <p className="mt-2 font-pixel-mono text-[11px] leading-relaxed" style={MUTED_TEXT}>
            Nothing to stake yet — you need a course with USDC still locked in it.
            Practice-mode and finished courses cannot be staked.
          </p>
        )}

        {/* The bet, in two numbers, read off the course actually selected. */}
        {chosenCourse && (
          <div className="mt-3">
            <YieldLadder lapseCount={chosenLapses} />
          </div>
        )}

        <p className="mt-2.5 font-pixel-mono text-[11px] leading-relaxed" style={MUTED_TEXT}>
          {days > 0 ? `${days} ${days === 1 ? 'day' : 'days'} left · ` : ''}
          no early exit once staked · worth cents today, not dollars
        </p>

        {error && (
          <p
            className="mt-2 font-pixel-mono text-[12px]"
            style={{ color: T.crimson, textShadow: COZY_TEXT_SHADOW }}
            data-testid="arena-stake-error"
          >
            {error}
          </p>
        )}

        {/* Opening the confirm step is a tint; only the final, irreversible
            "Yes" gets the solid call-to-action button. */}
        {!confirming ? (
          <CozyButton
            data-testid="arena-stake-submit"
            className="mt-3 w-full"
            disabled={!chosen || busy}
            onClick={() => setConfirming(true)}
          >
            Stake this course
          </CozyButton>
        ) : (
          <div className="mt-3" data-testid="arena-stake-confirm">
            <p
              className="font-pixel-mono text-[12px] leading-relaxed"
              style={{ color: T.textPrimary, textShadow: COZY_TEXT_SHADOW }}
            >
              Stake <strong style={{ color: COZY_TEXT }}>{titleOf(chosen)}</strong> for the whole season?
              This cannot be undone.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <CozyButton
                variant="solid"
                data-testid="arena-stake-confirm-yes"
                className="flex-1"
                disabled={busy}
                onClick={onStake}
              >
                {busy ? 'Staking…' : 'Yes, stake it'}
              </CozyButton>
              <CozyButton
                data-testid="arena-stake-confirm-no"
                className="flex-1"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </CozyButton>
            </div>
          </div>
        )}
      </CozyCard>
    </section>
    </>
  );
}
