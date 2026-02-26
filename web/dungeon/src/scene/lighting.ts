import { Scene } from '@babylonjs/core/scene';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';

let fireLight: PointLight;

export function setupLighting(scene: Scene) {
  // Ambient — brighter so the whole room is visible
  const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.6;
  ambient.diffuse = new Color3(0.5, 0.45, 0.4);
  ambient.groundColor = new Color3(0.15, 0.12, 0.1);

  // Main fire point light
  fireLight = new PointLight('fireLight', new Vector3(0, 2.2, 3), scene);
  fireLight.diffuse = new Color3(1.0, 0.6, 0.2);
  fireLight.specular = new Color3(1.0, 0.5, 0.15);
  fireLight.intensity = 2.5;
  fireLight.range = 15;

  // Accent light — deep in the room
  const accent = new PointLight('accentLight', new Vector3(-3, 3, 0), scene);
  accent.diffuse = new Color3(0.3, 0.35, 0.5);
  accent.intensity = 0.8;
  accent.range = 10;

  // Overhead light — general room fill
  const overhead = new PointLight('overheadLight', new Vector3(0, 5, 0), scene);
  overhead.diffuse = new Color3(0.4, 0.35, 0.3);
  overhead.intensity = 1.0;
  overhead.range = 14;
}

export function setFireLightIntensity(intensity: number) {
  if (fireLight) {
    fireLight.intensity = intensity;
  }
}

export function getFireLight(): PointLight {
  return fireLight;
}
