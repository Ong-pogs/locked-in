'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { T } from '../../../components/theme';
import { ArenaBackground } from '../ArenaBackground';
import { fetchWithAuth } from '../../../services/api/httpClient';
import { answerQuestion, getMatch, getMyArena, startMatch } from '../../../services/api/arena/arenaApi';
import { useUserStore } from '../../../stores/userStore';
import { resolveMatchPhase, type MatchPhase } from '../../../lib/matchPhase';
import type { ArenaMatchState, ArenaQuestion } from '../../../types/arena';

export default function ArenaMatchPage() {
  const params = useParams<{ matchId: string }>();
  const router = useRouter();
  const matchId = params?.matchId as string;

  const [phase, setPhase] = useState<MatchPhase>('loading');
  const [match, setMatch] = useState<ArenaMatchState | null>(null);
  const [question, setQuestion] = useState<ArenaQuestion | null>(null);
  const [answered, setAnswered] = useState(0);
  const [total, setTotal] = useState(7);
  const [remainingMs, setRemainingMs] = useState(20_000);
  const [message, setMessage] = useState<string | null>(null);
  const [ratingDelta, setRatingDelta] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<'pending' | 'correct' | 'wrong' | null>(null);
  const submitting = useRef(false);
  const myWallet = useUserStore((st) => st.walletAddress);

  const loadMatch = useCallback(async () => {
    try {
      const state = await fetchWithAuth((t) => getMatch(t, matchId));
      setMatch(state);
      setTotal(state.questionCount || 7);
      setPhase(resolveMatchPhase({
        resolved: state.resolved,
        players: state.players,
        myWallet,
      }));
    } catch {
      setPhase('error');
      setMessage('This match could not be loaded.');
    }
  }, [matchId, myWallet]);

  useEffect(() => { loadMatch(); }, [loadMatch]);

  // The delta lives on the profile's recent-match list, not on the match
  // itself — the match endpoint deliberately exposes no rating data.
  useEffect(() => {
    if (phase !== 'resolved') return;
    fetchWithAuth((t) => getMyArena(t))
      .then((profile) => {
        const row = profile.recentMatches.find((m) => m.matchId === matchId);
        if (row?.delta != null) setRatingDelta(row.delta);
      })
      .catch(() => setRatingDelta(null));
  }, [phase, matchId]);

  const submit = useCallback(async (questionId: string, optionId: string | null) => {
    if (submitting.current) return;
    submitting.current = true;

    // Acknowledge the tap on the SAME frame. The server round-trip is ~2s
    // (Render us-east talking to Supabase in Singapore), and with no immediate
    // feedback that reads as "my click didn't register" — which is exactly what
    // it looked like.
    setSelected(optionId);
    setVerdict('pending');

    try {
      const res = await fetchWithAuth((t) => answerQuestion(t, matchId, questionId, optionId));
      setVerdict(res.isCorrect ? 'correct' : 'wrong');
      setAnswered(res.answered);

      // Hold the right/wrong state briefly — a quiz that never tells you whether
      // you were right is missing its whole feedback loop.
      await new Promise((r) => setTimeout(r, 650));

      if (res.done) {
        setQuestion(null);
        setPhase('waiting');
        await loadMatch();
      } else {
        setQuestion(res.question);
        setRemainingMs(res.question?.timeoutMs ?? 20_000);
      }
      setSelected(null);
      setVerdict(null);
    } catch {
      setSelected(null);
      setVerdict(null);
      setMessage('That answer did not register. Reload to continue.');
    } finally {
      submitting.current = false;
    }
  }, [matchId, loadMatch]);

  // Display-only countdown. The server stamps served_at and derives the real
  // elapsed time, so a laggy client simply scores a slower answer.
  useEffect(() => {
    if (phase !== 'playing' || !question) return undefined;
    if (verdict) return undefined; // answered — stop the clock visually
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const left = (question.timeoutMs ?? 20_000) - (Date.now() - startedAt);
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        clearInterval(timer);
        submit(question.id, null); // timeout scores as incorrect
      }
    }, 100);
    return () => clearInterval(timer);
  }, [phase, question, submit, verdict]);

  // Keyboard answering — a speed quiz you can only play with a mouse is
  // slower than it needs to be, and the tiebreak is total time.
  useEffect(() => {
    if (phase !== 'playing' || !question || verdict !== null) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const idx = 'abc'.indexOf(k) >= 0 ? 'abc'.indexOf(k) : '123'.indexOf(k);
      const opt = question.options[idx];
      if (idx >= 0 && opt) { e.preventDefault(); submit(question.id, opt.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, question, verdict, submit]);

  async function onStart() {
    try {
      const res = await fetchWithAuth((t) => startMatch(t, matchId));
      setQuestion(res.question);
      setTotal(res.questionsTotal);
      setAnswered(res.answered);
      setRemainingMs(res.question?.timeoutMs ?? 20_000);
      setPhase('playing');
    } catch {
      setMessage('Could not start — you may have already played this match.');
      await loadMatch();
    }
  }

  const me = match?.players.find((p) => p.walletAddress === myWallet) ?? null;
  const them = match?.players.find((p) => p.walletAddress !== myWallet) ?? null;
  let outcome: 'won' | 'lost' | 'draw' = 'draw';
  if (me && them) {
    if ((me.correctCount ?? 0) !== (them.correctCount ?? 0)) {
      outcome = (me.correctCount ?? 0) > (them.correctCount ?? 0) ? 'won' : 'lost';
    } else if ((me.totalMs ?? 0) !== (them.totalMs ?? 0)) {
      outcome = (me.totalMs ?? 0) < (them.totalMs ?? 0) ? 'won' : 'lost';
    }
  }

  const winnerWallet = me && them
    ? ((me.correctCount ?? 0) !== (them.correctCount ?? 0)
        ? ((me.correctCount ?? 0) > (them.correctCount ?? 0) ? me.walletAddress : them.walletAddress)
        : ((me.totalMs ?? 0) !== (them.totalMs ?? 0)
            ? ((me.totalMs ?? 0) < (them.totalMs ?? 0) ? me.walletAddress : them.walletAddress)
            : null))
    : null;

  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <ArenaBackground>
      <div className="mx-auto w-full max-w-xl px-4 pb-8 pt-20">
        {phase === 'loading' && (
          <div className="text-[12px]" style={{ color: T.textMuted }}>Loading match…</div>
        )}

        {phase === 'error' && (
          <div data-testid="arena-match-error" style={{ color: T.crimson }}>{message}</div>
        )}

        {phase === 'ready' && (
          <div className="text-center">
            <h1 className="font-pixel text-lg" style={{ color: T.amber }}>Ready?</h1>
            <p className="mx-auto mt-2 max-w-sm text-[12px]" style={{ color: T.textMuted }}>
              {total} questions, {Math.round((question?.timeoutMs ?? 20_000) / 1000)} seconds each.
              Correct answers first, then total time. You only get one attempt.
            </p>
            <button
              type="button"
              onClick={onStart}
              data-testid="arena-start-match"
              className="mt-5 rounded-lg px-6 py-3 font-pixel text-[14px]"
              style={{ background: T.bgCardActive, border: `1px solid ${T.borderAlive}`, color: T.amber }}
            >
              Start
            </button>
          </div>
        )}

        {phase === 'playing' && question && (
          <div>
            {/* Progress sits on its own solid strip: over the ornate frame
                art, plain muted text was effectively unreadable. */}
            <div
              className="mb-4 flex items-center justify-between rounded-md px-3 py-2"
              style={{ background: 'rgba(6,6,12,0.75)', border: `1px solid ${T.borderDormant}` }}
            >
              <span
                className="font-pixel-mono text-[12px]"
                style={{ color: T.textPrimary }}
                data-testid="arena-progress"
              >
                Question {answered + 1} of {total}
              </span>
              <span
                className="font-pixel text-xl"
                style={{ color: seconds <= 5 ? T.crimson : T.teal }}
                data-testid="arena-countdown"
              >
                {seconds}s
              </span>
            </div>

            {/* The prompt has to read as a QUESTION, not as a fourth option —
                same-styled cards made it ambiguous at a glance. */}
            <div
              className="rounded-lg p-5"
              style={{
                background: 'rgba(10,8,18,0.92)',
                border: `1px solid ${T.borderAlive}`,
                borderLeft: `3px solid ${T.amber}`,
              }}
            >
              <p
                className="text-[17px] font-semibold leading-relaxed"
                style={{ color: T.textPrimary }}
                data-testid="arena-question-prompt"
              >
                {question.prompt}
              </p>
            </div>

            <div
              className="mt-2 mb-2 font-pixel-mono text-[10px] uppercase tracking-[1px]"
              style={{ color: T.textMuted }}
            >
              Choose one
            </div>

            <div className="grid gap-2">
              {question.options.map((option, i) => {
                const isMine = selected === option.id;
                const answering = verdict !== null;
                // Colour only the option you actually picked. The key never
                // reaches the client, so we cannot reveal the right answer —
                // only whether yours was right.
                const tone = isMine
                  ? (verdict === 'correct' ? T.green : verdict === 'wrong' ? T.crimson : T.amber)
                  : null;

                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={answering}
                    aria-busy={isMine && verdict === 'pending'}
                    onClick={() => submit(question.id, option.id)}
                    data-testid={`arena-option-${i}`}
                    className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-[14px] transition-all duration-150 active:scale-[0.99] disabled:cursor-default"
                    style={{
                      background: isMine ? `${tone}1A` : T.bgCardActive,
                      border: `1px solid ${tone ?? T.borderDormant}`,
                      color: T.textPrimary,
                      // Everything you didn't pick recedes, so the choice reads
                      // instantly even before the server answers.
                      opacity: answering && !isMine ? 0.35 : 1,
                    }}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded font-pixel-mono text-[11px]"
                      style={{
                        background: isMine ? tone as string : 'rgba(255,255,255,0.06)',
                        color: isMine ? '#06060C' : T.textMuted,
                      }}
                    >
                      {verdict === 'correct' && isMine ? '✓'
                        : verdict === 'wrong' && isMine ? '✕'
                        : String.fromCharCode(65 + i)}
                    </span>
                    <span className="flex-1">{option.text}</span>
                    {isMine && verdict === 'pending' && (
                      <span className="font-pixel-mono text-[10px]" style={{ color: T.amber }}>
                        sending…
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* The 20s expiring used to submit silently. */}
            {verdict !== null && selected === null && (
              <div
                className="mt-3 rounded-md px-3 py-2 font-pixel-mono text-[11px]"
                style={{ background: 'rgba(255,68,102,0.10)', color: T.crimson }}
                data-testid="arena-timeout"
              >
                Time&apos;s up — scored as incorrect.
              </div>
            )}

            <div className="mt-3 font-pixel-mono text-[10px]" style={{ color: T.textMuted }}>
              Tip: press A, B or C to answer.
            </div>
          </div>
        )}

        {phase === 'waiting' && (
          <div className="text-center" data-testid="arena-waiting">
            <h1 className="font-pixel text-lg" style={{ color: T.teal }}>Your round is in</h1>
            <p className="mx-auto mt-2 max-w-sm text-[12px]" style={{ color: T.textMuted }}>
              Scores stay hidden until your opponent finishes — neither of you can see
              the other&apos;s result first. Come back when they have played, or wait for
              the window to close.
            </p>
            <button
              type="button"
              onClick={() => router.push('/arena')}
              className="mt-5 rounded px-4 py-2 font-pixel-mono text-[11px]"
              style={{ background: T.bgCardActive, border: `1px solid ${T.borderDormant}`, color: T.textPrimary }}
            >
              Back to the Arena
            </button>
          </div>
        )}

        {phase === 'resolved' && match && (
          <div data-testid="arena-match-result">
            {/* A list of two rows made the reader do the comparison themselves.
                State the outcome first, then the evidence. */}
            <h1
              className="font-pixel text-2xl"
              style={{
                color: outcome === 'won' ? T.green : outcome === 'lost' ? T.crimson : T.amber,
              }}
              data-testid="arena-outcome"
            >
              {outcome === 'won' ? 'You won' : outcome === 'lost' ? 'You lost' : 'Draw'}
            </h1>
            {ratingDelta !== null && (
              <div
                className="mt-1 font-pixel-mono text-[13px]"
                style={{ color: ratingDelta > 0 ? T.green : ratingDelta < 0 ? T.crimson : T.textMuted }}
                data-testid="arena-rating-delta"
              >
                {ratingDelta > 0 ? '+' : ''}{ratingDelta} rating
                {ratingDelta === 0 ? ' (evenly matched)' : ''}
              </div>
            )}
            <div
              className="mt-3 overflow-hidden rounded-lg"
              style={{ background: T.bgCard, border: `1px solid ${T.borderAlive}` }}
            >
              {match.players.map((p) => (
                <div
                  key={p.walletAddress}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderTop: `1px solid ${T.borderDormant}` }}
                  data-testid="arena-result-row"
                >
                  <span className="font-pixel-mono text-[11px]" style={{ color: T.textPrimary }}>
                    {p.walletAddress === myWallet
                      ? 'You'
                      : `${p.walletAddress.slice(0, 4)}…${p.walletAddress.slice(-4)}`}
                    {p.forfeited ? ' (did not play)' : ''}
                    {winnerWallet === p.walletAddress && (
                      <span className="ml-2" style={{ color: T.green }}>winner</span>
                    )}
                  </span>
                  <span className="font-pixel text-[14px]" style={{ color: T.teal }}>
                    {p.correctCount ?? 0}/{total}
                    <span className="ml-2 font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>
                      {p.totalMs != null ? `${(p.totalMs / 1000).toFixed(2)}s` : '—'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => router.push('/arena')}
              className="mt-5 rounded px-4 py-2 font-pixel-mono text-[11px]"
              style={{ background: T.bgCardActive, border: `1px solid ${T.borderDormant}`, color: T.textPrimary }}
            >
              Back to the Arena
            </button>
          </div>
        )}

        {message && phase !== 'error' && (
          <div className="mt-4 text-[12px]" style={{ color: T.crimson }}>{message}</div>
        )}
      </div>
    </ArenaBackground>
  );
}
