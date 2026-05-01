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
import { initTourHighlight, highlightObject, clearHighlight, getHighlightLayer } from './tour/tourHighlight';
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

  // Track render-loop state so we can pause when the iframe is offscreen.
  // Babylon's runRenderLoop stacks callbacks on repeated calls; gate it ourselves.
  let renderingActive = false;
  const renderTick = () => scene.render();
  const startRender = () => {
    if (renderingActive) return;
    engine.runRenderLoop(renderTick);
    renderingActive = true;
  };
  const stopRender = () => {
    if (!renderingActive) return;
    engine.stopRenderLoop(renderTick);
    renderingActive = false;
  };

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
      case 'tourInit': {
        initTourHighlight(scene, getCamera());
        break;
      }
      case 'tourHighlight': {
        const { objectId } = msg.payload;
        if (objectId) highlightObject(objectId as string);
        break;
      }
      case 'tourClearHighlight': {
        clearHighlight();
        break;
      }
      case 'visibility': {
        const { visible } = msg.payload;
        if (visible) startRender();
        else stopRender();
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

  // Render loop — start now; the parent may pause us via the 'visibility' bridge message.
  startRender();

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

  // Self-test mode: append ?test-tour to URL to run tour highlight test
  if (window.location.search.includes('test-tour')) {
    console.log('[test] Running tour self-test...');
    const camera = getCamera();
    initTourHighlight(scene, camera);

    const testObjects = ['bookshelf', 'oil_lamp_center', 'old_chest', 'alchemy_table'];
    let idx = 0;

    function showNext() {
      clearHighlight();
      if (idx >= testObjects.length) idx = 0;
      const objectId = testObjects[idx];
      console.log('[test] Highlighting:', objectId);
      highlightObject(objectId);

      // Update label
      const label = document.getElementById('tour-label');
      if (label) label.textContent = `${idx + 1}/4: ${objectId}`;

      idx++;
    }

    // Start first highlight after 1s
    setTimeout(showNext, 1000);

    // Expose on window
    (window as any).tourNext = showNext;
    (window as any).tourClear = () => {
      clearHighlight();
      const label = document.getElementById('tour-label');
      if (label) label.textContent = 'cleared';
    };

    // Slider update helper
    (window as any).tourUpdateHL = (prop: string, value: number) => {
      const layer = getHighlightLayer();
      if (!layer) return;
      switch (prop) {
        case 'blur': layer.blurHorizontalSize = value; layer.blurVerticalSize = value; break;
        case 'innerGlow': layer.innerGlow = value > 0; break;
        case 'outerGlow': layer.outerGlow = value > 0; break;
      }
      const valEl = document.getElementById('val-' + prop);
      if (valEl) valEl.textContent = String(value);
    };

    // Build control panel
    const sliderCSS = `
      input[type=range] { -webkit-appearance:none; width:100%; height:4px; border-radius:2px; background:rgba(255,255,255,0.1); outline:none; }
      input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:7px; background:#D4A04A; cursor:pointer; border:2px solid #1A1000; }
    `;
    const panel = document.createElement('div');
    panel.innerHTML = `
      <style>${sliderCSS}</style>
      <div style="
        position:fixed; top:14px; right:14px; z-index:9999; width:260px;
        background:rgba(14,14,28,0.94); border:1px solid rgba(212,160,74,0.2);
        border-radius:12px; padding:16px; backdrop-filter:blur(12px);
        font-family:-apple-system,sans-serif;
      ">
        <div style="font-family:monospace;font-size:9px;color:rgba(212,160,74,0.5);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">HighlightLayer Tuner</div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;">
          <span id="tour-label" style="font-family:monospace;font-size:11px;color:#D4A04A;flex:1;">loading...</span>
          <button onclick="tourNext()" style="padding:5px 12px;border-radius:5px;border:1px solid #E8B860;background:#D4A04A;font-family:monospace;font-size:10px;font-weight:700;color:#1A1000;cursor:pointer;">Next</button>
          <button onclick="tourClear()" style="padding:5px 12px;border-radius:5px;border:1px solid rgba(212,160,74,0.25);background:rgba(212,160,74,0.08);font-family:monospace;font-size:10px;color:#D4A04A;cursor:pointer;">Clear</button>
        </div>

        <div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:11px;color:rgba(240,230,211,0.6);">Blur Size (glow thickness)</span>
            <span id="val-blur" style="font-family:monospace;font-size:11px;color:#D4A04A;">0.5</span>
          </div>
          <input type="range" min="0.1" max="4" step="0.1" value="0.5" oninput="tourUpdateHL('blur', parseFloat(this.value))" />
        </div>

        <div style="margin-bottom:12px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" checked onchange="tourUpdateHL('innerGlow', this.checked?1:0)" style="accent-color:#D4A04A;" />
            <span style="font-size:11px;color:rgba(240,230,211,0.6);">Inner Glow</span>
          </label>
        </div>

        <div style="margin-bottom:4px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" checked onchange="tourUpdateHL('outerGlow', this.checked?1:0)" style="accent-color:#D4A04A;" />
            <span style="font-size:11px;color:rgba(240,230,211,0.6);">Outer Glow</span>
          </label>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
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
