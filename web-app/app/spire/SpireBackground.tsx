'use client';

import type { ReactNode } from 'react';
import { T } from '../../components/theme';
import { HubButton } from '../../components/HubButton';

/**
 * Tavern backdrop for every Clockwork Spire screen.
 *
 * The Spire was on the generic wood texture (ScreenBackground), which is the
 * pre-village look and reads as unfinished next to the rest of the app. The
 * tavern is already the backdrop for /leaderboard and /community-pot — the two
 * other social, competitive surfaces — and leaderboard's own comment calls it
 * "the most social location". A duel is issued in a tavern, so the Spire
 * belongs to that family rather than getting a seventh look.
 *
 * The markup mirrors app/leaderboard/page.tsx exactly (fixed layer, pixelated,
 * graceful onError) but lives here once instead of being pasted into all three
 * Spire routes.
 */
export function SpireBackground({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bg }}>
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/tavern/tavernbackground.png"
          alt=""
          draggable={false}
          className="w-full h-full object-cover select-none"
          style={{ imageRendering: 'pixelated' }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        {/* The scrim is heavier at the foot than leaderboard's: Spire screens
            put small mono text and quiz options low on the page, where the
            painted tables and patrons are busiest. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(14,14,28,0.42) 0%, rgba(14,14,28,0.68) 55%, rgba(14,14,28,0.88) 100%)',
          }}
        />
      </div>

      <HubButton />

      <div className="relative z-10">{children}</div>
    </div>
  );
}
