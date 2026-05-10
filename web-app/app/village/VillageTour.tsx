'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const TOUR_STORAGE_KEY = 'locked-in:village-tour-completed';

const AMBER = '#FFD580';
const COZY_BG = 'rgba(14, 14, 28, 0.92)';
const COZY_BORDER = 'rgba(58, 143, 168, 0.55)';
const COZY_TEXT = '#FFD580';

type Bounds = { x: number; y: number; w: number; h: number };
type BoundsMap = Record<string, Bounds>;

type Step =
  | { kind: 'welcome' }
  | { kind: 'building'; target: string; title: string; body: string }
  | { kind: 'topbar'; title: string; body: string }
  | { kind: 'done' };

const STEPS: Step[] = [
  { kind: 'welcome' },
  {
    kind: 'building',
    target: 'academy',
    title: 'Academy',
    body: 'Start a course here. Pick one and lock USDC to commit — that\'s how the streak begins.',
  },
  {
    kind: 'building',
    target: 'forge',
    title: 'Brewery',
    body: 'Brew the Fuel you earn each day into Ichor — the in-game currency that redeems for USDC at the market.',
  },
  {
    kind: 'building',
    target: 'cottage',
    title: 'Market',
    body: 'Spend Ichor on coin pouches. Pouches are how you redeem your earnings as real USDC.',
  },
  {
    kind: 'building',
    target: 'tavern',
    title: 'Tavern',
    body: 'When players break streaks, their yield is redirected into the Community Pot. Active streak holders share what falls in.',
  },
  {
    kind: 'building',
    target: 'inventory',
    title: 'Inventory',
    body: 'Your savers, achievements, and earned trinkets live here.',
  },
  {
    kind: 'building',
    target: 'notice',
    title: 'Leaderboard',
    body: 'Top players by streak, XP, and ichor. The notice board posts the rankings.',
  },
  {
    kind: 'topbar',
    title: 'Your stats',
    body: 'Streak, fuel, ichor, level — always visible at the top, on every page. Click any of them to jump to your dashboard.',
  },
  { kind: 'done' },
];

export function VillageTour({ bounds }: { bounds: BoundsMap }) {
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  // Track viewport for letterbox math (the painted scene is letterboxed within the viewport).
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  // Cache the painted-scene rect so the spotlight aligns with it, not the raw viewport.
  const containerRef = useRef<DOMRect | null>(null);

  // Show on first visit only.
  useEffect(() => {
    try {
      const completed = window.localStorage.getItem(TOUR_STORAGE_KEY) === '1';
      if (!completed) setActive(true);
    } catch {
      setActive(true);
    }

    const update = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      // The painted village container is `.relative` inside `flex items-center
      // justify-center` — find the IMG element that's the painted village.
      const img = document.querySelector<HTMLImageElement>(
        'img[alt="Painted village"]',
      );
      if (img) containerRef.current = img.getBoundingClientRect();
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (!active) return null;
  const step = STEPS[stepIdx];
  const total = STEPS.length;

  const finish = () => {
    try {
      window.localStorage.setItem(TOUR_STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setActive(false);
  };

  const next = () => {
    if (stepIdx >= total - 1) {
      finish();
    } else {
      setStepIdx((i) => i + 1);
    }
  };
  const back = () => setStepIdx((i) => Math.max(0, i - 1));

  // Compute spotlight rect in viewport pixels for the current step.
  const spotlight = (() => {
    if (!viewport) return null;
    if (step.kind === 'welcome' || step.kind === 'done') return null;

    if (step.kind === 'topbar') {
      // Highlight the top-right stat cluster + profile button area (fixed
      // position in viewport — we render that directly to the viewport in
      // VillageScene at top-4 right-4).
      return {
        left: viewport.w - 360,
        top: 8,
        width: 350,
        height: 56,
      };
    }

    // Building step — convert normalized bounds → viewport pixels.
    const bb = bounds[step.target];
    if (!bb) return null;
    const c = containerRef.current;
    if (!c) return null;
    return {
      left: c.left + bb.x * c.width,
      top: c.top + bb.y * c.height,
      width: bb.w * c.width,
      height: bb.h * c.height,
    };
  })();

  // Tooltip placement: prefer below the spotlight, but flip above if it would
  // run off the bottom of the viewport.
  const tooltip = (() => {
    if (!viewport) return { left: 24, top: 24 } as const;
    const TOOL_W = 360;
    const TOOL_GAP = 16;
    if (!spotlight) {
      // Welcome / done — center the bubble.
      return {
        left: Math.max(16, viewport.w / 2 - TOOL_W / 2),
        top: Math.max(16, viewport.h / 2 - 110),
        anchor: 'center' as const,
      };
    }
    const wantBelow = spotlight.top + spotlight.height + TOOL_GAP + 200 < viewport.h;
    const top = wantBelow
      ? spotlight.top + spotlight.height + TOOL_GAP
      : Math.max(16, spotlight.top - TOOL_GAP - 180);
    const centerX = spotlight.left + spotlight.width / 2;
    const left = Math.max(16, Math.min(viewport.w - TOOL_W - 16, centerX - TOOL_W / 2));
    return { left, top, anchor: wantBelow ? ('below' as const) : ('above' as const) };
  })();

  // Title for the bubble
  const title =
    step.kind === 'welcome'
      ? 'Welcome to the village'
      : step.kind === 'done'
        ? 'You\'re ready'
        : step.title;
  const body =
    step.kind === 'welcome'
      ? 'This is your hub. Each glowing building is a part of your daily learning loop. Let me show you around — under a minute.'
      : step.kind === 'done'
        ? 'Click any building to dive in. You can revisit the dashboard anytime via your profile button at the top-right.'
        : step.body;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Village walkthrough"
      className="fixed inset-0 z-[100]"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Spotlight cutout — a small focused rect with a giant box-shadow
          darkens everything around it without compositing layers. */}
      {spotlight && (
        <div
          className="fixed pointer-events-none transition-all duration-300 ease-out"
          style={{
            left: spotlight.left - 8,
            top: spotlight.top - 8,
            width: spotlight.width + 16,
            height: spotlight.height + 16,
            borderRadius: 10,
            boxShadow: `0 0 0 9999px rgba(0,0,0,0.78)`,
            border: `2px solid ${AMBER}`,
            outline: `1px solid rgba(255,213,128,0.35)`,
            filter: `drop-shadow(0 0 12px ${AMBER}80)`,
          }}
        />
      )}

      {/* Full dim for welcome/done steps (no specific spotlight) */}
      {!spotlight && (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: 'rgba(0,0,0,0.78)' }}
        />
      )}

      {/* Tooltip bubble */}
      <div
        className="fixed rounded-lg p-4"
        style={{
          left: tooltip.left,
          top: tooltip.top,
          width: 360,
          backgroundColor: COZY_BG,
          border: `1px solid ${COZY_BORDER}`,
          boxShadow: `0 12px 40px rgba(0,0,0,0.6), 0 0 16px ${AMBER}40, inset 0 1px 0 rgba(255,213,128,0.15)`,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          pointerEvents: 'auto',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span
            className="font-pixel-mono text-[10px] uppercase tracking-[1.5px]"
            style={{ color: COZY_TEXT, opacity: 0.7 }}
          >
            Step {stepIdx + 1} of {total}
          </span>
          <button
            type="button"
            onClick={finish}
            aria-label="Skip tour"
            className="cursor-pointer"
            style={{ background: 'none', border: 'none', color: COZY_TEXT, opacity: 0.7 }}
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
        <p
          className="font-pixel text-base font-bold leading-tight mb-1"
          style={{ color: COZY_TEXT, textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
        >
          {title}
        </p>
        <p className="font-pixel text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {body}
        </p>

        <div className="flex items-center justify-between mt-4 gap-2">
          <button
            type="button"
            onClick={back}
            disabled={stepIdx === 0}
            className="font-pixel-mono text-[11px] uppercase tracking-[1.5px] flex items-center gap-1 px-3 py-1.5 rounded transition-opacity cursor-pointer"
            style={{
              color: COZY_TEXT,
              backgroundColor: 'transparent',
              border: `1px solid ${COZY_BORDER}`,
              opacity: stepIdx === 0 ? 0.4 : 1,
              cursor: stepIdx === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <ChevronLeft size={12} color={COZY_TEXT} strokeWidth={2.5} />
            Back
          </button>
          <button
            type="button"
            onClick={finish}
            className="font-pixel-mono text-[11px] uppercase tracking-[1.5px] px-3 py-1.5 rounded transition-colors cursor-pointer"
            style={{
              color: 'rgba(255,255,255,0.6)',
              backgroundColor: 'transparent',
              border: 'none',
            }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={next}
            className="font-pixel-mono text-[11px] uppercase tracking-[1.5px] flex items-center gap-1 px-4 py-1.5 rounded transition-colors cursor-pointer"
            style={{
              color: '#1A1000',
              backgroundColor: AMBER,
              border: `1px solid ${AMBER}`,
              boxShadow: `0 0 12px ${AMBER}80`,
            }}
          >
            {stepIdx >= total - 1 ? 'Done' : 'Next'}
            {stepIdx < total - 1 && <ChevronRight size={12} color="#1A1000" strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
