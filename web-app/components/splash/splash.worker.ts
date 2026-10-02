import { createScene, type Scene } from './scene';

/**
 * Splash worker: draws the splash into an OffscreenCanvas off the main thread,
 * so the app's own startup work (hydration, data, wallet code) cannot make it stutter.
 *
 * Messages in:  start { canvas, w, h, dpr } | resize { w, h, dpr } | word { word }
 * Messages out: ready (first frame is on screen) | done (animation over)
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

let scene: Scene | null = null;

worker.onmessage = ({ data }) => {
  if (data.type === 'start') {
    const canvas = data.canvas as OffscreenCanvas;
    scene = createScene(canvas, (w, h) => new OffscreenCanvas(w, h));
    if (!scene) {
      worker.postMessage({ type: 'done' });
      return;
    }
    scene.resize(data.w, data.h, data.dpr);
    const tick = () => {
      if (!scene) return;
      if (scene.frame(performance.now())) nextFrame(tick);
      else worker.postMessage({ type: 'done' });
    };
    tick();
    worker.postMessage({ type: 'ready' });
  } else if (data.type === 'resize') {
    scene?.resize(data.w, data.h, data.dpr);
  } else if (data.type === 'word') {
    scene?.setWord(data.word as ImageBitmap | null);
  }
};
