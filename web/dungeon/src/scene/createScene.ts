import { Scene } from '@babylonjs/core/scene';
import { Engine } from '@babylonjs/core/Engines/engine';
import { setupEnvironment } from './environment';
import { setupLighting } from './lighting';
import { setupPostProcessing } from './postProcessing';
import { createCamera } from '../camera/cameraController';
import { createDungeonGeometry } from '../objects/loadModels';
import { setupInteractables } from '../objects/interactables';
import { createFlameParticles } from '../effects/flameParticles';
import { createEmbers } from '../effects/embers';
import { sendToRN } from '../bridge';

export async function createScene(engine: Engine): Promise<Scene> {
  const scene = new Scene(engine);

  sendToRN({ type: 'loadProgress', payload: { progress: 0.1 } });

  // Camera
  const camera = createCamera(scene);
  scene.activeCamera = camera;

  sendToRN({ type: 'loadProgress', payload: { progress: 0.2 } });

  // Environment (fog, clear color)
  setupEnvironment(scene, 'underground');

  sendToRN({ type: 'loadProgress', payload: { progress: 0.3 } });

  // Lighting
  setupLighting(scene);

  sendToRN({ type: 'loadProgress', payload: { progress: 0.4 } });

  // Geometry — procedural dungeon room + placeholder props
  await createDungeonGeometry(scene);

  sendToRN({ type: 'loadProgress', payload: { progress: 0.7 } });

  // Interactables — tap detection
  setupInteractables(scene);

  sendToRN({ type: 'loadProgress', payload: { progress: 0.8 } });

  // Particles
  createFlameParticles(scene);
  createEmbers(scene);

  sendToRN({ type: 'loadProgress', payload: { progress: 0.9 } });

  // Post-processing (bloom, grain, chromatic aberration)
  // TODO: re-enable later for final polish
  // setupPostProcessing(scene);

  sendToRN({ type: 'loadProgress', payload: { progress: 1.0 } });

  return scene;
}
