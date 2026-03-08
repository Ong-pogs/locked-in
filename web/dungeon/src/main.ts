import { Engine } from '@babylonjs/core/Engines/engine';
import { createScene } from './scene/createScene';
import { onBridgeMessage, sendToRN } from './bridge';
import { transitionTo, goBack, getCamera } from './camera/cameraController';
import { setFlameState } from './effects/flameParticles';
import { applyPhase } from './scene/environment';
import { setRoomTexture } from './objects/loadModels';
import { applyGauntletLighting, applyNormalLighting } from './scene/lighting';
import { setEffectGroupEnabled, setAllEffectLightsEnabled } from './effects/candleFlames';
import { playPath } from './camera/cameraPaths';
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

  // No downscale — full native resolution on all devices
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  if (pixelRatio < 1.5) {
    engine.setHardwareScalingLevel(1.5);
  }

  const scene = await createScene(engine);

  // Force resize after init (catches DevTools viewport edge cases)
  engine.resize(true);

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
      case 'cameraGoBack': {
        goBack();
        break;
      }
      case 'setLightingMode': {
        const { mode } = msg.payload;
        if (mode === 'gauntlet') {
          // Only chandelier on
          applyGauntletLighting();
          setAllEffectLightsEnabled(false);
          setEffectGroupEnabled('chandelier', true);
        } else {
          applyNormalLighting();
          setAllEffectLightsEnabled(true);
        }
        break;
      }
      case 'snapToLamps': {
        // Instantly position camera at lamp close-up (while RN overlay is black)
        const cam = getCamera();
        cam.alpha = 4.373;
        cam.beta = 1.425;
        cam.radius = 1.0;
        cam.target.set(0, 1.5, 1);
        break;
      }
      case 'playGauntletCinematic': {
        playGauntletCinematic();
        break;
      }
    }
  });

  // Apply tile texture with bump on load
  const TEX = '/assets/textures';
  await setRoomTexture({
    diffuse:   `${TEX}/tile_texture.png`,
    bump:      `${TEX}/tile_texture.png`,
    bumpLevel: 4.0,
  });

  // Render loop
  engine.runRenderLoop(() => {
    scene.render();
  });

  // Resize — ResizeObserver catches DevTools viewport changes that window.resize misses
  const resizeObserver = new ResizeObserver(() => {
    engine.resize();
  });
  resizeObserver.observe(canvas);
  window.addEventListener('resize', () => {
    engine.resize();
  });

  // Notify RN we're ready
  sendToRN({ type: 'sceneReady', payload: {} });
}

function playGauntletCinematic() {
  const camera = getCamera();

  // Camera is already at lamp close-up (snapped during black screen).
  // Light up lamps one by one (left → center → right)
  setTimeout(() => {
    setEffectGroupEnabled('oil_lamp_left', true);
  }, 400);
  setTimeout(() => {
    setEffectGroupEnabled('oil_lamp_center', true);
  }, 1200);
  setTimeout(() => {
    setEffectGroupEnabled('oil_lamp_right', true);
  }, 2000);

  // After lamps are lit, zoom out to overview + light everything else
  setTimeout(() => {
    applyNormalLighting();
    setAllEffectLightsEnabled(true);

    playPath('gauntlet_return', camera, {
      onComplete: () => {
        sendToRN({ type: 'cinematicComplete', payload: {} });
      },
    });
  }, 3000);
}

main().catch((err) => {
  console.error('Failed to initialize dungeon scene:', err);
  // Show error on screen for mobile debugging (no console access)
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#f44;font-family:monospace;font-size:14px;text-align:center;padding:20px;background:rgba(0,0,0,0.9);border-radius:12px;z-index:9999;max-width:90vw;word-break:break-word;';
  errDiv.textContent = `Scene Error: ${err?.message ?? err}`;
  document.body.appendChild(errDiv);
});
