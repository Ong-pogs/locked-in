import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import gsap from 'gsap';
import { VIEWPOINTS, VIEWPOINT_ORDER, type Viewpoint } from './viewpoints';
import { hasPath, playPath } from './cameraPaths';

let camera: ArcRotateCamera;
let currentIndex = 0;
let isTransitioning = false;
let zoomedIn = false;
let lastViewpointIndex = 0;
let activeTimeline: gsap.core.Timeline | null = null;

export function createCamera(scene: Scene): ArcRotateCamera {
  const overview = VIEWPOINTS['overview'];

  // Use Babylon's own alpha/beta/radius directly — no manual conversion
  camera = new ArcRotateCamera(
    'mainCam',
    overview.alpha,
    overview.beta,
    overview.radius,
    overview.target.clone(),
    scene,
  );

  // No collisions — camera can pass through walls freely during transitions
  camera.checkCollisions = false;

  // Temporarily enable controls so we can debug the view
  camera.attachControl(scene.getEngine().getRenderingCanvas()!, true);
  camera.lowerRadiusLimit = 1;
  camera.upperRadiusLimit = 50;

  return camera;
}

export function transitionTo(viewpoint: Viewpoint) {
  if (isTransitioning) return;

  const def = VIEWPOINTS[viewpoint];
  if (!def) return;

  const idx = VIEWPOINT_ORDER.indexOf(viewpoint);
  if (idx !== -1) currentIndex = idx;

  zoomedIn = false;
  isTransitioning = true;

  // Animate alpha/beta/radius directly — values from Babylon's own log
  gsap.to(camera, {
    alpha: def.alpha,
    beta: def.beta,
    radius: def.radius,
    duration: 1.2,
    ease: 'power2.inOut',
    onComplete: () => {
      isTransitioning = false;
    },
  });

  const targetObj = { x: camera.target.x, y: camera.target.y, z: camera.target.z };
  gsap.to(targetObj, {
    x: def.target.x,
    y: def.target.y,
    z: def.target.z,
    duration: 1.2,
    ease: 'power2.inOut',
    onUpdate: () => {
      camera.target.set(targetObj.x, targetObj.y, targetObj.z);
    },
  });
}

/** Smoothly zoom the camera to focus on a world position */
export function focusOn(target: Vector3, distance = 4) {
  if (isTransitioning) return;

  lastViewpointIndex = currentIndex;
  zoomedIn = true;
  isTransitioning = true;

  // Keep current alpha/beta (viewing angle), just reduce radius and shift target
  gsap.to(camera, {
    radius: distance,
    duration: 1.2,
    ease: 'power2.inOut',
    onComplete: () => { isTransitioning = false; },
  });

  const targetObj = { x: camera.target.x, y: camera.target.y, z: camera.target.z };
  gsap.to(targetObj, {
    x: target.x,
    y: target.y,
    z: target.z,
    duration: 1.2,
    ease: 'power2.inOut',
    onUpdate: () => {
      camera.target.set(targetObj.x, targetObj.y, targetObj.z);
    },
  });
}

/** Zoom via recorded path if one exists, otherwise fall back to simple focusOn */
export function playPathOrFocusOn(objectId: string, target: Vector3, distance = 4) {
  if (isTransitioning) return;

  lastViewpointIndex = currentIndex;
  zoomedIn = true;
  isTransitioning = true;

  if (hasPath(objectId)) {
    activeTimeline = playPath(objectId, camera, {
      onComplete: () => {
        isTransitioning = false;
        activeTimeline = null;
      },
    });
  } else {
    // Existing simple zoom (same as focusOn)
    gsap.to(camera, {
      radius: distance,
      duration: 1.2,
      ease: 'power2.inOut',
      onComplete: () => { isTransitioning = false; },
    });

    const proxy = { x: camera.target.x, y: camera.target.y, z: camera.target.z };
    gsap.to(proxy, {
      x: target.x,
      y: target.y,
      z: target.z,
      duration: 1.2,
      ease: 'power2.inOut',
      onUpdate: () => {
        camera.target.set(proxy.x, proxy.y, proxy.z);
      },
    });
  }
}

/** Cycle to the next viewpoint */
export function nextViewpoint() {
  if (isTransitioning || zoomedIn) return;
  currentIndex = (currentIndex + 1) % VIEWPOINT_ORDER.length;
  transitionTo(VIEWPOINT_ORDER[currentIndex]);
}

/** Cycle to the previous viewpoint */
export function prevViewpoint() {
  if (isTransitioning || zoomedIn) return;
  currentIndex = (currentIndex - 1 + VIEWPOINT_ORDER.length) % VIEWPOINT_ORDER.length;
  transitionTo(VIEWPOINT_ORDER[currentIndex]);
}

/** Return camera to the last viewpoint after a zoom */
export function goBack() {
  if (!zoomedIn) return;
  // Kill any in-progress path timeline
  if (activeTimeline) {
    activeTimeline.kill();
    activeTimeline = null;
    isTransitioning = false;
  }
  if (isTransitioning) return;
  const viewpoint = VIEWPOINT_ORDER[lastViewpointIndex];
  transitionTo(viewpoint);
  window.dispatchEvent(new CustomEvent('camera-zoom-back'));
}

/** Returns true when focused on an object (not at a viewpoint) */
export function isZoomedIn(): boolean {
  return zoomedIn;
}

export function getCamera(): ArcRotateCamera {
  return camera;
}

export function logCameraPosition() {
  const pos = camera.position;
  const t = camera.target;
  console.log(
    `[camera] alpha: ${camera.alpha.toFixed(3)} beta: ${camera.beta.toFixed(3)} radius: ${camera.radius.toFixed(2)}` +
    `\n  pos: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})` +
    `\n  target: (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`
  );
}

let cameraLocked = true;

export function toggleCameraLock(): boolean {
  cameraLocked = !cameraLocked;
  const canvas = camera.getScene().getEngine().getRenderingCanvas()!;
  if (cameraLocked) {
    logCameraPosition();
    camera.detachControl();
  } else {
    camera.attachControl(canvas, true);
  }
  return cameraLocked;
}
