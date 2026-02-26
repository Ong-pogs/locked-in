import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import gsap from 'gsap';
import { VIEWPOINTS, VIEWPOINT_ORDER, type Viewpoint } from './viewpoints';
import { sendToRN } from '../bridge';

let camera: ArcRotateCamera;
let currentIndex = 0;
let isTransitioning = false;

export function createCamera(scene: Scene): ArcRotateCamera {
  // ArcRotateCamera: alpha (horizontal), beta (vertical), radius, target
  camera = new ArcRotateCamera('mainCam', -Math.PI / 2, Math.PI / 3, 12, Vector3.Zero(), scene);

  // Attach controls — drag to orbit, scroll to zoom, right-drag to pan
  camera.attachControl(scene.getEngine().getRenderingCanvas()!, true);

  // Limits
  camera.lowerRadiusLimit = 3;
  camera.upperRadiusLimit = 30;
  camera.lowerBetaLimit = 0.1;
  camera.upperBetaLimit = Math.PI / 2 + 0.3; // allow slightly below horizon

  // Smooth feel
  camera.inertia = 0.85;
  camera.wheelPrecision = 30;
  camera.panningSensibility = 100;

  return camera;
}

export function transitionTo(viewpoint: Viewpoint) {
  if (isTransitioning) return;

  const def = VIEWPOINTS[viewpoint];
  if (!def) return;

  const idx = VIEWPOINT_ORDER.indexOf(viewpoint);
  if (idx !== -1) currentIndex = idx;

  isTransitioning = true;

  gsap.to(camera, {
    alpha: Math.atan2(def.position.x - def.target.x, def.position.z - def.target.z),
    beta: Math.acos((def.position.y - def.target.y) / Vector3.Distance(def.position, def.target)),
    radius: Vector3.Distance(def.position, def.target),
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

export function getCamera(): ArcRotateCamera {
  return camera;
}
