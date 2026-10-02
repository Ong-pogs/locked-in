import { crestCells, PALETTE } from '@/lib/brand/crest';

/**
 * Splash scene: "Ignite + Iris + sparks", as plain canvas drawing.
 * No DOM or React here, so the same code runs in the splash worker
 * (off the main thread) or, as a fallback, on the main thread.
 */

export type Canvas2D = HTMLCanvasElement | OffscreenCanvas;
// The word sprite: a canvas on the main thread, an ImageBitmap once sent to the worker.
export type Sprite = Canvas2D | ImageBitmap;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type MakeCanvas = (w: number, h: number) => Canvas2D;

// ---- Timeline (ms of animation time) ----
const IRIS_AT = 1700; // the crest flares and the iris starts opening
const RING_STEP_MS = 45; // the iris opens one block-ring every 45 ms
const SPARK_COUNT = 28;
const FLICKER = [1, 1.3, 1.1]; // flame brightness in 3 hard steps during the hold
// A late frame advances the animation by at most this much, so a hiccup
// pauses the motion briefly instead of making it jump ahead.
const MAX_STEP_MS = 34;

const BG = PALETTE.background;
const CREST_GLOW = 'rgba(255,160,70,.75)';
const EMBER_GLOW = 'rgba(232,132,90,.8)';
export const WORD = 'LOCKED IN';

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
// Cached by color and brightness step, so frames do not rebuild color strings.
const colorCache = new Map<string, string>();
function bright(hex: string, b: number) {
  const key = `${hex}${Math.round(b * 50)}`;
  let out = colorCache.get(key);
  if (!out) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v: number) => Math.min(255, Math.round(v * Math.round(b * 50) / 50));
    out = `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
    colorCache.set(key, out);
  }
  return out;
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

export interface Layout {
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

export function makeLayout(width: number, height: number): Layout {
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

// ---- "LOCKED IN" sprite ----

// Text with extra letter spacing (canvas letterSpacing is not everywhere yet).
function drawSpaced(ctx: Ctx2D, text: string, x: number, y: number, spacing: number) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  let cursor = x;
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, cursor, y);
    cursor += widths[i] + spacing;
  });
}

/**
 * Renders the word once into its own canvas (device pixels). The main thread
 * does this because only it has the page's web fonts, then hands it to the scene.
 */
export function renderWord(make: MakeCanvas, L: Layout, dpr: number, font: string): Canvas2D | null {
  const size = L.wordSize * dpr;
  const spacing = 0.22 * size;
  const probe = make(1, 1).getContext('2d') as Ctx2D | null;
  if (!probe) return null;
  probe.font = `${size}px ${font}`;
  const width = [...WORD].reduce((sum, ch) => sum + probe.measureText(ch).width, 0) + spacing * (WORD.length - 1);
  const canvas = make(Math.ceil(width) + 2, Math.ceil(size * 1.3));
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) return null;
  ctx.font = `${size}px ${font}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = PALETTE.G;
  drawSpaced(ctx, WORD, 1, 0, spacing);
  return canvas;
}

// ---- Drawing ----

// Crest pixels into the offscreen canvas, each at its own point in the lighting schedule.
function drawCrest(c: Ctx2D, px: number, t: number, boost: number) {
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

// ---- Pre-rendered pieces ----
// MDN's canvas guide: pre-render repeated drawing on an offscreen canvas and avoid
// shadowBlur per frame. Ember glows are blurred once here, then frames only copy them.

const EMBER_PAD = 12; // CSS px of room around an ember for its 8 px glow

// A glowing ember square, one per color, scaled at draw time for each spark size.
function emberSprite(make: MakeCanvas, color: string, u: number, dpr: number): Canvas2D {
  const side = Math.ceil((u + 2 * EMBER_PAD) * dpr);
  const canvas = make(side, side);
  const g = canvas.getContext('2d') as Ctx2D;
  g.shadowColor = EMBER_GLOW;
  g.shadowBlur = 8 * dpr;
  g.fillStyle = color;
  g.fillRect(EMBER_PAD * dpr, EMBER_PAD * dpr, u * dpr, u * dpr);
  return canvas;
}

interface Sprites {
  ember: Record<string, Canvas2D>;
  // Iris blocks snapped to whole device pixels: [x, y, w, h, off].
  blocks: [number, number, number, number, number][];
}

function makeSprites(make: MakeCanvas, L: Layout, dpr: number): Sprites {
  const snap = (v: number) => Math.round(v * dpr);
  return {
    ember: { [PALETTE.O]: emberSprite(make, PALETTE.O, L.u, dpr), [PALETTE.G]: emberSprite(make, PALETTE.G, L.u, dpr) },
    blocks: L.blocks.map((b) => [snap(b.x), snap(b.y), snap(b.x + L.block) - snap(b.x), snap(b.y + L.block) - snap(b.y), b.off]),
  };
}

// Draws an ember sprite centered on (x, y) at square size `size`.
function drawEmber(ctx: Ctx2D, sprite: Canvas2D, L: Layout, x: number, y: number, size: number) {
  const half = (L.u / 2 + EMBER_PAD) * (size / L.u);
  ctx.drawImage(sprite, x - half, y - half, 2 * half, 2 * half);
}

function draw(ctx: Ctx2D, crest: Ctx2D, word: Sprite | null, S: Sprites, L: Layout, t: number, dpr: number) {
  // 1. Iris, in device pixels: dark blocks switch off ring by ring, revealing the app underneath.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = BG;
  for (const [x, y, w, h, off] of S.blocks) {
    if (t < off) ctx.fillRect(x, y, w, h);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 2. Crest and word: breathe in during the hold, then flare out as the iris opens.
  const flare = easeFlare(phase(t, IRIS_AT, 340));
  const scale = 1 - 0.08 * easeIn(phase(t, IRIS_AT - 220, 220)) + 0.98 * flare; // 1 -> .92 -> 1.9
  const alpha = 1 - flare;
  const boost = 1 + 1.5 * flare; // brightness 1 -> 2.5
  if (alpha > 0) {
    ctx.save();
    ctx.translate(L.cx, L.pivotY);
    ctx.scale(scale, scale);
    ctx.translate(-L.cx, -L.pivotY);

    // Crest pixels (hard edges, so smoothing off) with a warm glow that follows the lit
    // pixels. This one blur per frame stays: a pre-rendered glow would light unlit pixels.
    drawCrest(crest, L.u * dpr, t, boost);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = CREST_GLOW;
    ctx.shadowBlur = 2 * L.u * phase(t, 580, 700) * scale * dpr;
    ctx.drawImage(crest.canvas, L.crestX, L.crestY, 16 * L.u, 19 * L.u);
    ctx.shadowBlur = 0;

    // "LOCKED IN" rises in under the crest.
    const wp = easeWord(phase(t, 1180, 320));
    if (wp > 0 && word) {
      ctx.globalAlpha = alpha * wp;
      const ww = word.width / dpr;
      ctx.drawImage(word, L.cx - ww / 2, L.wordY + (1 - wp) * 0.3 * L.wordSize, ww, word.height / dpr);
    }
    ctx.restore();
  }

  // Embers and sparks are soft glow sprites.
  ctx.imageSmoothingEnabled = true;

  // 3. Ember: climbs from the bottom edge to the base of the flame, wiggling, then pops.
  if (t < 740) {
    const p = easeEmber(phase(t, 0, 540));
    const pop = phase(t, 540, 200);
    const rise = L.h - (L.crestY + 13.5 * L.u);
    ctx.globalAlpha = 1 - pop;
    drawEmber(ctx, S.ember[PALETTE.O], L, L.cx + keyframe(EMBER_X, p) * L.u, L.h + L.u / 2 - keyframe(EMBER_Y, p) * rise, L.u * (1 + 2 * pop));
  }

  // 4. Sparks: a ring of embers on the iris edge, fading over the last quarter of the trip.
  const st = t - (IRIS_AT + 60);
  if (st > 0) {
    for (const s of L.sparks) {
      const p = st / s.dur;
      if (p >= 1) continue;
      const r = s.r0 + (L.far - s.r0) * p;
      ctx.globalAlpha = p < 0.75 ? 1 : (1 - p) / 0.25;
      drawEmber(ctx, S.ember[s.color], L, L.cx + Math.cos(s.angle) * r, L.cy + Math.sin(s.angle) * r, s.size);
    }
  }
}

// ---- Scene: owns the canvases, the layout and the animation clock ----

export interface Scene {
  /** Size the canvas for a new viewport. Returns the new layout. */
  resize(w: number, h: number, dpr: number): Layout;
  /** Use a pre-rendered "LOCKED IN" sprite (see renderWord). */
  setWord(word: Sprite | null): void;
  /** Draw the frame for wall-clock time `now` (ms). Returns false once the animation is over. */
  frame(now: number): boolean;
  /** Current animation time (ms), so a hand-off can continue from the same moment. */
  time(): number;
  /** Jump to animation time `t` (ms); the next frame starts counting from there. */
  seek(t: number): void;
}

export function createScene(canvas: Canvas2D, make: MakeCanvas): Scene | null {
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  const crest = make(1, 1).getContext('2d') as Ctx2D | null;
  if (!ctx || !crest) return null;

  let L = makeLayout(1, 1);
  let dpr = 1;
  let sprites = makeSprites(make, L, dpr);
  let word: Sprite | null = null;
  let t = 0; // animation time
  let last = -1; // wall-clock time of the previous frame

  return {
    resize(w, h, nextDpr) {
      L = makeLayout(w, h);
      dpr = nextDpr;
      canvas.width = Math.round(L.w * dpr);
      canvas.height = Math.round(L.h * dpr);
      crest.canvas.width = Math.round(16 * L.u * dpr);
      crest.canvas.height = Math.round(19 * L.u * dpr);
      sprites = makeSprites(make, L, dpr);
      return L;
    },
    setWord(next) {
      word = next;
    },
    frame(now) {
      // Advance by the real elapsed time, capped, so a late frame never skips ahead.
      if (last >= 0) t += Math.min(now - last, MAX_STEP_MS);
      last = now;
      draw(ctx, crest, word, sprites, L, t, dpr);
      return t < L.end;
    },
    time() {
      return t;
    },
    seek(next) {
      t = next;
      last = -1;
    },
  };
}
