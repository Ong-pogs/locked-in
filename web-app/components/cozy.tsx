'use client';

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

// Cozy palette — same constants used in village hub + HubButton.
// Indigo glass + teal-aurora border + amber window-glow accent.
// Card variant uses lower bg opacity + stronger blur+saturate so the painted
// backdrop shows through clearly (true frosted glass, Apple/iOS style).
export const COZY_BG = 'rgba(14, 14, 28, 0.28)';
export const COZY_BORDER = 'rgba(58, 143, 168, 0.55)';
export const COZY_TEXT = '#FFD580';
export const COZY_TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.85)';
export const COZY_SHADOW =
  '0 6px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,213,128,0.12)';
export const COZY_GLASS_BLUR = 'blur(20px) saturate(1.4)';

/**
 * Glass-morphic card matching the village's cozy palette. Replaces
 * parchment cards on cozified inner pages so UI floats cleanly over the
 * painted backdrops without fighting the art.
 */
export function CozyCard({
  children,
  className = '',
  style,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'style'>) {
  return (
    <div
      {...rest}
      className={`relative rounded-[10px] border ${className}`}
      style={{
        padding: 18,
        // CSS-var driven so GlassTuner can hot-swap values live.
        backgroundColor: 'rgba(14, 14, 28, var(--cozy-bg-alpha, 0.28))',
        borderColor: COZY_BORDER,
        boxShadow: COZY_SHADOW,
        backdropFilter:
          'blur(var(--cozy-blur, 20px)) saturate(var(--cozy-saturate, 1.4))',
        WebkitBackdropFilter:
          'blur(var(--cozy-blur, 20px)) saturate(var(--cozy-saturate, 1.4))',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Centered stat tile: pixel-mono label on top, big pixel-mono value below.
 * Replaces theme.tsx StatBox on cozified pages.
 */
export function CozyStatBox({
  label,
  value,
  suffix,
  color,
  className = '',
}: {
  label: string;
  value: string | number;
  suffix?: string;
  color?: string;
  className?: string;
}) {
  return (
    <CozyCard
      className={`flex-1 flex flex-col items-center ${className}`}
      style={{ padding: 14 }}
    >
      <span
        className="font-pixel-mono text-[10px] uppercase tracking-[1px] whitespace-nowrap"
        style={{ color: COZY_TEXT, opacity: 0.75, textShadow: COZY_TEXT_SHADOW }}
      >
        {label}
      </span>
      <span
        className="font-pixel-mono text-xl font-bold mt-1"
        style={{ color: color ?? COZY_TEXT, textShadow: COZY_TEXT_SHADOW }}
      >
        {value}
        {suffix && (
          <span className="text-[10px] font-normal ml-1 opacity-70">
            {suffix}
          </span>
        )}
      </span>
    </CozyCard>
  );
}

/**
 * Pixel-font section label in amber. Replaces the old gray monospace
 * SectionLabel on cozy pages.
 */
export function CozySectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-[13px] font-bold uppercase tracking-[2px] mb-2.5 mt-1"
      style={{
        fontFamily: 'var(--font-pixel-mono), monospace',
        color: COZY_TEXT,
        textShadow: COZY_TEXT_SHADOW,
        opacity: 0.85,
      }}
    >
      {children}
    </p>
  );
}
