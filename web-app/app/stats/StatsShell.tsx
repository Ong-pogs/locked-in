'use client';

import type { CSSProperties, ReactNode } from 'react';
import { COZY_TEXT, COZY_TEXT_SHADOW } from '@/components/cozy';
import { HubButton } from '@/components/HubButton';
import { T } from '@/components/theme';

// Theme tokens live in client modules. Expose them to the server-rendered
// children through CSS variables without moving stats loading to the client.
export function StatsShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen relative"
      style={{
        backgroundColor: T.bg,
        '--stats-accent': COZY_TEXT,
        '--stats-muted': T.textMutedStrong,
        '--stats-text-shadow': COZY_TEXT_SHADOW,
      } as CSSProperties}
    >
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/tavern/tavernbackground.png"
          alt=""
          draggable={false}
          className="w-full h-full object-cover select-none"
          style={{ imageRendering: 'pixelated' }}
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(14,14,28,0.30) 0%, rgba(14,14,28,0.55) 60%, rgba(14,14,28,0.78) 100%)',
          }}
        />
      </div>

      <HubButton />

      <div className="relative z-10 max-w-[1100px] mx-auto px-[18px] pb-20">
        <div className="pt-20" />
        {children}
      </div>
    </div>
  );
}
