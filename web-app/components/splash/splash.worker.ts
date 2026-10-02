import { createScene, type Scene } from './scene';

/**
 * Splash worker: takes over drawing the splash from the main thread, into an
 * OffscreenCanvas, so the app's own startup work (hydration, data, wallet code)
 * cannot make it stutter. The main thread always starts the animation itself;
 * this worker is an upgrade, never something the splash waits on.
 *
 * Messages in:  start { canvas, w, h, dpr, t, sentAt } | resize { w, h, dpr } | word { word }
 * Messages out: loaded (code is running) | ready (frames are on screen, take over) | done
 */

// Minimal typing for the worker global (the project only loads the DOM lib).
const worker = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  requestAnimationFrame?: (cb: (t: number) => void) => number;
};

// rAF in workers is supported from Chrome 69, Firefox 99 and Safari 16.4; a timer covers the rest.
const nextFrame = (cb: () => void) =>
  worker.requestAnimationFrame ? worker.requestAnimationFrame(cb) : setTimeout(cb, 16);

// Same cap as one scene step: a slow hand-off never makes the animation jump.
const MAX_CATCH_UP_MS = 34;

let scene: Scene | null = null;

worker.onmessage = ({ data }) => {
  if (data.type === 'start') {
    const canvas = data.canvas as OffscreenCanvas;
    scene = createScene(canvas, (w, h) => new OffscreenCanvas(w, h));
    if (!scene) return; // the main thread simply keeps drawing
    scene.resize(data.w, data.h, data.dpr);
    // Continue from the main thread's animation time, plus the time this message took.
    const inFlight = performance.timeOrigin + performance.now() - data.sentAt;
    scene.seek(data.t + Math.min(Math.max(0, inFlight), MAX_CATCH_UP_MS));
    let frames = 0;
    const tick = () => {
      if (!scene) return;
      const running = scene.frame(performance.now());
      // After two drawn frames one is surely committed to the screen: safe to swap.
      if (++frames === 2) worker.postMessage({ type: 'ready' });
      if (running) nextFrame(tick);
      else worker.postMessage({ type: 'done' });
    };
    tick();
    nextFrame(tick);
  } else if (data.type === 'resize') {
    scene?.resize(data.w, data.h, data.dpr);
  } else if (data.type === 'word') {
    scene?.setWord(data.word as ImageBitmap | null);
  }
};

// Tell the main thread the handler is installed, so it can send the canvas and the current time.
worker.postMessage({ type: 'loaded' });
