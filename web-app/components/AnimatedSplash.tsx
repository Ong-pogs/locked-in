'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { PALETTE } from '@/lib/brand/crest';
import { createScene, makeLayout, renderWord } from './splash/scene';

/**
 * Animated splash: "Ignite + Iris + sparks" (drawing lives in ./splash/scene.ts).
 * It draws in a Web Worker on an OffscreenCanvas whenever the browser allows it,
 * so the app's own startup work on the main thread cannot make it stutter.
 * Older browsers draw the same scene on the main thread instead.
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
    let stop = () => {};
    const finish = () => {
      if (!cancelled) setShowSplash(false);
    };
    // Once the canvas draws its own dark background, the iris can show the app through it.
    const reveal = () => {
      overlay.style.background = 'transparent';
    };

    // The canvas is created here rather than in JSX, so a dev Strict Mode re-run gets a
    // fresh one: a canvas can hand its control to a worker only once.
    let canvas = makeCanvasEl();
    canvas.className = 'block h-full w-full';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Locked In');
    overlay.appendChild(canvas);

    // Fallback: the same scene, drawn on the main thread.
    const runOnMainThread = () => {
      const scene = createScene(canvas, makeCanvasEl);
      if (!scene) {
        // No 2D canvas at all: keep the dark overlay for the usual length, then go.
        const timer = window.setTimeout(finish, makeLayout(window.innerWidth, window.innerHeight).end + 40);
        stop = () => clearTimeout(timer);
        return;
      }
      let frame = 0;
      const resize = () => {
        const vp = viewport();
        scene.resize(vp.w, vp.h, vp.dpr);
        loadWord(vp).then((word) => !cancelled && scene.setWord(word));
      };
      const tick = () => {
        if (scene.frame(performance.now())) frame = requestAnimationFrame(tick);
        else finish();
      };
      resize();
      tick();
      reveal();
      window.addEventListener('resize', resize);
      stop = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', resize);
      };
    };

    // Preferred: draw in a worker so main-thread work never blocks a frame.
    const runInWorker = () => {
      const offscreen = canvas.transferControlToOffscreen();
      const worker = new Worker(new URL('./splash/splash.worker.ts', import.meta.url), { type: 'module' });
      let ready = false;
      const sendWord = (vp: ReturnType<typeof viewport>) =>
        loadWord(vp)
          .then((word) => (word && typeof createImageBitmap === 'function' ? createImageBitmap(word) : null))
          .then((bitmap) => bitmap && !cancelled && worker.postMessage({ type: 'word', word: bitmap }, [bitmap]))
          .catch(() => undefined);
      const resize = () => {
        const vp = viewport();
        worker.postMessage({ type: 'resize', ...vp });
        sendWord(vp);
      };
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          ready = true;
          reveal();
        } else if (data.type === 'done') {
          finish();
        }
      };
      worker.onerror = () => {
        worker.terminate();
        window.removeEventListener('resize', resize);
        if (ready || cancelled) return finish();
        // The worker never started: swap in a fresh canvas and draw on the main thread.
        const fresh = makeCanvasEl();
        fresh.className = canvas.className;
        canvas.replaceWith(fresh);
        canvas = fresh;
        runOnMainThread();
      };
      const vp = viewport();
      worker.postMessage({ type: 'start', canvas: offscreen, ...vp }, [offscreen]);
      sendWord(vp);
      window.addEventListener('resize', resize);
      stop = () => {
        worker.terminate();
        window.removeEventListener('resize', resize);
      };
    };

    if (canUseWorker()) {
      try {
        runInWorker();
      } catch {
        runOnMainThread();
      }
    } else {
      runOnMainThread();
    }

    // Safety net: never leave the overlay up.
    const cap = window.setTimeout(finish, HARD_CAP_MS);
    return () => {
      cancelled = true;
      clearTimeout(cap);
      stop();
      canvas.remove();
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
          style={{ zIndex: 9999, pointerEvents: 'none', background: PALETTE.background }}
        />
      )}
    </>
  );
}
