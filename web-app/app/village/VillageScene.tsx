'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { User, Wallet } from 'lucide-react';
import { useLogin } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import boundsData from '@/public/images/village/masks/bounds.json';
import { VillageTour } from './VillageTour';

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
  // Wishing well — decorative (history folded into dashboard activity log)
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
  const { isAuthenticated, ensureFreshSession, markFreshLogin } = useAuth();
  const { login } = useLogin();

  // Trigger Privy login modal. Used by the top-right Connect Wallet pill
  // and by every building hotspot when the user isn't authenticated yet —
  // "wander first, connect when you want to do something".
  const promptConnect = async () => {
    await ensureFreshSession();
    markFreshLogin();
    login({ loginMethods: ['google', 'wallet'] });
  };

  // Visible buildings depend on auth state. Anonymous visitors only see the
  // Academy (so they can browse /courses without committing). Once they sign
  // in, the rest of the village wakes up. Other building pages are still
  // browsable by direct URL — this just controls the discoverable hotspots
  // on the hub itself.
  const visibleBuildings = isAuthenticated
    ? BUILDINGS
    : BUILDINGS.filter((b) => b.id === 'academy');

  // Click handler — visibility already enforces auth gating, so this just
  // navigates. (Defense-in-depth: the academy is in PUBLIC_ROUTES, so even
  // unauth'd users can land on /courses.)
  const handleBuildingClick = (route: string) => {
    router.push(route);
  };

  return (
    <div
      className="village-scene-outer fixed inset-0 z-0"
      style={{
        // #0E1B29 sampled directly from the painting's dark blue tone.
        backgroundColor: '#0E1B29',
      }}
    >
      {/*
        Desktop: aspect-ratio fit (letterbox/pillarbox to 16:9 of art).
        Mobile: image fills viewport HEIGHT (~16:9 = wider than the phone),
        outer container becomes a horizontal scroller so the player can pan
        across the village. Both modes share the same inner DOM — only the
        sizing differs (handled in styled-jsx below).
      */}
      <div className="village-scene-inner relative">
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
        {visibleBuildings.map((b) => (
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
        {visibleBuildings.map((b) => {
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
              onClick={() => handleBuildingClick(b.route)}
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
        {visibleBuildings.map((b, i) => {
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
                      fontSize: 16.5,
                      letterSpacing: 2.3,
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
        /* Desktop default: uniform letterbox fit. */
        .village-scene-outer {
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .village-scene-inner {
          width: 100vw;
          height: 100vh;
          max-width: calc(100vh * ${ART_RATIO});
          max-height: calc(100vw / ${ART_RATIO});
          flex-shrink: 0;
        }
        /* Mobile (< 768px): scroll the painted village horizontally.
           The inner is sized so its HEIGHT matches the viewport, which
           makes the WIDTH overflow on a portrait phone — the outer becomes
           a momentum-scroll container. dvh handles iOS browser chrome. */
        @media (max-width: 767px) {
          .village-scene-outer {
            overflow-x: auto;
            overflow-y: hidden;
            justify-content: flex-start;
            -webkit-overflow-scrolling: touch;
            scroll-behavior: smooth;
            /* Hide scrollbar — interaction is by touch swipe. */
            scrollbar-width: none;
          }
          .village-scene-outer::-webkit-scrollbar {
            display: none;
          }
          .village-scene-inner {
            width: calc(100dvh * ${ART_RATIO});
            height: 100dvh;
            max-width: none;
            max-height: none;
          }
        }

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

      {/* First-time walkthrough — auto-shows once, then never again
          (persisted in localStorage). Includes a Skip button + an X. */}
      <VillageTour bounds={BOUNDS} />

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

      {/* Top-right: single button. Authed → profile (→ /dashboard).
          Unauthed → Connect Wallet pill that triggers Privy login. */}
      <div className="fixed top-4 right-4 z-30">
        {isAuthenticated ? (
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
        ) : (
          <button
            onClick={() => void promptConnect()}
            aria-label="Connect wallet"
            className="flex items-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            style={{
              padding: '8px 16px 8px 14px',
              borderRadius: 12,
              backgroundColor: COZY_TEXT,
              border: `1px solid ${COZY_TEXT}`,
              boxShadow: `0 0 14px ${COZY_TEXT}aa, 0 6px 20px rgba(0,0,0,0.55)`,
              color: '#1A1000',
            }}
          >
            <Wallet size={15} color="#1A1000" strokeWidth={2.6} />
            <span
              className="font-pixel font-bold uppercase"
              style={{ fontSize: 12, letterSpacing: 1.2 }}
            >
              Connect
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
