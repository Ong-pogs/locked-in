'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { crestCells, PALETTE } from '@/lib/brand/crest';

/**
 * Animated splash: "Ignite + Iris + sparks".
 * An ember rises and lights the pixel crest, the border traces up both sides,
 * then a stepped pixel circle (with a ring of sparks on its edge) opens from
 * the crest and reveals the app underneath.
 * Everything is drawn on one canvas so cheaper phones stay smooth.
 * Only shows once per browser session (sessionStorage flag) and never with reduced motion.
 */

// ---- Timeline (ms from mount) ----
const IRIS_AT = 1700; // the crest flares and the iris starts opening
const HARD_CAP_MS = 3200; // the overlay is always gone by this point
const RING_STEP_MS = 45; // the iris opens one block-ring every 45 ms
const SPARK_COUNT = 28;
const FLICKER = [1, 1.3, 1.1]; // flame brightness in 3 hard steps during the hold

const BG = PALETTE.background;
const CREST_GLOW = 'rgba(255,160,70,.75)';
const EMBER_GLOW = 'rgba(232,132,90,.8)';

// ---- Small math helpers ----
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
// Linear 0..1 progress of a phase that starts at `start` and lasts `dur` ms.
const phase = (t: number, start: number, dur: number) => clamp01((t - start) / dur);

// CSS cubic-bezier easing, solved by bisection (accurate enough for 60 fps).
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const curve = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (curve(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return curve(y1, y2, (lo + hi) / 2);
  };
}
const easeEmber = cubicBezier(0.3, 0.6, 0.4, 1);
const easeWord = cubicBezier(0.2, 0.7, 0.2, 1);
const easeFlare = cubicBezier(0.5, 0, 0.8, 0.4);
const easeIn = cubicBezier(0.42, 0, 1, 1);

// Piecewise-linear keyframes ([offset, value] pairs) sampled at progress p.
function keyframe(keys: [number, number][], p: number) {
  for (let i = 1; i < keys.length; i++) {
    const [o0, v0] = keys[i - 1];
    const [o1, v1] = keys[i];
    if (p <= o1) return v0 + (v1 - v0) * ((p - o0) / (o1 - o0));
  }
  return keys[keys.length - 1][1];
}
const EMBER_X: [number, number][] = [[0, 0], [0.35, -1.5], [0.7, 1.2], [1, 0]]; // in crest pixels
const EMBER_Y: [number, number][] = [[0, 0], [0.35, 0.4], [0.7, 0.75], [1, 1]]; // share of the rise

// Small seeded PRNG, so the splash plays the same way every time.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// CSS brightness(b) on a hex color: scale RGB, clamp at 255.
function bright(hex: string, b: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.min(255, Math.round(v * b));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// ---- Crest cells with their lighting schedule (same for every viewport) ----
interface TimedCell {
  row: number;
  col: number;
  color: string;
  start: number;
  dur: number;
  flash: number; // brightness when the cell first appears, eases down to 1
  flicker: number; // start of the hold flicker, -1 for none
}

function timedCells(): TimedCell[] {
  const rnd = mulberry32(19);
  return crestCells().map(({ row, col, color, kind }) => {
    if (kind === 'flame') {
      // Bottom flame row lights first, one row every 40 ms.
      return { row, col, color, start: 520 + (14 - row) * 40, dur: 260, flash: 2.4, flicker: 1300 + rnd() * 100 };
    }
    if (kind === 'border') {
      // Angle from the bottom tip: traces up both sides at once.
      const angle = Math.abs(Math.atan2(col - 7.5, row - 9.5));
      return { row, col, color, start: 760 + (angle / Math.PI) * 400, dur: 160, flash: 2.2, flicker: -1 };
    }
    return { row, col, color, start: 1080 + rnd() * 120, dur: 260, flash: 1, flicker: -1 };
  });
}
const CELLS = timedCells();

// ---- Viewport layout: crest position, iris blocks, sparks ----
interface Spark {
  angle: number;
  r0: number;
  size: number;
  color: string;
  dur: number;
}

interface Layout {
  w: number;
  h: number;
  u: number; // one crest pixel in CSS px (integer, so edges stay crisp)
  crestX: number;
  crestY: number;
  cx: number; // crest center, also the iris origin
  cy: number;
  pivotY: number; // breath and flare scale around this point
  wordY: number;
  wordSize: number;
  block: number;
  blocks: { x: number; y: number; off: number }[];
  far: number;
  sparks: Spark[];
  end: number; // last block gone and last spark faded
}

function makeLayout(width: number, height: number): Layout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const rnd = mulberry32(7);
  const u = Math.min(11, Math.max(5, Math.floor(Math.min(176, w * 0.42) / 16)));
  const wordSize = Math.round(u * 2.2);
  const groupH = 19 * u + 2 * u + wordSize; // crest, gap, word
  const top = Math.round((h - groupH) / 2);
  const cx = w / 2;
  const cy = top + 9.5 * u;

  // Iris grid: square blocks, about 14 across on phones, capped at 64 px on wide screens.
  // Each block switches off when its ring is reached, nearest rings first.
  const block = Math.min(w / 14, 64);
  const blocks: Layout['blocks'] = [];
  let far = 0;
  for (let y = 0; y < h; y += block) {
    for (let x = 0; x < w; x += block) {
      const d = Math.hypot(x + block / 2 - cx, y + block / 2 - cy);
      far = Math.max(far, d);
      blocks.push({ x, y, off: IRIS_AT + 60 + Math.floor(d / block) * RING_STEP_MS });
    }
  }
  far += block;

  // Sparks move at the iris speed (one block per ring step), so they ride the opening edge.
  const speed = block / RING_STEP_MS;
  const sparks = Array.from({ length: SPARK_COUNT }, (_, k): Spark => {
    const r0 = block * (0.6 + rnd() * 0.4);
    return {
      angle: (k / SPARK_COUNT) * Math.PI * 2 + (rnd() - 0.5) * 0.2,
      r0,
      size: u * (0.5 + rnd() * 0.4),
      color: k % 3 ? PALETTE.O : PALETTE.G,
      dur: ((far - r0) / speed) * (0.95 + rnd() * 0.1),
    };
  });

  const lastBlock = Math.max(...blocks.map((b) => b.off));
  const lastSpark = IRIS_AT + 60 + Math.max(...sparks.map((s) => s.dur));
  return {
    w, h, u, cx, cy, wordSize, block, blocks, far, sparks,
    crestX: Math.round(cx - 8 * u),
    crestY: top,
    pivotY: top + 0.6 * groupH,
    wordY: top + 21 * u,
    end: Math.max(lastBlock, lastSpark),
  };
}

// ---- Drawing ----

// Crest pixels into the offscreen canvas, each at its own point in the lighting schedule.
function drawCrest(c: CanvasRenderingContext2D, px: number, t: number, boost: number) {
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  for (const cell of CELLS) {
    const p = phase(t, cell.start, cell.dur);
    if (p <= 0) continue;
    let b = cell.flash + (1 - cell.flash) * p;
    if (cell.flicker >= 0) {
      const f = phase(t, cell.flicker, 300);
      if (f > 0 && f < 1) b *= FLICKER[Math.floor(f * 3)];
    }
    // Rounded edges so neighbouring pixels never leave a seam.
    const x0 = Math.round(cell.col * px);
    const y0 = Math.round(cell.row * px);
    c.globalAlpha = p;
    c.fillStyle = bright(cell.color, b * boost);
    c.fillRect(x0, y0, Math.round((cell.col + 1) * px) - x0, Math.round((cell.row + 1) * px) - y0);
  }
  c.globalAlpha = 1;
}

// Text centered on x with extra letter spacing (canvas letterSpacing is not everywhere yet).
function drawSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  let cursor = x - (widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1)) / 2;
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, cursor, y);
    cursor += widths[i] + spacing;
  });
}

function draw(
  ctx: CanvasRenderingContext2D,
  offCtx: CanvasRenderingContext2D,
  L: Layout,
  t: number,
  font: string,
  dpr: number,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, L.w, L.h);

  // 1. Iris: dark blocks switch off ring by ring, revealing the app underneath.
  ctx.fillStyle = BG;
  for (const b of L.blocks) {
    if (t < b.off) ctx.fillRect(b.x, b.y, L.block + 0.5, L.block + 0.5);
  }

  // 2. Crest and word: breathe in during the hold, then flare out as the iris opens.
  const flare = easeFlare(phase(t, IRIS_AT, 340));
  const scale = 1 - 0.08 * easeIn(phase(t, IRIS_AT - 220, 220)) + 0.98 * flare; // 1 -> .92 -> 1.9
  const alpha = 1 - flare;
  const boost = 1 + 1.5 * flare; // brightness 1 -> 2.5
  if (alpha > 0) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(L.cx, L.pivotY);
    ctx.scale(scale, scale);
    ctx.translate(-L.cx, -L.pivotY);

    // Crest with its warm glow (one shadowed draw per frame, not one per pixel).
    drawCrest(offCtx, L.u * dpr, t, boost);
    ctx.shadowColor = CREST_GLOW;
    ctx.shadowBlur = 2 * L.u * phase(t, 580, 700) * scale * dpr;
    ctx.drawImage(offCtx.canvas, L.crestX, L.crestY, 16 * L.u, 19 * L.u);

    // "LOCKED IN" rises in under the crest.
    const wp = easeWord(phase(t, 1180, 320));
    if (wp > 0) {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = alpha * wp;
      ctx.fillStyle = bright(PALETTE.G, boost);
      ctx.font = `${L.wordSize}px ${font}`;
      ctx.textBaseline = 'top';
      drawSpaced(ctx, 'LOCKED IN', L.cx, L.wordY + (1 - wp) * 0.3 * L.wordSize, 0.22 * L.wordSize);
    }
    ctx.restore();
  }

  // 3. Ember: climbs from the bottom edge to the base of the flame, wiggling, then pops.
  if (t < 740) {
    const p = easeEmber(phase(t, 0, 540));
    const pop = phase(t, 540, 200);
    const rise = L.h - (L.crestY + 13.5 * L.u);
    const size = L.u * (1 + 2 * pop);
    const x = L.cx + keyframe(EMBER_X, p) * L.u;
    const y = L.h + L.u / 2 - keyframe(EMBER_Y, p) * rise;
    ctx.globalAlpha = 1 - pop;
    ctx.shadowColor = EMBER_GLOW;
    ctx.shadowBlur = 8 * dpr;
    ctx.fillStyle = PALETTE.O;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }

  // 4. Sparks: a ring of embers on the iris edge, fading over the last quarter of the trip.
  const st = t - (IRIS_AT + 60);
  if (st > 0) {
    ctx.shadowColor = EMBER_GLOW;
    ctx.shadowBlur = 8 * dpr;
    for (const s of L.sparks) {
      const p = st / s.dur;
      if (p >= 1) continue;
      const r = s.r0 + (L.far - s.r0) * p;
      ctx.globalAlpha = p < 0.75 ? 1 : (1 - p) / 0.25;
      ctx.fillStyle = s.color;
      ctx.fillRect(L.cx + Math.cos(s.angle) * r - s.size / 2, L.cy + Math.sin(s.angle) * r - s.size / 2, s.size, s.size);
    }
  }
}

export function AnimatedSplash({ children }: { children: ReactNode }) {
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (sessionStorage.getItem('splash-shown')) return false;
    sessionStorage.setItem('splash-shown', '1');
    return true;
  });
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Animation loop plus the dismiss timer.
  useEffect(() => {
    if (!showSplash) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    const offCtx = document.createElement('canvas').getContext('2d');
    // The app's pixel label font (Silkscreen), loaded by next/font in layout.tsx.
    const font =
      getComputedStyle(document.documentElement).getPropertyValue('--font-pixel-mono').trim() || 'monospace';
    const startedAt = performance.now();
    let layout = makeLayout(window.innerWidth, window.innerHeight);
    let dpr = 1;
    let frame = 0;

    // Size both canvases for the current viewport (DPR capped at 2 to keep it light).
    const resize = () => {
      layout = makeLayout(window.innerWidth, window.innerHeight);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas) {
        canvas.width = Math.round(layout.w * dpr);
        canvas.height = Math.round(layout.h * dpr);
      }
      if (offCtx) {
        offCtx.canvas.width = Math.round(16 * layout.u * dpr);
        offCtx.canvas.height = Math.round(19 * layout.u * dpr);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    // Without a 2D context (very old browser, or tests) the overlay stays dark until the timer.
    if (ctx && offCtx) {
      const tick = () => {
        draw(ctx, offCtx, layout, performance.now() - startedAt, font, dpr);
        frame = requestAnimationFrame(tick);
      };
      tick();
      // The canvas now paints the dark background itself, so the iris can show the app through it.
      if (overlayRef.current) overlayRef.current.style.background = 'transparent';
    }

    // Remove the overlay once the last block and spark are gone (always by the hard cap).
    const timer = window.setTimeout(() => setShowSplash(false), Math.min(layout.end + 40, HARD_CAP_MS));
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener('resize', resize);
    };
  }, [showSplash]);

  return (
    <>
      {children}

      {/* Splash overlay: above app content, never blocks taps */}
      {showSplash && (
        <div
          ref={overlayRef}
          data-testid="animated-splash"
          className="fixed inset-0"
          style={{ zIndex: 9999, pointerEvents: 'none', background: BG }}
        >
          <canvas ref={canvasRef} role="img" aria-label="Locked In" className="block h-full w-full" />
        </div>
      )}
    </>
  );
}
