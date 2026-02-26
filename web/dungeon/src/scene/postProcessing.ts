import { Scene } from '@babylonjs/core/scene';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { GrainPostProcess } from '@babylonjs/core/PostProcesses/grainPostProcess';
import { ChromaticAberrationPostProcess } from '@babylonjs/core/PostProcesses/chromaticAberrationPostProcess';

export function setupPostProcessing(scene: Scene) {
  const camera = scene.activeCamera;
  if (!camera) return;

  // Default rendering pipeline — bloom
  const pipeline = new DefaultRenderingPipeline('default', true, scene, [camera]);
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.8;
  pipeline.bloomWeight = 0.3;
  pipeline.bloomKernel = 64;
  pipeline.bloomScale = 0.5;

  // Film grain for that gritty dungeon feel
  const grain = new GrainPostProcess('grain', 1.0, camera);
  grain.intensity = 15;
  grain.animated = true;

  // Subtle chromatic aberration at edges
  const engine = scene.getEngine();
  const chromatic = new ChromaticAberrationPostProcess(
    'chromatic',
    engine.getRenderWidth(),
    engine.getRenderHeight(),
    1.0,
    camera,
  );
  chromatic.aberrationAmount = 30;
  chromatic.radialIntensity = 0.8;
}
