'use client';

import { useEffect, useState } from 'react';
import { T } from '../../components/theme';
import { CozyButton, CozyCard, COZY_BORDER, COZY_TEXT, COZY_TEXT_SHADOW } from '../../components/cozy';

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
    // The dialog and live-region attributes stay on the outer <section>; the
    // frosted glass is the shared CozyCard inside it.
    <section
      data-testid="arena-proposal"
      role="alertdialog"
      aria-live="assertive"
      aria-label="Opponent found"
      className="mb-5"
    >
      <CozyCard
        style={{
          borderColor: urgent ? 'rgba(255,68,102,0.6)' : COZY_BORDER,
          // A deeper drop than a normal card: this is the one panel on the page
          // waiting for an answer.
          boxShadow: '0 10px 30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,213,128,0.12)',
        }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span
            className="font-pixel-mono text-[10px] uppercase tracking-[1px]"
            style={{ color: COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
          >
            Opponent found
          </span>
          {/* Body face, not Silkscreen: Silkscreen draws 5 and S alike, so
              "5s" would read as "SS" at the moment it matters most. */}
          <span
            data-testid="arena-proposal-seconds"
            className="text-[20px] font-bold leading-none"
            style={{
              color: urgent ? T.crimson : T.teal,
              textShadow: COZY_TEXT_SHADOW,
              fontVariantNumeric: 'tabular-nums',
            }}
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
          <p
            className="mt-3 font-pixel-mono text-[12px] leading-relaxed"
            style={{ color: T.textMutedStrong, textShadow: COZY_TEXT_SHADOW }}
          >
            You&apos;re in — waiting for them to accept. If they don&apos;t, you keep your place
            in the queue.
          </p>
        ) : (
          // Accept is the call to action (solid); Decline stays a tint.
          <div className="mt-3 flex flex-wrap gap-2">
            <CozyButton
              tone="teal"
              variant="solid"
              data-testid="arena-proposal-accept"
              onClick={onAccept}
              disabled={busy}
              className="flex-1"
            >
              Accept
            </CozyButton>
            <CozyButton
              tone="crimson"
              data-testid="arena-proposal-decline"
              onClick={onDecline}
              disabled={busy}
              className="flex-1"
            >
              Decline
            </CozyButton>
          </div>
        )}
      </CozyCard>
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

  useEffect(() => {
    if (deadlineAt == null) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [deadlineAt]);

  if (deadlineAt == null) return 0;
  return Math.max(0, deadlineAt - now);
}
