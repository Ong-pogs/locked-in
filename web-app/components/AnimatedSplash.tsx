'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { PALETTE } from '@/lib/brand/crest';
import { createScene, makeLayout, renderWord } from './splash/scene';

/**
 * Animated splash: "Ignite + Iris + sparks" (drawing lives in ./splash/scene.ts).
 * The main thread starts drawing at once, so the splash never waits on the network.
 * Where the browser allows it, a Web Worker loads in parallel and takes over drawing
 * on an OffscreenCanvas, so the app's own startup work cannot make it stutter.
 * If the worker is slow, fails, or is unsupported, the main thread simply finishes.
 * Only shows once per browser session (sessionStorage flag) and never with reduced motion.
 */

const HARD_CAP_MS = 4000; // the overlay is always gone by this point, even if drawing stalls

const viewport = () => ({
  w: window.innerWidth,
  h: window.innerHeight,
  dpr: Math.min(2, window.devicePixelRatio || 1), // capped to keep the canvas light
});

// Off-main-thread drawing needs Worker plus canvas control transfer (Chrome 69, Firefox 105, Safari 16.4).
const canUseWorker = () =>
  typeof Worker !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';

function makeCanvasEl(w = 1, h = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

// A full-screen canvas layer inside the overlay (main and worker layers stack).
function makeLayer(overlay: HTMLElement) {
  const canvas = makeCanvasEl();
  canvas.className = 'absolute inset-0 block h-full w-full';
  canvas.setAttribute('aria-hidden', 'true');
  overlay.appendChild(canvas);
  return canvas;
}

// Renders "LOCKED IN" in the app's pixel font (Silkscreen from next/font), once the font is ready.
async function loadWord(vp: ReturnType<typeof viewport>) {
  const font =
    getComputedStyle(document.documentElement).getPropertyValue('--font-pixel-mono').trim() || 'monospace';
  const L = makeLayout(vp.w, vp.h);
  await document.fonts?.load(`${L.wordSize * vp.dpr}px ${font}`).catch(() => undefined);
  return renderWord(makeCanvasEl, L, vp.dpr, font);
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

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!showSplash || !overlay) return;
    let cancelled = false;
    const finish = () => {
      if (!cancelled) setShowSplash(false);
    };
    const cleanups: Array<() => void> = [];

    // ---- 1. Main thread: draws from the very first frame ----
    // Canvases are created here rather than in JSX, so a dev Strict Mode re-run gets fresh
    // ones: a canvas can hand its control to a worker only once.
    const mainCanvas = makeLayer(overlay);
    const scene = createScene(mainCanvas, makeCanvasEl);
    let mainFrame = 0;
    let mainRunning = false;
    const stopMain = () => {
      mainRunning = false;
      cancelAnimationFrame(mainFrame);
    };
    if (scene) {
      const tick = () => {
        if (!mainRunning) return;
        if (scene.frame(performance.now())) mainFrame = requestAnimationFrame(tick);
        else finish();
      };
      const vp = viewport();
      scene.resize(vp.w, vp.h, vp.dpr);
      loadWord(vp).then((word) => !cancelled && scene.setWord(word));
      mainRunning = true;
      tick();
      // The canvas now paints the dark background itself, so the iris can show the app through it.
      overlay.style.background = 'transparent';
    } else {
      // No 2D canvas at all: keep the dark overlay for the usual length, then go.
      const timer = window.setTimeout(finish, makeLayout(window.innerWidth, window.innerHeight).end + 40);
      cleanups.push(() => clearTimeout(timer));
    }
    cleanups.push(stopMain);

    // ---- 2. Worker: loads in parallel and takes over once its frames are on screen ----
    if (canUseWorker()) {
      try {
        const workerCanvas = makeLayer(overlay);
        workerCanvas.style.opacity = '0'; // hidden until the hand-off
        const offscreen = workerCanvas.transferControlToOffscreen();
        const worker = new Worker(new URL('./splash/splash.worker.ts', import.meta.url), { type: 'module' });
        let started = false;
        let handedOff = false;
        const sendWord = (vp: ReturnType<typeof viewport>) =>
          loadWord(vp)
            .then((word) => (word && typeof createImageBitmap === 'function' ? createImageBitmap(word) : null))
            .then((bitmap) => bitmap && !cancelled && worker.postMessage({ type: 'word', word: bitmap }, [bitmap]))
            .catch(() => undefined);

        worker.onmessage = ({ data }) => {
          if (data.type === 'loaded' && !started && (mainRunning || !scene)) {
            // Its code is running: hand it the canvas and the current animation time.
            started = true;
            const vp = viewport();
            worker.postMessage(
              { type: 'start', canvas: offscreen, ...vp, t: scene?.time() ?? 0, sentAt: performance.timeOrigin + performance.now() },
              [offscreen],
            );
            sendWord(vp);
          } else if (data.type === 'ready' && !handedOff) {
            // Swap layers in one task, so the screen never shows a gap.
            handedOff = true;
            stopMain();
            workerCanvas.style.opacity = '1';
            mainCanvas.style.visibility = 'hidden';
            overlay.style.background = 'transparent'; // the worker canvas paints the dark background now
          } else if (data.type === 'done') {
            finish();
          }
        };
        // A failed worker changes nothing on screen: the main thread keeps (or finishes) drawing.
        worker.onerror = () => {
          worker.terminate();
          workerCanvas.remove();
          if (handedOff) finish();
        };

        const onResize = () => {
          if (!started) return;
          const vp = viewport();
          worker.postMessage({ type: 'resize', ...vp });
          sendWord(vp);
        };
        window.addEventListener('resize', onResize);
        cleanups.push(() => {
          worker.terminate();
          window.removeEventListener('resize', onResize);
        });
      } catch {
        // Worker creation can fail (for example a strict CSP): the main thread carries on.
      }
    }

    // The main scene follows viewport changes too.
    const onMainResize = () => {
      if (!scene || !mainRunning) return;
      const vp = viewport();
      scene.resize(vp.w, vp.h, vp.dpr);
      loadWord(vp).then((word) => !cancelled && scene.setWord(word));
    };
    window.addEventListener('resize', onMainResize);
    cleanups.push(() => window.removeEventListener('resize', onMainResize));

    // Safety net: never leave the overlay up.
    const cap = window.setTimeout(finish, HARD_CAP_MS);
    return () => {
      cancelled = true;
      clearTimeout(cap);
      cleanups.forEach((fn) => fn());
      overlay.replaceChildren();
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
          role="img"
          aria-label="Locked In"
          className="fixed inset-0"
          style={{ zIndex: 9999, pointerEvents: 'none', background: PALETTE.background }}
        />
      )}
    </>
  );
}
