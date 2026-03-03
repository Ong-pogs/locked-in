import { Scene } from '@babylonjs/core/scene';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PointerDragBehavior } from '@babylonjs/core/Behaviors/Meshes/pointerDragBehavior';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

let ambientLight: HemisphericLight;
let fireLight: PointLight;
let accentLight: PointLight;
let overheadLight: PointLight;
let sunMode = false;

// Draggable light orb
let orbMesh: Mesh;
let orbLight: PointLight;
let orbMat: StandardMaterial;

const ORB_COLORS = [
  { name: 'amber', diffuse: new Color3(1.0, 0.6, 0.15), specular: new Color3(1.0, 0.45, 0.1), emissive: new Color3(1.0, 0.5, 0.1) },
  { name: 'green', diffuse: new Color3(0.1, 1.0, 0.3), specular: new Color3(0.05, 0.8, 0.15), emissive: new Color3(0.1, 0.8, 0.2) },
  { name: 'blue', diffuse: new Color3(0.15, 0.4, 1.0), specular: new Color3(0.1, 0.3, 0.9), emissive: new Color3(0.1, 0.35, 0.9) },
];
let orbColorIndex = 0;

export function setupLighting(scene: Scene) {
  // Ambient
  ambientLight = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);

  // Main fire point light
  fireLight = new PointLight('fireLight', new Vector3(0, 2.2, 4), scene);
  fireLight.diffuse = new Color3(1.0, 0.6, 0.2);
  fireLight.specular = new Color3(1.0, 0.5, 0.15);
  fireLight.range = 20;

  // Accent light — deep in the room
  accentLight = new PointLight('accentLight', new Vector3(-4, 3, 0), scene);
  accentLight.diffuse = new Color3(0.3, 0.35, 0.5);
  accentLight.range = 14;

  // Overhead light — general room fill
  overheadLight = new PointLight('overheadLight', new Vector3(0, 5, 1), scene);
  overheadLight.diffuse = new Color3(0.4, 0.35, 0.3);
  overheadLight.range = 18;

  // Start in dungeon mode (dark atmospheric lighting)
  applyDungeonMode();

  // --- Draggable light orb (off by default) ---
  createDraggableOrb(scene);
}

function createDraggableOrb(scene: Scene) {
  orbMesh = MeshBuilder.CreateSphere('lightOrb', { diameter: 0.5, segments: 8 }, scene);
  orbMesh.position = new Vector3(0, 3, 0);

  orbMat = new StandardMaterial('lightOrbMat', scene);
  orbMat.disableLighting = true;
  applyOrbColor();
  orbMesh.material = orbMat;

  // Single point light parented to orb
  orbLight = new PointLight('orbLight', Vector3.Zero(), scene);
  orbLight.parent = orbMesh;
  orbLight.intensity = 60.0;
  orbLight.range = 80;
  applyOrbLightColor();

  // Drag behavior — drag on XZ plane, hold shift to drag Y
  const dragXZ = new PointerDragBehavior({ dragPlaneNormal: new Vector3(0, 1, 0) });
  dragXZ.useObjectOrientationForDragging = false;
  orbMesh.addBehavior(dragXZ);

  // Shift+drag for vertical movement
  const dragY = new PointerDragBehavior({ dragAxis: new Vector3(0, 1, 0) });
  dragY.useObjectOrientationForDragging = false;
  dragY.enabled = false;
  orbMesh.addBehavior(dragY);

  scene.onKeyboardObservable.add((kbInfo) => {
    const down = kbInfo.type === 1; // KEY_DOWN
    if (kbInfo.event.key === 'Shift') {
      dragXZ.enabled = !down;
      dragY.enabled = down;
    }
  });

  // Start hidden
  orbMesh.setEnabled(false);
  orbLight.setEnabled(false);
}

function applyOrbColor() {
  const c = ORB_COLORS[orbColorIndex];
  orbMat.emissiveColor = c.emissive;
  orbMat.diffuseColor = c.emissive;
}

function applyOrbLightColor() {
  const c = ORB_COLORS[orbColorIndex];
  orbLight.diffuse = c.diffuse;
  orbLight.specular = c.specular;
}

/** Toggle orb on/off. Returns true if now on. */
export function toggleOrb(): boolean {
  const next = !orbMesh.isEnabled();
  orbMesh.setEnabled(next);
  orbLight.setEnabled(next);
  return next;
}

/** Cycle to next color. Returns new color name. */
export function cycleOrbColor(): string {
  orbColorIndex = (orbColorIndex + 1) % ORB_COLORS.length;
  applyOrbColor();
  applyOrbLightColor();
  return ORB_COLORS[orbColorIndex].name;
}

export function getOrbColorName(): string {
  return ORB_COLORS[orbColorIndex].name;
}

/** Global light multiplier — adjusts all scene lights at once */
let lightMultiplier = 1.0;
const baseLightIntensities: Map<string, number> = new Map();

export function setLightMultiplier(value: number) {
  lightMultiplier = value;
  // Scale ambient
  if (sunMode) {
    ambientLight.intensity = 5.0 * lightMultiplier;
  } else {
    ambientLight.intensity = 0.3 * lightMultiplier;
  }
  fireLight.intensity = 2.5 * lightMultiplier;
  accentLight.intensity = 0.8 * lightMultiplier;
  overheadLight.intensity = 1.0 * lightMultiplier;
}

export function getLightMultiplier(): number {
  return lightMultiplier;
}

function applySunMode() {
  ambientLight.intensity = 5.0;
  ambientLight.diffuse = new Color3(1.0, 1.0, 1.0);
  ambientLight.groundColor = new Color3(1.0, 1.0, 1.0);
  fireLight.intensity = 2.5;
  accentLight.intensity = 0.8;
  overheadLight.intensity = 1.0;
}

function applyDungeonMode() {
  ambientLight.intensity = 0.3;
  ambientLight.diffuse = new Color3(0.4, 0.35, 0.3);
  ambientLight.groundColor = new Color3(0.08, 0.06, 0.05);
  fireLight.intensity = 2.5;
  accentLight.intensity = 0.8;
  overheadLight.intensity = 1.0;
}

/** Toggle between sun-bright and dungeon lighting. Returns true if sun mode. */
export function toggleSunMode(): boolean {
  sunMode = !sunMode;
  if (sunMode) applySunMode();
  else applyDungeonMode();
  return sunMode;
}

export function isSunMode(): boolean {
  return sunMode;
}

export function setFireLightIntensity(intensity: number) {
  if (fireLight) {
    fireLight.intensity = intensity;
  }
}

export function getFireLight(): PointLight {
  return fireLight;
}
