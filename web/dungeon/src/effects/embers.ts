import { Scene } from '@babylonjs/core/scene';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';

/**
 * Floating ember particles that rise slowly from the fireplace area.
 * Always active (even when flame is COLD — embers from lingering heat).
 */
export function createEmbers(scene: Scene): ParticleSystem {
  const embers = new ParticleSystem('embers', 50, scene);

  embers.particleTexture = new Texture(createEmberDataURL(), scene);

  embers.emitter = new Vector3(0, 1.5, 3.5);

  embers.minEmitBox = new Vector3(-1, 0, -0.5);
  embers.maxEmitBox = new Vector3(1, 0, 0.5);

  // Slow upward drift
  embers.direction1 = new Vector3(-0.2, 0.5, -0.2);
  embers.direction2 = new Vector3(0.2, 1.0, 0.2);

  embers.gravity = new Vector3(0, 0.1, 0);

  embers.minEmitPower = 0.05;
  embers.maxEmitPower = 0.15;

  embers.emitRate = 8;
  embers.minLifeTime = 2;
  embers.maxLifeTime = 5;

  embers.minSize = 0.02;
  embers.maxSize = 0.06;

  embers.color1 = new Color4(1.0, 0.5, 0.1, 0.9);
  embers.color2 = new Color4(1.0, 0.3, 0.0, 0.6);
  embers.colorDead = new Color4(0.3, 0.1, 0.0, 0.0);

  embers.blendMode = ParticleSystem.BLENDMODE_ADD;

  embers.start();

  return embers;
}

function createEmberDataURL(): string {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 180, 50, 1)');
  gradient.addColorStop(0.5, 'rgba(255, 100, 20, 0.6)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return canvas.toDataURL();
}
