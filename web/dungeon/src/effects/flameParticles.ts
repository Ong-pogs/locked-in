import { Scene } from '@babylonjs/core/scene';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PointerDragBehavior } from '@babylonjs/core/Behaviors/Meshes/pointerDragBehavior';
import { FLAME_CONFIGS, type FlameState } from './flameStates';
import { setFireLightIntensity, getFireLight } from '../scene/lighting';
import gsap from 'gsap';

let flameSystem: ParticleSystem;

const FIRE_ORIGIN = new Vector3(0, 1.1, 3.8);

export function createFlameParticles(scene: Scene): ParticleSystem {
  // Draggable anchor sphere
  const anchor = MeshBuilder.CreateSphere('flameAnchor', { diameter: 0.5 }, scene);
  anchor.position = FIRE_ORIGIN.clone();
  const anchorMat = new StandardMaterial('anchorMat', scene);
  anchorMat.diffuseColor = new Color3(1, 0.4, 0);
  anchorMat.alpha = 0.3;
  anchor.material = anchorMat;

  // Drag behavior — move on ground plane (XZ), keep Y
  const drag = new PointerDragBehavior({ dragPlaneNormal: new Vector3(0, 1, 0) });
  drag.onDragObservable.add(() => {
    // Move fire light with the flame
    const light = getFireLight();
    if (light) {
      light.position.x = anchor.position.x;
      light.position.z = anchor.position.z;
    }
  });
  anchor.addBehavior(drag);

  flameSystem = new ParticleSystem('flame', 300, scene);

  flameSystem.particleTexture = new Texture(createFlameDataURL(), scene);

  // Attach emitter to the draggable anchor mesh
  flameSystem.emitter = anchor;

  // Emission box
  flameSystem.minEmitBox = new Vector3(-0.3, 0, -0.2);
  flameSystem.maxEmitBox = new Vector3(0.3, 0.1, 0.2);

  // Direction — upward with spread
  flameSystem.direction1 = new Vector3(-0.3, 1.5, -0.3);
  flameSystem.direction2 = new Vector3(0.3, 2.5, 0.3);

  // Gravity (slight pull down to curl the flames)
  flameSystem.gravity = new Vector3(0, -0.5, 0);

  // Power
  flameSystem.minEmitPower = 0.3;
  flameSystem.maxEmitPower = 0.8;

  // Apply default LIT state
  applyFlameConfig('LIT');

  // Blending
  flameSystem.blendMode = ParticleSystem.BLENDMODE_ADD;

  flameSystem.start();

  return flameSystem;
}

export function setFlameState(state: FlameState) {
  applyFlameConfig(state);
}

function applyFlameConfig(state: FlameState) {
  const config = FLAME_CONFIGS[state];
  if (!flameSystem) return;

  flameSystem.emitRate = config.emitRate;
  flameSystem.minLifeTime = config.minLifeTime;
  flameSystem.maxLifeTime = config.maxLifeTime;
  flameSystem.minSize = config.minSize;
  flameSystem.maxSize = config.maxSize;
  flameSystem.color1 = config.color1;
  flameSystem.color2 = config.color2;
  flameSystem.colorDead = config.colorDead;

  // Smoothly transition the fire light
  const currentIntensity = { value: 0 };
  gsap.to(currentIntensity, {
    value: config.lightIntensity,
    duration: 0.8,
    ease: 'power2.out',
    onUpdate: () => setFireLightIntensity(currentIntensity.value),
  });

  if (state === 'COLD') {
    flameSystem.stop();
  } else if (!flameSystem.isStarted()) {
    flameSystem.start();
  }

  // Add flickering for SPUTTERING state
  if (state === 'SPUTTERING') {
    startFlicker();
  }
}

let flickerTween: gsap.core.Tween | null = null;

function startFlicker() {
  if (flickerTween) flickerTween.kill();

  const flickerObj = { intensity: 0.6 };
  flickerTween = gsap.to(flickerObj, {
    intensity: 0.2,
    duration: 0.15,
    repeat: -1,
    yoyo: true,
    ease: 'rough({ strength: 2, points: 10, randomize: true })',
    onUpdate: () => setFireLightIntensity(flickerObj.intensity),
  });
}

/**
 * Generate a simple radial gradient data URL for fire particles.
 * Avoids needing an external texture file.
 */
function createFlameDataURL(): string {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 200, 80, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 120, 20, 0.8)');
  gradient.addColorStop(0.7, 'rgba(200, 50, 0, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return canvas.toDataURL();
}
