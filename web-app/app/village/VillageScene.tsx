'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { User, Flame, FlaskConical, Droplet, Sparkles } from 'lucide-react';
import { T } from '@/components/theme';
import { useCourseStore } from '@/stores/courseStore';
import boundsData from '@/public/images/village/masks/bounds.json';

// Source asset is 1024x576 — keep ratio for letterboxing.
const ART_WIDTH = 1024;
const ART_HEIGHT = 576;
const ART_RATIO = ART_WIDTH / ART_HEIGHT;

type Bounds = { x: number; y: number; w: number; h: number };
type BoundsMap = Record<string, Bounds>;

const BOUNDS = boundsData as BoundsMap;

type Building = {
  id: keyof typeof BOUNDS;
  outline: string;
  route: string;
  label: string;
};

// Interactable village hotspots. Masks not listed here (clock, storage) are
// decorative — they don't hover-glow or click. The dashboard is reachable
// from any page via the top-bar profile button + Lvl segment.
const BUILDINGS: Building[] = [
  // Far-left tudor (biggest)        → Courses (Academy)
  { id: 'academy', outline: '/images/village/outlines/outline-academy.png', route: '/courses', label: 'Academy' },
  // Left-middle tudor                → Shop (Market)
  { id: 'cottage', outline: '/images/village/outlines/outline-cottage.png', route: '/shop', label: 'Market' },
  // Small painted notice board       → Leaderboard
  { id: 'notice', outline: '/images/village/outlines/outline-notice.png', route: '/leaderboard', label: 'Leaderboard' },
  // Center awning stall              → Inventory
  { id: 'inventory', outline: '/images/village/outlines/outline-inventory.png', route: '/inventory', label: 'Inventory' },
  // Wishing well                     → History
  { id: 'lantern', outline: '/images/village/outlines/outline-lantern.png', route: '/history', label: 'History' },
  // Right-center building            → Tavern (community pot)
  { id: 'tavern', outline: '/images/village/outlines/outline-tavern.png', route: '/community-pot', label: 'Tavern' },
  // Far-right church-like            → Brewery (alchemy route)
  { id: 'forge', outline: '/images/village/outlines/outline-forge.png', route: '/alchemy', label: 'Brewery' },
];

// Cozy palette — pulled from the painted village's own colors so the UI
// integrates instead of competing. Indigo glass + teal aurora border + warm
// amber (window-glow) text/icons. Blur 10px = soft glass-morphic feel.
const COZY_BG = 'rgba(14, 14, 28, 0.82)';
const COZY_BORDER = 'rgba(58, 143, 168, 0.55)';
const COZY_TEXT = '#FFD580';
const COZY_SHADOW =
  '0 6px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,213,128,0.12)';
const COZY_TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.85)';

/**
 * Mask-based painted village hub.
 *
 * Layer stack (bottom -> top):
 *   1. Painted background PNG (pixelated scaling)
 *   2. Per-building glow layers — full-canvas divs with mask-image clipping
 *      to the silhouette, fade in on hover
 *   3. Per-building hotspot buttons — bounding-box rect over the silhouette;
 *      uses the same mask as a clipping shape so only the painted pixels
 *      receive pointer events
 *   4. Floating name plaque positioned above the hovered building's bbox
 */
export default function VillageScene() {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);

  // Top-bar stat values — pulled from the active course state when available.
  // Fallback to 0 when there's no active course (e.g. unauthenticated test view).
  const activeCourseId = useCourseStore((s) => s.activeCourseId);
  const courseStates = useCourseStore((s) => s.courseStates);
  const activeState = activeCourseId ? courseStates[activeCourseId] : null;
  const streak = activeState?.currentStreak ?? 0;
  const fuel = activeState?.fuelCounter ?? 0;
  const ichor = activeState?.ichorBalance ?? 0;
  const level = 1; // TODO: replace with real XP-derived level once API is wired

  return (
    <div
      className="fixed inset-0 z-0 overflow-hidden flex items-center justify-center"
      style={{ backgroundColor: T.bg }}
    >
      {/*
        Aspect-ratio container: width fills viewport up to whatever fits
        height-wise. CSS aspect-ratio + max-w/h = uniform letterbox/pillarbox.
      */}
      <div
        className="relative"
        style={{
          width: '100vw',
          height: '100vh',
          maxWidth: `calc(100vh * ${ART_RATIO})`,
          maxHeight: `calc(100vw / ${ART_RATIO})`,
        }}
      >
        {/* 1. Painted village background */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/village/village-painted.png"
          alt="Painted village"
          draggable={false}
          className="absolute inset-0 w-full h-full select-none pointer-events-none"
          style={{
            imageRendering: 'pixelated',
            objectFit: 'fill',
          }}
        />

        {/* 2. Pre-computed outline PNGs — 9 stacked <img>s, opacity toggled by
               CSS transition. Zero runtime filter work; browsers blit static
               bitmaps efficiently. */}
        {BUILDINGS.map((b) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`outline-${b.id}`}
            src={b.outline}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 w-full h-full pointer-events-none select-none transition-opacity duration-150 ease-out"
            style={{
              imageRendering: 'pixelated',
              opacity: hovered === b.id ? 1 : 0,
              willChange: 'opacity',
            }}
          />
        ))}

        {/* 3. Hotspot buttons — plain bounding-box rects (no mask-image, since
               that costs a per-button mask computation and we're optimizing
               for performance). Click area is rectangular but tightly fitted
               to each building's bbox. */}
        {BUILDINGS.map((b) => {
          const bb = BOUNDS[b.id];
          if (!bb) return null;
          return (
            <button
              key={`hotspot-${b.id}`}
              type="button"
              aria-label={b.label}
              onMouseEnter={() => setHovered(b.id)}
              onMouseLeave={() => setHovered((h) => (h === b.id ? null : h))}
              onFocus={() => setHovered(b.id)}
              onBlur={() => setHovered((h) => (h === b.id ? null : h))}
              onClick={() => router.push(b.route)}
              className="absolute cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              style={{
                left: `${bb.x * 100}%`,
                top: `${bb.y * 100}%`,
                width: `${bb.w * 100}%`,
                height: `${bb.h * 100}%`,
                backgroundColor: 'transparent',
                border: 'none',
                padding: 0,
              }}
            />
          );
        })}

        {/* 4. Always-on bobbing TEXT markers — small amber pills with the
               building name. Smart anchor: float above if there's space,
               otherwise mount at the top of the building silhouette. */}
        {BUILDINGS.map((b, i) => {
          const bb = BOUNDS[b.id];
          if (!bb) return null;
          const isHovered = hovered === b.id;
          // Stagger bob start times so they don't sync mechanically.
          const delay = (i * 0.35) % 2.4;
          // Smart anchor: if there's room above the building, float above.
          // Otherwise (e.g. Academy with bb.y ≈ 0.02), mount the label AT the
          // top edge of the silhouette so it doesn't get clipped by the canvas.
          const hasRoomAbove = bb.y > 0.1;
          // Position anchor + transform so the label is either fully above or
          // sitting just inside the top edge of the bbox.
          const anchorTop = hasRoomAbove ? `${(bb.y - 0.005) * 100}%` : `${bb.y * 100}%`;
          const anchorTransform = hasRoomAbove
            ? 'translate(-50%, -100%)'
            : 'translate(-50%, 6px)';
          return (
            <div
              key={`marker-${b.id}`}
              className="absolute pointer-events-none flex items-center justify-center"
              style={{
                left: `${(bb.x + bb.w / 2) * 100}%`,
                top: anchorTop,
                transform: anchorTransform,
                zIndex: isHovered ? 5 : 4,
              }}
            >
              <div
                className="village-marker-bob"
                style={{
                  animationDelay: `${delay.toFixed(2)}s`,
                  animationPlayState: isHovered ? 'paused' : 'running',
                }}
              >
                <div
                  className="flex items-center justify-center rounded-md transition-all duration-200"
                  style={{
                    padding: '5px 11px',
                    backgroundColor: isHovered
                      ? 'rgba(255,213,128,0.95)'
                      : 'rgba(14, 14, 28, 0.82)',
                    border: `1px solid ${isHovered ? COZY_TEXT : COZY_BORDER}`,
                    boxShadow: isHovered
                      ? `0 0 14px ${COZY_TEXT}, 0 4px 10px rgba(0,0,0,0.55)`
                      : `0 4px 10px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,213,128,0.15)`,
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                  }}
                >
                  <span
                    className="font-pixel font-bold uppercase"
                    style={{
                      fontSize: 11,
                      letterSpacing: 1,
                      color: isHovered ? '#1A1000' : COZY_TEXT,
                      textShadow: isHovered ? 'none' : COZY_TEXT_SHADOW,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {b.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style jsx global>{`
        @keyframes village-marker-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        .village-marker-bob {
          animation: village-marker-bob 2.6s ease-in-out infinite;
          will-change: transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .village-marker-bob {
            animation: none;
          }
        }
      `}</style>

      {/* Top-left: logo + wordmark — clicking goes back */}
      <button
        onClick={() => router.back()}
        aria-label="Home"
        className="fixed top-4 left-4 z-30 flex items-center gap-3 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        style={{
          padding: '6px 14px 6px 6px',
          borderRadius: 12,
          backgroundColor: COZY_BG,
          border: `1px solid ${COZY_BORDER}`,
          boxShadow: COZY_SHADOW,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/logo.png"
          alt="Locked In"
          draggable={false}
          className="select-none"
          style={{
            width: 28,
            height: 28,
            imageRendering: 'pixelated',
          }}
        />
        <span
          className="hidden sm:inline"
          style={{
            fontFamily: 'var(--font-pixel), Georgia, serif',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: 0.6,
            color: COZY_TEXT,
            textShadow: COZY_TEXT_SHADOW,
          }}
        >
          Locked In
        </span>
      </button>

      {/* Top-right: grouped stats cluster + separate profile button.
          One container with internal dividers reads as a single HUD element
          instead of 5 floating pills (Hades / Genshin / Diablo HUD pattern). */}
      <div className="fixed top-4 right-4 z-30 flex items-center gap-2">
        <div
          className="hidden md:flex items-stretch"
          style={{
            height: 36,
            borderRadius: 18,
            backgroundColor: COZY_BG,
            border: `1px solid ${COZY_BORDER}`,
            boxShadow: COZY_SHADOW,
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            overflow: 'hidden',
          }}
        >
          <StatSegment
            icon={<Flame size={14} color={COZY_TEXT} strokeWidth={2.5} />}
            value={`${streak}d`}
            ariaLabel={`Streak ${streak} days`}
            onClick={() => router.push('/dashboard')}
          />
          <SegmentDivider />
          <StatSegment
            icon={<Droplet size={14} color={COZY_TEXT} strokeWidth={2.5} />}
            value={`${fuel}`}
            ariaLabel={`Fuel ${fuel}`}
            onClick={() => router.push('/alchemy')}
          />
          <SegmentDivider />
          <StatSegment
            icon={<FlaskConical size={14} color={COZY_TEXT} strokeWidth={2.5} />}
            value={`${ichor}`}
            ariaLabel={`Ichor ${ichor}`}
            onClick={() => router.push('/shop')}
          />
          <SegmentDivider />
          <StatSegment
            icon={<Sparkles size={14} color={COZY_TEXT} strokeWidth={2.5} />}
            value={`Lvl ${level}`}
            ariaLabel={`Level ${level}`}
            onClick={() => router.push('/dashboard')}
          />
        </div>

        {/* Profile button — separate because it's navigation, not a stat */}
        <button
          onClick={() => router.push('/dashboard')}
          aria-label="Profile"
          className="flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: COZY_BG,
            border: `1px solid ${COZY_BORDER}`,
            boxShadow: COZY_SHADOW,
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
        >
          <User size={16} color={COZY_TEXT} strokeWidth={2.5} />
        </button>
      </div>

    </div>
  );
}

/** One segment of the grouped stats pill — no own border/bg, just padding +
 *  hover affordance. Several share a single container with dividers between. */
function StatSegment({
  icon,
  value,
  ariaLabel,
  onClick,
}: {
  icon: React.ReactNode;
  value: string;
  ariaLabel: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex items-center gap-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 transition-colors hover:bg-white/5"
      style={{
        padding: '0 12px',
        background: 'transparent',
        border: 'none',
      }}
    >
      {icon}
      <span
        style={{
          // Silkscreen — actual pixel-art font, lining figures by default,
          // legible at small sizes. Matches the painted village aesthetic.
          fontFamily: 'var(--font-pixel-mono), ui-monospace, monospace',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.5,
          color: COZY_TEXT,
          textShadow: COZY_TEXT_SHADOW,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </button>
  );
}

/** Thin teal-aurora vertical divider between stat segments inside the grouped pill. */
function SegmentDivider() {
  return (
    <div
      aria-hidden
      className="self-center"
      style={{
        width: 1,
        height: 18,
        backgroundColor: 'rgba(58, 143, 168, 0.6)',
      }}
    />
  );
}
