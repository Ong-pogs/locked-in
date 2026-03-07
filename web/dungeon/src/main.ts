import { Engine } from '@babylonjs/core/Engines/engine';
import { createScene } from './scene/createScene';
import { onBridgeMessage, sendToRN } from './bridge';
import { transitionTo, logCameraPosition, toggleCameraLock, goBack, getCamera } from './camera/cameraController';
import { setFlameState } from './effects/flameParticles';
import { applyPhase } from './scene/environment';
import { setRoomTexture, modelStats, setGizmoMode, onModelSelect, setModelTransform, getSelectedModel } from './objects/loadModels';
import { toggleSunMode, isSunMode, toggleOrb, cycleOrbColor, getOrbColorName, setLightMultiplier, getLightMultiplier, applyGauntletLighting, applyNormalLighting } from './scene/lighting';
import { setEffectGroupEnabled, setAllEffectLightsEnabled } from './effects/candleFlames';
import { playPath } from './camera/cameraPaths';
import type { Viewpoint } from './camera/viewpoints';
import type { FlameState } from './effects/flameStates';
import type { RoomPhase } from './scene/environment';
import type { GizmoMode } from './objects/loadModels';

// Detect mobile — WebView on phone or small touchscreen
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 0 && window.innerWidth < 768);

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

  // ── Dev Panel ──
  setupDevPanel(scene);

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

function setupDevPanel(scene: import('@babylonjs/core/scene').Scene) {
  const panel = document.getElementById('devPanel');
  const toggle = document.getElementById('devToggle');
  if (!panel || !toggle) return;

  // Toggle panel visibility
  toggle.addEventListener('click', () => {
    panel.classList.toggle('visible');
    toggle.style.display = panel.classList.contains('visible') ? 'none' : '';
  });

  // --- Lighting ---
  const allLightsBtn = document.getElementById('devAllLights') as HTMLButtonElement;
  const sunBtn = document.getElementById('devSunToggle') as HTMLButtonElement;
  const orbBtn = document.getElementById('devOrbToggle') as HTMLButtonElement;
  const orbColorBtn = document.getElementById('devOrbColor') as HTMLButtonElement;
  const lightSlider = document.getElementById('devLightSlider') as HTMLInputElement;
  const lightVal = document.getElementById('devLightVal');

  // Toggle a group of lights by name prefix
  function toggleLightGroup(prefix: string): boolean {
    const lights = scene.lights.filter(l => l.name.startsWith(prefix));
    const anyOn = lights.some(l => l.isEnabled());
    const next = !anyOn;
    for (const l of lights) l.setEnabled(next);
    return next;
  }

  // All lights toggle
  let allLightsOn = true;
  allLightsBtn.addEventListener('click', () => {
    allLightsOn = !allLightsOn;
    for (const light of scene.lights) light.setEnabled(allLightsOn);
    allLightsBtn.textContent = `All: ${allLightsOn ? 'ON' : 'OFF'}`;
    // Sync button labels
    for (const [id, prefix] of groupBtns) {
      const btn = document.getElementById(id) as HTMLButtonElement;
      if (btn) btn.textContent = `${btn.textContent!.split(':')[0]}: ${allLightsOn ? 'ON' : 'OFF'}`;
    }
  });

  // Per-group light toggles: [buttonId, lightNamePrefix]
  const groupBtns: [string, string][] = [
    ['devCandles', 'candles_set'],
    ['devChandelier', 'chandelier'],
    ['devLamps', 'oil_lamp'],
    ['devPotion', 'fire_potion'],
  ];
  for (const [id, prefix] of groupBtns) {
    const btn = document.getElementById(id) as HTMLButtonElement;
    if (!btn) continue;
    btn.addEventListener('click', () => {
      const on = toggleLightGroup(prefix);
      const label = btn.textContent!.split(':')[0];
      btn.textContent = `${label}: ${on ? 'ON' : 'OFF'}`;
    });
  }

  sunBtn.textContent = `Sun: ${isSunMode() ? 'ON' : 'OFF'}`;
  sunBtn.addEventListener('click', () => {
    const on = toggleSunMode();
    sunBtn.textContent = `Sun: ${on ? 'ON' : 'OFF'}`;
  });

  let orbOn = false;
  orbBtn.addEventListener('click', () => {
    orbOn = toggleOrb();
    orbBtn.textContent = `Orb: ${orbOn ? 'ON' : 'OFF'}`;
  });

  orbColorBtn.textContent = `Color: ${getOrbColorName()}`;
  orbColorBtn.addEventListener('click', () => {
    const name = cycleOrbColor();
    orbColorBtn.textContent = `Color: ${name}`;
  });

  lightSlider.value = String(getLightMultiplier());
  lightSlider.addEventListener('input', () => {
    const v = parseFloat(lightSlider.value);
    setLightMultiplier(v);
    if (lightVal) lightVal.textContent = v.toFixed(1);
  });

  // --- Camera ---
  const camLockBtn = document.getElementById('devCamLock') as HTMLButtonElement;
  const camLogBtn = document.getElementById('devCamLog') as HTMLButtonElement;

  camLockBtn.addEventListener('click', () => {
    const locked = toggleCameraLock();
    camLockBtn.textContent = `Cam: ${locked ? 'LOCKED' : 'FREE'}`;
  });

  camLogBtn.addEventListener('click', () => logCameraPosition());

  // --- Gizmo ---
  const gizmoBtns: Record<GizmoMode, HTMLButtonElement> = {
    position: document.getElementById('devGizmoPos') as HTMLButtonElement,
    rotation: document.getElementById('devGizmoRot') as HTMLButtonElement,
    scale: document.getElementById('devGizmoScale') as HTMLButtonElement,
    none: document.getElementById('devGizmoNone') as HTMLButtonElement,
  };

  function setActiveGizmo(mode: GizmoMode) {
    setGizmoMode(mode);
    for (const [m, btn] of Object.entries(gizmoBtns)) {
      btn.classList.toggle('active', m === mode);
    }
  }

  for (const [mode, btn] of Object.entries(gizmoBtns)) {
    btn.addEventListener('click', () => setActiveGizmo(mode as GizmoMode));
  }

  // --- Transform inputs ---
  const inputs = {
    px: document.getElementById('devPX') as HTMLInputElement,
    py: document.getElementById('devPY') as HTMLInputElement,
    pz: document.getElementById('devPZ') as HTMLInputElement,
    rx: document.getElementById('devRX') as HTMLInputElement,
    ry: document.getElementById('devRY') as HTMLInputElement,
    rz: document.getElementById('devRZ') as HTMLInputElement,
    sx: document.getElementById('devSX') as HTMLInputElement,
    sy: document.getElementById('devSY') as HTMLInputElement,
    sz: document.getElementById('devSZ') as HTMLInputElement,
  };

  // Update inputs when a model is selected
  onModelSelect((name, root) => {
    const p = root.position;
    let r = root.rotation;
    if (root.rotationQuaternion) r = root.rotationQuaternion.toEulerAngles();
    const s = root.scaling;
    inputs.px.value = p.x.toFixed(2);
    inputs.py.value = p.y.toFixed(2);
    inputs.pz.value = p.z.toFixed(2);
    inputs.rx.value = r.x.toFixed(2);
    inputs.ry.value = r.y.toFixed(2);
    inputs.rz.value = r.z.toFixed(2);
    inputs.sx.value = s.x.toFixed(2);
    inputs.sy.value = s.y.toFixed(2);
    inputs.sz.value = s.z.toFixed(2);
  });

  // Apply transform on input change
  const propMap: Record<string, { prop: 'position' | 'rotation' | 'scaling'; axis: 'x' | 'y' | 'z' }> = {
    px: { prop: 'position', axis: 'x' }, py: { prop: 'position', axis: 'y' }, pz: { prop: 'position', axis: 'z' },
    rx: { prop: 'rotation', axis: 'x' }, ry: { prop: 'rotation', axis: 'y' }, rz: { prop: 'rotation', axis: 'z' },
    sx: { prop: 'scaling', axis: 'x' }, sy: { prop: 'scaling', axis: 'y' }, sz: { prop: 'scaling', axis: 'z' },
  };
  for (const [key, input] of Object.entries(inputs)) {
    input.addEventListener('change', () => {
      const mapping = propMap[key];
      if (mapping) setModelTransform(mapping.prop, mapping.axis, parseFloat(input.value));
    });
  }

  // --- Model triangle stats ---
  const triListEl = document.getElementById('devTriList');
  if (triListEl) {
    // Build after a short delay to ensure models are loaded
    setTimeout(() => {
      let totalTris = 0;
      let totalVerts = 0;
      let html = '';
      const sorted = [...modelStats.entries()].sort((a, b) => b[1].tris - a[1].tris);
      for (const [name, stats] of sorted) {
        totalTris += stats.tris;
        totalVerts += stats.verts;
        html += `<b>${name}</b>: <span>${stats.tris.toLocaleString()}</span> tris, ${stats.verts.toLocaleString()} verts<br>`;
      }
      html = `<b style="color:#ff0;">TOTAL: ${totalTris.toLocaleString()} tris, ${totalVerts.toLocaleString()} verts</b><br><br>` + html;
      triListEl.innerHTML = html;
    }, 500);
  }
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
