'use client';

// The invite landing, and the growth loop: this page is often the first thing
// a non-user ever sees. It must render something meaningful BEFORE asking
// anyone to sign in.
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { T } from '../../../../components/theme';
import { SpireBackground } from '../../SpireBackground';
import { fetchWithAuth } from '../../../../services/api/httpClient';
import { joinByCode } from '../../../../services/api/arena/arenaApi';
import { useUserStore } from '../../../../stores/userStore';

export default function ArenaJoinPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = String(params?.code ?? '').toUpperCase();

  const walletAddress = useUserStore((s) => s.walletAddress);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A refusal for want of a stake is the one error with somewhere to go.
  const [needsStake, setNeedsStake] = useState(false);

  async function onAccept() {
    setJoining(true);
    setError(null);
    try {
      const { matchId } = await fetchWithAuth((t) => joinByCode(t, code));
      router.push(`/spire/${matchId}`);
    } catch (err) {
      const message = (err as { code?: string })?.code;
      setNeedsStake(message === 'ARENA_STAKE_REQUIRED');
      setError(
        message === 'ARENA_SELF_JOIN'
          ? 'This is your own challenge — send the link to someone else.'
          : message === 'ARENA_MATCH_FULL'
            ? 'Someone already took this challenge.'
            : message === 'ARENA_MATCH_NOT_FOUND'
              ? 'That challenge code does not exist or has expired.'
              : message === 'ARENA_STAKE_REQUIRED'
                ? 'The Spire only takes challengers with something on the line.'
                : 'Could not join this challenge.',
      );
      setJoining(false);
    }
  }

  // Auto-join a signed-in visitor rather than making them press twice.
  useEffect(() => {
    if (walletAddress && !joining && !error) onAccept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  return (
    <SpireBackground>
      <div className="mx-auto w-full max-w-md px-4 py-12 text-center">
        <div
          className="font-pixel-mono text-[10px] uppercase tracking-[2px]"
          style={{ color: T.textMuted }}
        >
          You have been challenged
        </div>

        <h1
          className="mt-2 font-pixel text-xl"
          style={{ color: T.amber }}
          data-testid="arena-invite-challenger"
        >
          Spire duel
        </h1>

        <div
          className="mx-auto mt-4 inline-block rounded-lg px-5 py-3"
          style={{ background: T.bgCard, border: `1px solid ${T.borderAlive}` }}
        >
          <div className="font-pixel-mono text-[10px] uppercase tracking-[1px]" style={{ color: T.textMuted }}>
            Challenge code
          </div>
          <div className="mt-1 font-pixel text-2xl tracking-[3px]" style={{ color: T.amber }}>
            {code}
          </div>
        </div>

        <p className="mx-auto mt-5 max-w-sm text-[12px] leading-relaxed" style={{ color: T.textMuted }}>
          Seven questions on Solana, wallets and DeFi. Twenty seconds each.
          Most correct wins; fastest breaks the tie. Both duellists stake a course:
          a losing season costs it one yield tier — never your deposit.
        </p>

        {error && (
          <div className="mt-5 text-[12px]" style={{ color: T.crimson }} data-testid="arena-invite-error">
            {error}
          </div>
        )}

        {needsStake && (
          <button
            type="button"
            onClick={() => router.push('/spire')}
            data-testid="arena-invite-stake"
            className="mt-4 rounded-lg px-5 py-2.5 font-pixel text-[13px]"
            style={{ background: T.bgCardActive, border: `1px solid ${T.borderAlive}`, color: T.amber }}
          >
            Stake a course
          </button>
        )}

        {walletAddress ? (
          <button
            type="button"
            onClick={onAccept}
            disabled={joining}
            data-testid="arena-accept-challenge"
            className="mt-6 rounded-lg px-6 py-3 font-pixel text-[14px]"
            style={{ background: T.bgCardActive, border: `1px solid ${T.borderAlive}`, color: T.amber }}
          >
            {joining ? 'Joining…' : 'Accept the duel'}
          </button>
        ) : (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => router.push('/')}
              data-testid="arena-accept-challenge"
              className="rounded-lg px-6 py-3 font-pixel text-[14px]"
              style={{ background: T.bgCardActive, border: `1px solid ${T.borderAlive}`, color: T.amber }}
            >
              Sign in to accept
            </button>
            <div className="mt-3 text-[11px]" style={{ color: T.textMuted }}>
              New here? Creating an account takes a moment and the challenge waits 24 hours.
            </div>
          </div>
        )}
      </div>
    </SpireBackground>
  );
}
