'use client';

import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from 'react';

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

// Accent colors a CozyButton can take (same hues as the theme tokens).
const COZY_TONES = {
  amber: COZY_TEXT,
  crimson: '#FF4466',
  green: '#3EE68A',
  teal: '#2AE8D4',
  violet: '#9945FF',
} as const;
export type CozyTone = keyof typeof COZY_TONES;

/**
 * The one button for cozy pages, so every page shares one gold, one font,
 * one radius and the same hover, focus and disabled states.
 *
 * - `solid`: filled call to action (dark text on the tone color).
 * - `tint`:  readable glass button, safe straight on the painted art:
 *            HubButton's solid base (0.82 alpha + blur) mixed with the tone.
 *
 * Silkscreen (font-pixel-mono) on purpose: Pixelify Sans bold at 13-17px draws
 * "C" like "O" at 1x DPR. Focus uses the global :focus-visible ring (globals.css).
 * Hover only changes colors (never opacity or filters, which flash on glass).
 */
export function CozyButton({
  tone = 'amber',
  variant = 'tint',
  size = 'md',
  className = '',
  style,
  children,
  type = 'button',
  ...rest
}: {
  tone?: CozyTone;
  variant?: 'solid' | 'tint';
  size?: 'sm' | 'md';
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const color = COZY_TONES[tone];
  const solid = variant === 'solid';
  const sizing =
    size === 'sm' ? 'min-h-[36px] px-3 py-1.5 text-[11px]' : 'min-h-[44px] px-5 py-2.5 text-xs';
  return (
    <button
      type={type}
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-pixel-mono uppercase tracking-[1.5px] cursor-pointer transition-[background-color,border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
        solid
          ? 'font-bold [--mix:100%] hover:[--mix:86%] disabled:hover:[--mix:100%]'
          : '[--mix:12%] hover:[--mix:22%] disabled:hover:[--mix:12%]'
      } ${sizing} ${className}`}
      style={{
        // Solid: the tone, lightened toward white on hover. Tint: the tone mixed
        // into the dark glass base (stronger on hover).
        backgroundColor: solid
          ? `color-mix(in srgb, ${color} var(--mix), #FFFFFF)`
          : `color-mix(in srgb, ${color} var(--mix), rgba(14, 14, 28, 0.82))`,
        borderColor: solid ? color : `${color}73`,
        color: solid ? '#1A1000' : color,
        textShadow: solid ? undefined : COZY_TEXT_SHADOW,
        boxShadow: solid
          ? `0 0 12px ${color}55, inset 0 1px 0 rgba(255,255,255,0.35)`
          : COZY_SHADOW,
        backdropFilter: solid ? undefined : 'blur(10px)',
        WebkitBackdropFilter: solid ? undefined : 'blur(10px)',
        ...style,
      }}
    >
      {children}
    </button>
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
