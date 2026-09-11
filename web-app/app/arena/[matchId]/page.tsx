'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { T, ScreenBackground } from '../../../components/theme';
import { fetchWithAuth } from '../../../services/api/httpClient';
import { answerQuestion, getMatch, startMatch } from '../../../services/api/arena/arenaApi';
import type { ArenaMatchState, ArenaQuestion } from '../../../types/arena';

type Phase = 'loading' | 'ready' | 'playing' | 'waiting' | 'resolved' | 'error';

export default function ArenaMatchPage() {
  const params = useParams<{ matchId: string }>();
  const router = useRouter();
  const matchId = params?.matchId as string;

  const [phase, setPhase] = useState<Phase>('loading');
  const [match, setMatch] = useState<ArenaMatchState | null>(null);
  const [question, setQuestion] = useState<ArenaQuestion | null>(null);
  const [answered, setAnswered] = useState(0);
  const [total, setTotal] = useState(7);
  const [remainingMs, setRemainingMs] = useState(20_000);
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);

  const loadMatch = useCallback(async () => {
    try {
      const state = await fetchWithAuth((t) => getMatch(t, matchId));
      setMatch(state);
      setTotal(state.questionCount || 7);
      if (state.resolved) setPhase('resolved');
      else {
        const me = state.players.find((p) => p.submittedAt);
        setPhase(me && state.players.every((p) => p.submittedAt) ? 'resolved' : 'ready');
      }
    } catch {
      setPhase('error');
      setMessage('This match could not be loaded.');
    }
  }, [matchId]);

  useEffect(() => { loadMatch(); }, [loadMatch]);

  const submit = useCallback(async (questionId: string, optionId: string | null) => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const res = await fetchWithAuth((t) => answerQuestion(t, matchId, questionId, optionId));
      setAnswered(res.answered);
      if (res.done) {
        setQuestion(null);
        setPhase('waiting');
        await loadMatch();
      } else {
        setQuestion(res.question);
        setRemainingMs(res.question?.timeoutMs ?? 20_000);
      }
    } catch {
      setMessage('That answer did not register. Reload to continue.');
    } finally {
      submitting.current = false;
    }
  }, [matchId, loadMatch]);

  // Display-only countdown. The server stamps served_at and derives the real
  // elapsed time, so a laggy client simply scores a slower answer.
  useEffect(() => {
    if (phase !== 'playing' || !question) return undefined;
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
  }, [phase, question, submit]);

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

  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <ScreenBackground>
      <div className="mx-auto w-full max-w-xl px-4 py-8">
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
            <div className="mb-3 flex items-center justify-between">
              <span className="font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>
                {answered + 1} / {total}
              </span>
              <span
                className="font-pixel text-lg"
                style={{ color: seconds <= 5 ? T.crimson : T.teal }}
                data-testid="arena-countdown"
              >
                {seconds}s
              </span>
            </div>

            <div
              className="rounded-lg p-4"
              style={{ background: T.bgCard, border: `1px solid ${T.borderAlive}` }}
            >
              <p
                className="text-[15px] leading-relaxed"
                style={{ color: T.textPrimary }}
                data-testid="arena-question-prompt"
              >
                {question.prompt}
              </p>
            </div>

            <div className="mt-3 grid gap-2">
              {question.options.map((option, i) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => submit(question.id, option.id)}
                  data-testid={`arena-option-${i}`}
                  className="rounded-lg px-4 py-3 text-left text-[13px]"
                  style={{
                    background: T.bgCardActive,
                    border: `1px solid ${T.borderDormant}`,
                    color: T.textPrimary,
                  }}
                >
                  {option.text}
                </button>
              ))}
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
            <h1 className="font-pixel text-lg" style={{ color: T.amber }}>Result</h1>
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
                    {p.walletAddress.slice(0, 4)}…{p.walletAddress.slice(-4)}
                    {p.forfeited ? ' (did not play)' : ''}
                  </span>
                  <span className="font-pixel text-[14px]" style={{ color: T.teal }}>
                    {p.correctCount ?? 0}/{total}
                    <span className="ml-2 font-pixel-mono text-[11px]" style={{ color: T.textMuted }}>
                      {p.totalMs != null ? `${(p.totalMs / 1000).toFixed(1)}s` : '—'}
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
    </ScreenBackground>
  );
}
