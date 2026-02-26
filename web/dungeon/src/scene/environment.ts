import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';

export type RoomPhase = 'gauntlet' | 'underground';

export function setupEnvironment(scene: Scene, phase: RoomPhase = 'underground') {
  applyPhase(scene, phase);
}

export function applyPhase(scene: Scene, phase: RoomPhase) {
  if (phase === 'underground') {
    // Cold, dark blue-black dungeon atmosphere
    scene.clearColor = new Color4(0.02, 0.02, 0.04, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.06;
    scene.fogColor = new Color3(0.03, 0.03, 0.06);
  } else {
    // Gauntlet: warmer amber fog (Stardew Valley-inspired)
    scene.clearColor = new Color4(0.05, 0.04, 0.02, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.04;
    scene.fogColor = new Color3(0.08, 0.06, 0.03);
  }
}
