'use client';

import { useEffect, useRef, useState } from 'react';
import { T } from '../../components/theme';

/**
 * The accept/decline offer shown when the queue pairs you.
 *
 * A pairing used to drop both players straight into a live match, so a queue
 * match against someone who had wandered off looked exactly like a real one
 * until its 24h window expired. The countdown is the honest version: take it
 * or it goes away, and whoever did answer keeps their place in the queue.
 */
export function MatchProposal({
  msLeft,
  totalMs,
  accepted,
  onAccept,
  onDecline,
  busy = false,
}: {
  msLeft: number;
  totalMs: number;
  accepted: boolean;
  onAccept: () => void;
  onDecline: () => void;
  busy?: boolean;
}) {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  const pct = Math.max(0, Math.min(1, msLeft / totalMs));
  const urgent = seconds <= 3;

  return (
    <section
      data-testid="spire-proposal"
      role="alertdialog"
      aria-live="assertive"
      aria-label="Opponent found"
      className="mb-5 rounded-lg p-4"
      style={{
        background: T.bgCardActive,
        border: `1px solid ${urgent ? 'rgba(255,68,102,0.5)' : T.borderAlive}`,
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
          style={{ color: T.textMuted }}
        >
          Opponent found
        </span>
        <span
          data-testid="spire-proposal-seconds"
          className="text-[20px] font-bold leading-none"
          style={{ color: urgent ? T.crimson : T.teal, fontVariantNumeric: 'tabular-nums' }}
        >
          {seconds}s
        </span>
      </div>

      {/* Drains left-to-right. A number alone reads as decoration; a bar that
          is visibly emptying is what makes the deadline feel real. */}
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: 'rgba(255,255,255,0.08)' }}
        aria-hidden
      >
        <div
          className="h-full rounded-full transition-[width] duration-100 ease-linear"
          style={{ width: `${pct * 100}%`, background: urgent ? T.crimson : T.teal }}
        />
      </div>

      {accepted ? (
        <p className="mt-3 text-[12px]" style={{ color: T.textMutedStrong }}>
          You&apos;re in — waiting for them to accept. If they don&apos;t, you keep your place
          in the queue.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="spire-proposal-accept"
            onClick={onAccept}
            disabled={busy}
            className="flex-1 rounded-lg px-4 py-2.5 font-pixel text-[13px] transition-colors disabled:opacity-40"
            style={{
              background: 'rgba(42,232,212,0.10)',
              border: `1px solid rgba(42,232,212,0.45)`,
              color: T.teal,
            }}
          >
            Accept
          </button>
          <button
            type="button"
            data-testid="spire-proposal-decline"
            onClick={onDecline}
            disabled={busy}
            className="flex-1 rounded-lg px-4 py-2.5 font-pixel text-[13px] transition-colors disabled:opacity-40"
            style={{
              background: T.bgCard,
              border: `1px solid ${T.borderDormant}`,
              color: T.textMutedStrong,
            }}
          >
            Decline
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Counts down from a server-supplied deadline.
 *
 * Anchored to a timestamp rather than decremented on a tick, so a backgrounded
 * tab that stops firing timers still shows the right number when it wakes —
 * and never a stale one that claims there is time left after the offer died.
 */
export function useCountdown(deadlineAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  const raf = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (deadlineAt == null) return undefined;
    setNow(Date.now());
    raf.current = setInterval(() => setNow(Date.now()), 100);
    return () => { if (raf.current) clearInterval(raf.current); };
  }, [deadlineAt]);

  if (deadlineAt == null) return 0;
  return Math.max(0, deadlineAt - now);
}
