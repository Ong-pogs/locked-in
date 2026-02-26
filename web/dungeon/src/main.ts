import { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Debug/debugLayer';
import '@babylonjs/inspector';
import { createScene } from './scene/createScene';
import { onBridgeMessage, sendToRN } from './bridge';
import { transitionTo } from './camera/cameraController';
import { setFlameState } from './effects/flameParticles';
import { applyPhase } from './scene/environment';
import type { Viewpoint } from './camera/viewpoints';
import type { FlameState } from './effects/flameStates';
import type { RoomPhase } from './scene/environment';

async function main() {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;

  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
  });

  // Scale down on lower-end devices
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  if (pixelRatio < 1.5) {
    engine.setHardwareScalingLevel(1.5);
  }

  const scene = await createScene(engine);

  // Register bridge message handler
  onBridgeMessage((msg) => {
    switch (msg.type) {
      case 'initState': {
        const { flameState, viewpoint, roomPhase } = msg.payload;
        if (flameState) setFlameState(flameState as FlameState);
        if (viewpoint) transitionTo(viewpoint as Viewpoint);
        if (roomPhase) applyPhase(scene, roomPhase as RoomPhase);
        break;
      }
      case 'flameState': {
        const { state } = msg.payload;
        if (state) setFlameState(state as FlameState);
        break;
      }
      case 'setViewpoint': {
        const { viewpoint } = msg.payload;
        if (viewpoint) transitionTo(viewpoint as Viewpoint);
        break;
      }
      case 'setRoomPhase': {
        const { phase } = msg.payload;
        if (phase) applyPhase(scene, phase as RoomPhase);
        break;
      }
    }
  });

  // Render loop
  engine.runRenderLoop(() => {
    scene.render();
  });

  // Resize
  window.addEventListener('resize', () => {
    engine.resize();
  });

  // Open inspector for live tuning (dev only)
  scene.debugLayer.show({ embedMode: true });

  // Notify RN we're ready
  sendToRN({ type: 'sceneReady', payload: {} });
}

main().catch((err) => {
  console.error('Failed to initialize dungeon scene:', err);
});
