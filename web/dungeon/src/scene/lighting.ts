import { Scene } from '@babylonjs/core/scene';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PointerDragBehavior } from '@babylonjs/core/Behaviors/Meshes/pointerDragBehavior';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

let fireLight: PointLight;

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
  // Ambient — brighter so the whole room is visible
  const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.6;
  ambient.diffuse = new Color3(0.5, 0.45, 0.4);
  ambient.groundColor = new Color3(0.15, 0.12, 0.1);

  // Main fire point light
  fireLight = new PointLight('fireLight', new Vector3(0, 2.2, 4), scene);
  fireLight.diffuse = new Color3(1.0, 0.6, 0.2);
  fireLight.specular = new Color3(1.0, 0.5, 0.15);
  fireLight.intensity = 2.5;
  fireLight.range = 20;

  // Accent light — deep in the room
  const accent = new PointLight('accentLight', new Vector3(-4, 3, 0), scene);
  accent.diffuse = new Color3(0.3, 0.35, 0.5);
  accent.intensity = 0.8;
  accent.range = 14;

  // Overhead light — general room fill
  const overhead = new PointLight('overheadLight', new Vector3(0, 5, 1), scene);
  overhead.diffuse = new Color3(0.4, 0.35, 0.3);
  overhead.intensity = 1.0;
  overhead.range = 18;

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

  // Point light parented to orb
  orbLight = new PointLight('orbLight', Vector3.Zero(), scene);
  orbLight.parent = orbMesh;
  orbLight.intensity = 20.0;
  orbLight.range = 60;
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

export function setFireLightIntensity(intensity: number) {
  if (fireLight) {
    fireLight.intensity = intensity;
  }
}

export function getFireLight(): PointLight {
  return fireLight;
}
