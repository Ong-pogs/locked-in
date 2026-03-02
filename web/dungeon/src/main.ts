import { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Debug/debugLayer';
import '@babylonjs/inspector';
import { createScene } from './scene/createScene';
import { onBridgeMessage, sendToRN } from './bridge';
import { transitionTo } from './camera/cameraController';
import { setFlameState } from './effects/flameParticles';
import { setEmitterMultiplier } from './effects/candleFlames';
import { applyPhase } from './scene/environment';
import { setRoomTexture, setGizmoMode, onModelSelect, setModelTransform, getSelectedModel, type GizmoMode } from './objects/loadModels';
import { toggleOrb, cycleOrbColor, getOrbColorName, toggleSunMode, setLightMultiplier } from './scene/lighting';
import { logCameraPosition, toggleCameraLock, nextViewpoint, prevViewpoint, goBack, getCamera } from './camera/cameraController';
import { startRecording, addKeyframe, saveRecording, clearRecording, getRecordingState, playPath, hasPath } from './camera/cameraPaths';
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

  const lightPanel = document.getElementById('lightPanelBody');
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

    const sunBtn = document.createElement('button');
    sunBtn.textContent = 'Sun: ON';
    sunBtn.style.cssText = `
      background: #f59e0b; color: #fff; border: 1px solid #333;
      border-radius: 6px; padding: 6px 10px; cursor: pointer;
      font-family: monospace; font-size: 12px;
    `;
    sunBtn.addEventListener('click', () => {
      const isSun = toggleSunMode();
      sunBtn.textContent = isSun ? 'Sun: ON' : 'Sun: OFF';
      sunBtn.style.background = isSun ? '#f59e0b' : '#1c1c1e';
      sunBtn.style.color = isSun ? '#fff' : '#999';
    });

    // Light intensity slider
    const sliderRow = document.createElement('div');
    sliderRow.style.cssText = 'display: flex; align-items: center; gap: 6px;';
    const sliderLabel = document.createElement('span');
    sliderLabel.textContent = 'Intensity: 1.0';
    sliderLabel.style.cssText = 'color: #999; font-family: monospace; font-size: 11px; min-width: 90px;';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0.1';
    slider.max = '3.0';
    slider.step = '0.1';
    slider.value = '1.0';
    slider.style.cssText = 'flex: 1; accent-color: #f59e0b; cursor: pointer;';
    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      setLightMultiplier(val);
      sliderLabel.textContent = `Intensity: ${val.toFixed(1)}`;
    });
    sliderRow.appendChild(sliderLabel);
    sliderRow.appendChild(slider);

    // Emitter intensity slider (candles + chandelier)
    const emitterRow = document.createElement('div');
    emitterRow.style.cssText = 'display: flex; align-items: center; gap: 6px;';
    const emitterLabel = document.createElement('span');
    emitterLabel.textContent = 'Emitters: 1.0';
    emitterLabel.style.cssText = 'color: #999; font-family: monospace; font-size: 11px; min-width: 90px;';
    const emitterSlider = document.createElement('input');
    emitterSlider.type = 'range';
    emitterSlider.min = '0';
    emitterSlider.max = '5.0';
    emitterSlider.step = '0.1';
    emitterSlider.value = '1.0';
    emitterSlider.style.cssText = 'flex: 1; accent-color: #f59e0b; cursor: pointer;';
    emitterSlider.addEventListener('input', () => {
      const val = parseFloat(emitterSlider.value);
      setEmitterMultiplier(val);
      emitterLabel.textContent = `Emitters: ${val.toFixed(1)}`;
    });
    emitterRow.appendChild(emitterLabel);
    emitterRow.appendChild(emitterSlider);

    lightPanel.appendChild(sunBtn);
    lightPanel.appendChild(sliderRow);
    lightPanel.appendChild(emitterRow);
    lightPanel.appendChild(toggleBtn);
    lightPanel.appendChild(colorBtn);
    lightPanel.appendChild(hint);
  }

  // Camera controls (dev panel — unlock to orbit freely, lock + log to capture position)
  const cameraPanel = document.getElementById('cameraPanelBody');
  if (cameraPanel) {
    const lockBtn = document.createElement('button');
    lockBtn.textContent = 'Unlock Camera';
    lockBtn.style.cssText = `
      background: #1c1c1e; color: #999; border: 1px solid #333;
      border-radius: 6px; padding: 6px 10px; cursor: pointer;
      font-family: monospace; font-size: 12px;
    `;
    lockBtn.addEventListener('click', () => {
      const locked = toggleCameraLock();
      lockBtn.textContent = locked ? 'Unlock Camera' : 'Lock Camera';
      lockBtn.style.background = locked ? '#1c1c1e' : '#dc2626';
      lockBtn.style.color = locked ? '#999' : '#fff';
    });

    const logBtn = document.createElement('button');
    logBtn.textContent = 'Log Position';
    logBtn.style.cssText = `
      background: #1c1c1e; color: #999; border: 1px solid #333;
      border-radius: 6px; padding: 6px 10px; cursor: pointer;
      font-family: monospace; font-size: 12px;
    `;
    logBtn.addEventListener('click', () => logCameraPosition());

    cameraPanel.appendChild(lockBtn);
    cameraPanel.appendChild(logBtn);
  }

  // Path Recording dev panel
  const pathPanel = document.getElementById('pathPanelBody');
  if (pathPanel) {
    const btnStyle = `
      background: #1c1c1e; color: #999; border: 1px solid #333;
      border-radius: 6px; padding: 6px 10px; cursor: pointer;
      font-family: monospace; font-size: 12px;
    `;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'path name (e.g. bookshelf)';
    nameInput.style.cssText = `
      background: #1a1a1a; color: #ccc; border: 1px solid #333;
      border-radius: 6px; padding: 6px 10px; width: 100%;
      font-family: monospace; font-size: 12px; box-sizing: border-box;
    `;

    const row1 = document.createElement('div');
    row1.style.cssText = 'display: flex; gap: 6px;';

    const startBtn = document.createElement('button');
    startBtn.textContent = 'Start';
    startBtn.style.cssText = btnStyle;

    const addKfBtn = document.createElement('button');
    addKfBtn.textContent = 'Add Keyframe';
    addKfBtn.style.cssText = btnStyle;

    row1.appendChild(startBtn);
    row1.appendChild(addKfBtn);

    const row2 = document.createElement('div');
    row2.style.cssText = 'display: flex; gap: 6px;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save JSON';
    saveBtn.style.cssText = btnStyle;

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = btnStyle;

    const playBtn = document.createElement('button');
    playBtn.textContent = 'Play';
    playBtn.style.cssText = btnStyle;

    row2.appendChild(saveBtn);
    row2.appendChild(clearBtn);
    row2.appendChild(playBtn);

    const status = document.createElement('span');
    status.textContent = 'Status: idle';
    status.style.cssText = 'color: #555; font-family: monospace; font-size: 11px;';

    const updateStatus = () => {
      const state = getRecordingState();
      if (state) {
        status.textContent = `Recording "${state.name}" — ${state.count} keyframes`;
        status.style.color = '#f59e0b';
      } else {
        status.textContent = 'Status: idle';
        status.style.color = '#555';
      }
    };

    startBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) { status.textContent = 'Enter a name first'; status.style.color = '#ef4444'; return; }
      startRecording(name);
      updateStatus();
    });

    addKfBtn.addEventListener('click', () => {
      addKeyframe(getCamera());
      updateStatus();
    });

    saveBtn.addEventListener('click', () => {
      const result = saveRecording();
      if (result) {
        status.textContent = `Saved "${result.name}" — check console`;
        status.style.color = '#22c55e';
      }
    });

    clearBtn.addEventListener('click', () => {
      clearRecording();
      updateStatus();
    });

    playBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) { status.textContent = 'Enter a name first'; status.style.color = '#ef4444'; return; }
      if (!hasPath(name)) { status.textContent = `No path "${name}"`; status.style.color = '#ef4444'; return; }
      status.textContent = `Playing "${name}"...`;
      status.style.color = '#3b82f6';
      playPath(name, getCamera(), {
        onComplete: () => { status.textContent = `Played "${name}"`; status.style.color = '#22c55e'; },
      });
    });

    pathPanel.appendChild(nameInput);
    pathPanel.appendChild(row1);
    pathPanel.appendChild(row2);
    pathPanel.appendChild(status);
  }

  // Arrow navigation buttons
  const arrowLeft = document.getElementById('arrowLeft');
  const arrowRight = document.getElementById('arrowRight');
  const backBtn = document.getElementById('backBtn');

  if (arrowLeft) arrowLeft.addEventListener('click', () => prevViewpoint());
  if (arrowRight) arrowRight.addEventListener('click', () => nextViewpoint());
  if (backBtn) backBtn.addEventListener('click', () => goBack());

  // When camera zooms into an object — hide arrows, show back button
  window.addEventListener('camera-zoomed-in', () => {
    arrowLeft?.classList.add('hidden');
    arrowRight?.classList.add('hidden');
    backBtn?.classList.add('visible');
  });

  // When camera returns from zoom — show arrows, hide back button
  window.addEventListener('camera-zoom-back', () => {
    arrowLeft?.classList.remove('hidden');
    arrowRight?.classList.remove('hidden');
    backBtn?.classList.remove('visible');
  });

  // Gizmo mode controls — click a model, then use these to transform it
  const gizmoPanel = document.getElementById('gizmoPanelBody');
  if (gizmoPanel) {
    const MODES: { mode: GizmoMode; label: string; key: string }[] = [
      { mode: 'position', label: 'Move (W)', key: 'w' },
      { mode: 'rotation', label: 'Rotate (E)', key: 'e' },
      { mode: 'scale',    label: 'Scale (R)',  key: 'r' },
      { mode: 'none',     label: 'None (Q)',   key: 'q' },
    ];

    const buttons: HTMLButtonElement[] = [];
    for (const m of MODES) {
      const btn = document.createElement('button');
      btn.textContent = m.label;
      btn.style.cssText = `
        background: ${m.mode === 'position' ? '#7c3aed' : '#1c1c1e'}; color: ${m.mode === 'position' ? '#fff' : '#999'};
        border: 1px solid #333; border-radius: 6px; padding: 6px 10px;
        cursor: pointer; font-family: monospace; font-size: 12px;
      `;
      btn.addEventListener('click', () => {
        setGizmoMode(m.mode);
        buttons.forEach(b => { b.style.background = '#1c1c1e'; b.style.color = '#999'; });
        btn.style.background = '#7c3aed';
        btn.style.color = '#fff';
      });
      buttons.push(btn);
      gizmoPanel.appendChild(btn);
    }

    // Keyboard shortcuts (W/E/R/Q)
    window.addEventListener('keydown', (e) => {
      const idx = MODES.findIndex(m => m.key === e.key.toLowerCase());
      if (idx >= 0) {
        setGizmoMode(MODES[idx].mode);
        buttons.forEach(b => { b.style.background = '#1c1c1e'; b.style.color = '#999'; });
        buttons[idx].style.background = '#7c3aed';
        buttons[idx].style.color = '#fff';
      }
    });
  }

  // Transform input panel — type exact values for position/rotation/scale
  const transformInputs = document.getElementById('transformInputs');
  const selectedNameEl = document.getElementById('selectedName');
  if (transformInputs && selectedNameEl) {
    const PROPS = ['position', 'rotation', 'scaling'] as const;
    const AXES = ['x', 'y', 'z'] as const;
    const COLORS: Record<string, string> = { x: '#ef4444', y: '#22c55e', z: '#3b82f6' };
    const inputs: Record<string, HTMLInputElement> = {};

    for (const prop of PROPS) {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 4px;';

      const label = document.createElement('span');
      label.textContent = prop === 'scaling' ? 'scale' : prop.slice(0, 3);
      label.style.cssText = 'color: #666; font-family: monospace; font-size: 10px; width: 32px;';
      row.appendChild(label);

      for (const axis of AXES) {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.1';
        input.value = '0';
        input.style.cssText = `
          width: 58px; background: #1a1a1a; color: ${COLORS[axis]};
          border: 1px solid #333; border-radius: 4px; padding: 3px 5px;
          font-family: monospace; font-size: 11px; text-align: right;
        `;
        input.addEventListener('input', () => {
          const val = parseFloat(input.value);
          if (!isNaN(val)) setModelTransform(prop, axis, val);
        });
        inputs[`${prop}.${axis}`] = input;
        row.appendChild(input);
      }
      transformInputs.appendChild(row);
    }

    // When a model is selected, populate inputs with its current values
    onModelSelect((name, root) => {
      selectedNameEl.textContent = name;
      for (const prop of PROPS) {
        for (const axis of AXES) {
          inputs[`${prop}.${axis}`].value = root[prop][axis].toFixed(2);
        }
      }
    });

    // Live-update inputs while dragging (~4x/sec, skip if user is typing)
    setInterval(() => {
      const root = getSelectedModel();
      if (!root) return;
      for (const prop of PROPS) {
        for (const axis of AXES) {
          const input = inputs[`${prop}.${axis}`];
          if (document.activeElement !== input) {
            input.value = root[prop][axis].toFixed(2);
          }
        }
      }
    }, 250);
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

  // Resize — ResizeObserver catches DevTools viewport changes that window.resize misses
  const resizeObserver = new ResizeObserver(() => {
    engine.resize();
  });
  resizeObserver.observe(canvas);
  window.addEventListener('resize', () => {
    engine.resize();
  });

  // Inspector toggle — press 'I' to open/close (don't auto-show, it steals viewport on small screens)
  let inspectorOpen = false;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'i' || e.key === 'I') {
      if (inspectorOpen) {
        scene.debugLayer.hide();
      } else {
        scene.debugLayer.show({ embedMode: true });
      }
      inspectorOpen = !inspectorOpen;
    }
  });

  // Notify RN we're ready
  sendToRN({ type: 'sceneReady', payload: {} });
}

main().catch((err) => {
  console.error('Failed to initialize dungeon scene:', err);
});
