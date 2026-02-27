import { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Debug/debugLayer';
import '@babylonjs/inspector';
import { createScene } from './scene/createScene';
import { onBridgeMessage, sendToRN } from './bridge';
import { transitionTo } from './camera/cameraController';
import { setFlameState } from './effects/flameParticles';
import { applyPhase } from './scene/environment';
import { setRoomTexture } from './objects/loadModels';
import { toggleOrb, cycleOrbColor, getOrbColorName } from './scene/lighting';
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

  // Apply tile texture with bump on load
  const TEX = '/assets/textures';
  await setRoomTexture({
    diffuse:   `${TEX}/tile_texture.png`,
    bump:      `${TEX}/tile_texture.png`,
    bumpLevel: 4.0,
  });

  // Light orb controls
  const COLOR_MAP: Record<string, string> = { amber: '#f59e0b', green: '#22c55e', blue: '#3b82f6' };

  const lightPanel = document.getElementById('lightPanel');
  if (lightPanel) {
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = 'Orb: OFF';
    toggleBtn.style.cssText = `
      background: #1c1c1e; color: #999; border: 1px solid #333;
      border-radius: 6px; padding: 6px 10px; cursor: pointer;
      font-family: monospace; font-size: 12px;
    `;

    const colorBtn = document.createElement('button');
    colorBtn.textContent = getOrbColorName();
    colorBtn.style.cssText = `
      background: ${COLOR_MAP[getOrbColorName()]}33; color: ${COLOR_MAP[getOrbColorName()]};
      border: 1px solid ${COLOR_MAP[getOrbColorName()]}66;
      border-radius: 6px; padding: 6px 10px; cursor: pointer;
      font-family: monospace; font-size: 12px;
    `;

    const hint = document.createElement('span');
    hint.textContent = 'drag orb, shift+drag Y';
    hint.style.cssText = 'color: #555; font-family: monospace; font-size: 10px;';

    toggleBtn.addEventListener('click', () => {
      const on = toggleOrb();
      toggleBtn.textContent = on ? 'Orb: ON' : 'Orb: OFF';
      toggleBtn.style.background = on ? COLOR_MAP[getOrbColorName()] : '#1c1c1e';
      toggleBtn.style.color = on ? '#fff' : '#999';
    });

    colorBtn.addEventListener('click', () => {
      const name = cycleOrbColor();
      const hex = COLOR_MAP[name];
      colorBtn.textContent = name;
      colorBtn.style.background = `${hex}33`;
      colorBtn.style.color = hex;
      colorBtn.style.borderColor = `${hex}66`;
      // Update toggle button color if orb is on
      if (toggleBtn.textContent === 'Orb: ON') {
        toggleBtn.style.background = hex;
      }
    });

    lightPanel.appendChild(toggleBtn);
    lightPanel.appendChild(colorBtn);
    lightPanel.appendChild(hint);
  }

  // Stats overlay
  const statsEl = document.getElementById('statsOverlay');
  let statsTimer = 0;

  // Render loop
  engine.runRenderLoop(() => {
    scene.render();

    // Update stats ~4x per second (not every frame)
    statsTimer++;
    if (statsEl && statsTimer % 15 === 0) {
      const tris = (scene.getActiveIndices() / 3) | 0;
      const meshes = scene.getActiveMeshes().length;
      const verts = scene.getTotalVertices();
      const fps = engine.getFps().toFixed(0);
      const draws = (engine as any)._drawCalls?.count ?? 0;
      statsEl.innerHTML =
        `<b>${fps}</b> FPS` +
        `<br><b>${tris.toLocaleString()}</b> tris` +
        `<br><b>${verts.toLocaleString()}</b> verts` +
        `<br><b>${meshes}</b> meshes` +
        `<br><b>${draws}</b> draw calls`;
    }
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
