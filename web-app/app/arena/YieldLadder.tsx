'use client';

import { ArrowRight, Lock } from 'lucide-react';
import { T } from '../../components/theme';
import { COZY_TEXT_SHADOW } from '../../components/cozy';
import { combinedKeptBps } from '../../components/v2/PenaltyBanner';

// Secondary copy on the glass card: stronger muted white plus the cozy shadow.
const MUTED_TEXT = { color: T.textMutedStrong, textShadow: COZY_TEXT_SHADOW };

/**
 * The whole bet, as two numbers.
 *
 * Prose could not carry this honestly: "keeps half its yield" is simply false
 * for a course already carrying a lapse, where a loss takes it from 50% to
 * nothing. Reading the ladder off the selected course and drawing both
 * outcomes side by side says the true thing for whoever is actually looking.
 */
export function YieldLadder({ lapseCount }: { lapseCount: number }) {
  const win = combinedKeptBps(lapseCount, 0) / 100;
  const lose = combinedKeptBps(lapseCount, 1) / 100;

  return (
    <div data-testid="arena-stake-ladder">
      <div className="flex items-stretch gap-2">
        <Outcome label="Win or draw" pct={win} tone="good" note="nothing changes" />
        <div className="flex shrink-0 items-center" aria-hidden>
          <ArrowRight size={16} style={{ color: T.textMutedStrong }} />
        </div>
        <Outcome label="Lose" pct={lose} tone="bad" note={lose === 0 ? 'all of it goes' : 'half of it goes'} />
      </div>

      <div
        className="mt-2 flex items-center gap-2 rounded-md px-2.5 py-1.5"
        style={{ background: 'rgba(62,230,138,0.07)', border: `1px solid rgba(62,230,138,0.22)` }}
      >
        <Lock size={12} style={{ color: T.green }} aria-hidden className="shrink-0" />
        <span className="font-pixel-mono text-[10px] leading-relaxed" style={MUTED_TEXT}>
          Your deposit is never at risk — only yield moves.
        </span>
      </div>
    </div>
  );
}

function Outcome({
  label, pct, tone, note,
}: { label: string; pct: number; tone: 'good' | 'bad'; note: string }) {
  const color = tone === 'good' ? T.green : T.crimson;
  const border = tone === 'good' ? 'rgba(62,230,138,0.35)' : 'rgba(255,68,102,0.35)';
  const bg = tone === 'good' ? 'rgba(62,230,138,0.06)' : 'rgba(255,68,102,0.06)';
  return (
    <div
      className="flex-1 rounded-lg px-3 py-2.5 text-center"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <div className="font-pixel-mono text-[9px] uppercase tracking-[1px]" style={MUTED_TEXT}>
        {label}
      </div>
      {/* Body face, deliberately not font-pixel: Pixelify Sans renders 5 as
          something very close to S, so "50%" read as "S0%" on the one number
          that tells a user what their money does.
          Not font-pixel-mono either: Silkscreen's 5 and S are the same glyph. */}
      <div
        className="mt-0.5 text-[24px] font-bold leading-none"
        style={{ color, textShadow: COZY_TEXT_SHADOW, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}
      >
        {pct}%
      </div>
      <div className="mt-1.5 font-pixel-mono text-[10px] leading-relaxed" style={MUTED_TEXT}>
        yield kept · {note}
      </div>
    </div>
  );
}
