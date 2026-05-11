'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

/**
 * Floating "↩ Hub" button — fixed top-left of every inner page.
 *
 * Replaces the sidebar/bottom-nav. Diegetic pattern: village is the hub, so
 * every inner page just needs a way back to it. Cozy palette mirrors the
 * /village logo button (indigo glass + teal aurora + amber window glow).
 */
export function HubButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push('/village')}
      aria-label="Back to village hub"
      className="fixed top-4 left-4 z-40 flex items-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      style={{
        padding: '8px 14px 8px 10px',
        borderRadius: 12,
        backgroundColor: 'rgba(14, 14, 28, 0.82)',
        border: '1px solid rgba(58, 143, 168, 0.55)',
        boxShadow:
          '0 6px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,213,128,0.12)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      <ArrowLeft size={16} color="#FFD580" strokeWidth={2.5} />
      <span
        style={{
          fontFamily: 'var(--font-pixel), Georgia, serif',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.4,
          color: '#FFD580',
          textShadow: '0 1px 2px rgba(0,0,0,0.85)',
        }}
      >
        Hub
      </span>
    </button>
  );
}
