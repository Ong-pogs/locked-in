import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import gsap from 'gsap';

// ── Types ──────────────────────────────────────────────────────────

export interface CameraKeyframe {
  alpha: number;
  beta: number;
  radius: number;
  target: { x: number; y: number; z: number };
}

export interface CameraPath {
  name: string;
  keyframes: CameraKeyframe[];
  duration: number; // total seconds
}

// ── Registry ───────────────────────────────────────────────────────

const pathRegistry = new Map<string, CameraPath>();

/** Paste saved JSON objects here — they auto-register on module load */
const BUILT_IN_PATHS: CameraPath[] = [
  {
    name: 'old_chest',
    duration: 2.4,
    keyframes: [
      { alpha: 3.987, beta: 1.32, radius: 11.97, target: { x: 0, y: 1.5, z: 1 } },
      { alpha: 3.9086, beta: 1.2097, radius: 1, target: { x: 0, y: 1.5, z: 1 } },
    ],
  },
  {
    name: 'alchemy_table',
    duration: 2.4,
    keyframes: [
      { alpha: 3.987, beta: 1.32, radius: 11.97, target: { x: 0, y: 1.5, z: 1 } },
      { alpha: 3.2092, beta: 1.2579, radius: 7.869, target: { x: 0, y: 1.5, z: 1 } },
    ],
  },
  {
    name: 'alchemy_yield',
    duration: 2.4,
    keyframes: [
      { alpha: 3.987, beta: 1.32, radius: 11.97, target: { x: 0, y: 1.5, z: 1 } },
      { alpha: 3.2092, beta: 1.2579, radius: 7.869, target: { x: 0, y: 1.5, z: 1 } },
    ],
  },
  {
    name: 'bookshelf',
    duration: 2.4,
    keyframes: [
      { alpha: 3.987, beta: 1.32, radius: 11.97, target: { x: 0, y: 1.5, z: 1 } },
      { alpha: 4.5495, beta: 1.3259, radius: 6.021, target: { x: 0, y: 1.5, z: 1 } },
    ],
  },
  {
    name: 'streak_savers_lanterns',
    duration: 2.4,
    keyframes: [
      { alpha: 3.987, beta: 1.32, radius: 11.97, target: { x: 0, y: 1.5, z: 1 } },
      { alpha: 4.3578, beta: 1.5176, radius: 1, target: { x: 0, y: 1.5, z: 1 } },
    ],
  },
];

// Auto-register built-ins
for (const path of BUILT_IN_PATHS) {
  pathRegistry.set(path.name, path);
}

export function registerPath(path: CameraPath) {
  pathRegistry.set(path.name, path);
}

export function getPath(name: string): CameraPath | undefined {
  return pathRegistry.get(name);
}

export function hasPath(name: string): boolean {
  return pathRegistry.has(name);
}

// ── Recording (dev-time) ───────────────────────────────────────────

let recording: { name: string; keyframes: CameraKeyframe[] } | null = null;

export function startRecording(name: string) {
  recording = { name, keyframes: [] };
}

export function addKeyframe(camera: ArcRotateCamera) {
  if (!recording) return;
  const t = camera.target;
  recording.keyframes.push({
    alpha: parseFloat(camera.alpha.toFixed(4)),
    beta: parseFloat(camera.beta.toFixed(4)),
    radius: parseFloat(camera.radius.toFixed(3)),
    target: {
      x: parseFloat(t.x.toFixed(3)),
      y: parseFloat(t.y.toFixed(3)),
      z: parseFloat(t.z.toFixed(3)),
    },
  });
}

export function saveRecording(duration = 2.4): CameraPath | null {
  if (!recording || recording.keyframes.length < 2) {
    console.warn('[cameraPaths] Need at least 2 keyframes to save');
    return null;
  }
  const path: CameraPath = {
    name: recording.name,
    keyframes: recording.keyframes,
    duration,
  };
  registerPath(path);
  console.log('[cameraPaths] Saved path — paste into BUILT_IN_PATHS:');
  console.log(JSON.stringify(path, null, 2));
  return path;
}

export function clearRecording() {
  recording = null;
}

export function getRecordingState(): { name: string; count: number } | null {
  if (!recording) return null;
  return { name: recording.name, count: recording.keyframes.length };
}

// ── Playback ───────────────────────────────────────────────────────

export interface PlayPathOptions {
  ease?: string;
  onComplete?: () => void;
}

export function playPath(
  name: string,
  camera: ArcRotateCamera,
  options?: PlayPathOptions,
): gsap.core.Timeline | null {
  const path = pathRegistry.get(name);
  if (!path || path.keyframes.length < 2) return null;

  const { keyframes, duration } = path;
  const ease = options?.ease ?? 'power2.inOut';
  const segCount = keyframes.length - 1;
  const segDur = duration / segCount;

  const tl = gsap.timeline({
    onComplete: options?.onComplete,
  });

  // Snap camera to the first keyframe instantly
  const first = keyframes[0];
  camera.alpha = first.alpha;
  camera.beta = first.beta;
  camera.radius = first.radius;
  camera.target.set(first.target.x, first.target.y, first.target.z);

  // Build timeline segments
  for (let i = 1; i < keyframes.length; i++) {
    const kf = keyframes[i];
    const offset = (i - 1) * segDur;

    // Spherical coords
    tl.to(camera, {
      alpha: kf.alpha,
      beta: kf.beta,
      radius: kf.radius,
      duration: segDur,
      ease,
    }, offset);

    // Target proxy
    const prevTarget = keyframes[i - 1].target;
    const proxy = { x: prevTarget.x, y: prevTarget.y, z: prevTarget.z };
    tl.to(proxy, {
      x: kf.target.x,
      y: kf.target.y,
      z: kf.target.z,
      duration: segDur,
      ease,
      onUpdate: () => {
        camera.target.set(proxy.x, proxy.y, proxy.z);
      },
    }, offset);
  }

  return tl;
}
