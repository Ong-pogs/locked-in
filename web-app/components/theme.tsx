'use client';

import { type ReactNode, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

// ── Color palette (Dead Cells inspired — matches RN theme.tsx exactly) ──
export const T = {
  bg: '#06060C',
  bgCard: 'rgba(14,14,28,0.88)',
  bgCardActive: 'rgba(18,16,32,0.94)',
  amber: '#D4A04A',
  amberDim: '#8B6914',
  green: '#3EE68A',
  crimson: '#FF4466',
  teal: '#2AE8D4',
  violet: '#9945FF',
  rust: '#E8845A',
  textPrimary: '#E8DED0',
  textSecondary: 'rgba(255,255,255,0.42)',
  textMuted: 'rgba(255,255,255,0.45)',
  // Contrast-audit variant: small (10-13px) money copy on CozyCard glass needs
  // more than 0.45 alpha to clear WCAG on the painted backdrops. Use this (plus
  // a text shadow) there; do NOT change textMuted — legacy pages depend on it.
  textMutedStrong: 'rgba(255,255,255,0.66)',
  borderAlive: 'rgba(212,160,74,0.18)',
  borderDormant: 'rgba(255,255,255,0.06)',
};

// ── Reusable components (web equivalents of RN theme components) ──

/** Full-screen wood-textured background wrapper (matches RN ScreenBackground) */
export function ScreenBackground({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen relative"
      style={{
        backgroundColor: T.bg,
        backgroundImage: "url('/images/wood.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Semi-transparent overlay — fixed so it doesn't scroll with content */}
      <div className="fixed inset-0 z-[-1]" style={{ backgroundColor: 'rgba(6,6,12,0.4)' }} />
      <div className="relative max-w-[1100px] mx-auto px-[18px] pb-10">
        {children}
      </div>
    </div>
  );
}

/** Parchment-textured card (matches RN ParchmentCard with ImageBackground) */
export function ParchmentCard({
  children,
  className = '',
  style,
  opacity = 0.35,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  opacity?: number;
}) {
  return (
    <div
      className={`relative p-4 rounded-[10px] border overflow-hidden transition-all duration-150 hover:border-[rgba(212,160,74,0.18)] ${className}`}
      style={{
        backgroundColor: T.bgCard,
        borderColor: T.borderDormant,
        ...style,
      }}
    >
      {/* Parchment texture overlay — matches RN imageStyle={{ borderRadius: 9, opacity }} */}
      <div
        className="absolute inset-0 rounded-[9px]"
        style={{
          backgroundImage: "url('/images/parchment.png')",
          backgroundSize: 'cover',
          opacity,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

/** Back button */
export function BackButton({ onClick }: { onClick?: () => void }) {
  const router = useRouter();

  const handleBack = () => {
    if (onClick) {
      onClick();
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/courses');
    }
  };

  return (
    <button
      onClick={handleBack}
      className="py-3 font-mono text-xs md:hidden"
      style={{ color: T.textSecondary }}
    >
      ← Back
    </button>
  );
}

/** Decorative header with diamond line */
export function PageHeader({
  title,
  subtitle,
  accentWord,
}: {
  title: string;
  subtitle?: string;
  accentWord?: string;
}) {
  const renderTitle = () => {
    if (!accentWord) return title;
    const parts = title.split(accentWord);
    return (
      <>
        {parts[0]}
        <span style={{ color: T.amber }}>{accentWord}</span>
        {parts[1] ?? ''}
      </>
    );
  };

  return (
    <div className="flex flex-col items-center pt-2 pb-5">
      {/* Diamond line decoration */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-[30px] h-px" style={{ backgroundColor: `${T.amber}30` }} />
        <span className="text-[7px]" style={{ color: `${T.amber}50` }}>◆</span>
        <div className="w-[30px] h-px" style={{ backgroundColor: `${T.amber}30` }} />
      </div>
      <h1
        className="text-2xl font-bold tracking-wide mb-1"
        style={{ fontFamily: 'Georgia, serif', color: T.textPrimary }}
      >
        {renderTitle()}
      </h1>
      {subtitle && (
        <p className="text-xs leading-[18px] text-center" style={{ color: T.textSecondary }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

/** Section label (uppercase monospace) */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="font-mono text-[13px] font-bold uppercase tracking-[2px] mb-2.5 mt-1"
      style={{ color: T.textMuted }}
    >
      {children}
    </p>
  );
}

/** Stat box used in grids */
export function StatBox({
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
    <ParchmentCard className={`flex-1 flex flex-col items-center p-3 ${className}`} opacity={0.25}>
      <span
        className="font-mono text-[10px] uppercase tracking-[1px] whitespace-nowrap"
        style={{ color: T.textSecondary }}
      >
        {label}
      </span>
      <span
        className="text-lg font-bold mt-0.5"
        style={{ color: color ?? T.textPrimary }}
      >
        {value}
        {suffix && (
          <span className="text-[10px] font-normal ml-1" style={{ color: T.textMuted }}>
            {suffix}
          </span>
        )}
      </span>
    </ParchmentCard>
  );
}

/** Menu row with icon */
export function MenuRow({
  icon,
  label,
  onClick,
  color,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3.5 py-3.5 px-3.5 mb-2 rounded-[10px] border w-full text-left transition-colors hover:border-[rgba(212,160,74,0.18)] hover:bg-[rgba(255,255,255,0.06)]"
      style={{
        backgroundColor: 'rgba(255,255,255,0.025)',
        borderColor: T.borderDormant,
      }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: `${color ?? T.textMuted}12` }}
      >
        <span className="text-base" style={{ color: color ?? T.textMuted }}>
          {icon}
        </span>
      </div>
      <span className="flex-1 text-sm font-semibold" style={{ color: T.textPrimary }}>
        {label}
      </span>
      <span className="text-lg" style={{ color: T.textMuted }}>›</span>
    </button>
  );
}

/** Corner marks decoration on cards */
export function CornerMarks() {
  return (
    <>
      <CornerMark position="tl" />
      <CornerMark position="tr" />
      <CornerMark position="br" />
      <CornerMark position="bl" />
    </>
  );
}

function CornerMark({ position }: { position: 'tl' | 'tr' | 'br' | 'bl' }) {
  const isTop = position === 'tl' || position === 'tr';
  const isLeft = position === 'tl' || position === 'bl';

  const hBarStyle: CSSProperties = {
    position: 'absolute',
    height: 2,
    width: 10,
    backgroundColor: T.amber,
    opacity: 0.35,
    ...(isTop ? { top: 0 } : { bottom: 0 }),
    ...(isLeft ? { left: 0 } : { right: 0 }),
  };

  const vBarStyle: CSSProperties = {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: T.amber,
    opacity: 0.35,
    ...(isLeft ? { left: 0 } : { right: 0 }),
    ...(isTop ? { top: 0 } : { bottom: 0 }),
  };

  const dotStyle: CSSProperties = {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: T.amber,
    opacity: 0.5,
    ...(isTop ? { top: 0 } : { bottom: 0 }),
    ...(isLeft ? { left: 0 } : { right: 0 }),
  };

  return (
    <div
      className="absolute w-3.5 h-3.5 pointer-events-none"
      style={{
        ...(isTop ? { top: -1 } : { bottom: -1 }),
        ...(isLeft ? { left: -1 } : { right: -1 }),
      }}
    >
      <div style={hBarStyle} />
      <div style={vBarStyle} />
      <div style={dotStyle} />
    </div>
  );
}

/** Primary amber button */
export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-3.5 rounded-lg border text-center transition-opacity focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${disabled ? 'opacity-40' : ''} ${className}`}
      style={{
        backgroundColor: T.amber,
        borderColor: '#E8B860',
        fontFamily: 'Georgia, serif',
        fontSize: 14,
        fontWeight: 800,
        color: '#1A1000',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        outline: 'none',
      }}
    >
      {children}
    </button>
  );
}

/** Secondary muted button */
export function SecondaryButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full py-3 rounded-lg border text-center font-mono text-xs font-semibold tracking-[1px] ${className}`}
      style={{
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderColor: T.borderDormant,
        color: T.textSecondary,
      }}
    >
      {children}
    </button>
  );
}

/** Danger button */
export function DangerButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full py-3 rounded-lg border text-center font-mono text-xs font-semibold tracking-[1px] ${className}`}
      style={{
        backgroundColor: 'rgba(255,68,102,0.08)',
        borderColor: 'rgba(255,68,102,0.2)',
        color: T.crimson,
      }}
    >
      {children}
    </button>
  );
}

/** Horizontal divider */
export function Divider() {
  return <div className="h-px my-3" style={{ backgroundColor: T.borderDormant }} />;
}

/** Progress bar */
export function ProgressBar({
  progress,
  color,
}: {
  progress: number;
  color?: string;
}) {
  return (
    <div
      className="h-1.5 rounded-[3px] overflow-hidden"
      style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
    >
      <div
        className="h-full rounded-[3px] transition-all duration-300"
        style={{
          width: `${Math.min(100, Math.max(0, progress * 100))}%`,
          backgroundColor: color ?? T.amber,
        }}
      />
    </div>
  );
}
