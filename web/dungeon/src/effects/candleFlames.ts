import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

let emitterMultiplier = 1.0;

// Track all effect lights and particle systems for toggling
const effectLights: Map<string, PointLight> = new Map();
const effectParticles: Map<string, ParticleSystem> = new Map();

// Disabled groups — lights in these groups start disabled when created
const disabledGroups: Set<string> = new Set();
let allDisabled = false;

/** Enable/disable lights & particles whose name starts with the given prefix. */
export function setEffectGroupEnabled(namePrefix: string, enabled: boolean) {
  if (enabled) {
    disabledGroups.delete(namePrefix);
    enabledOverrides.add(namePrefix);
  } else {
    disabledGroups.add(namePrefix);
    enabledOverrides.delete(namePrefix);
  }
  for (const [name, light] of effectLights) {
    if (name.startsWith(namePrefix)) light.setEnabled(enabled);
  }
  for (const [name, ps] of effectParticles) {
    if (name.startsWith(namePrefix)) {
      if (enabled) ps.start(); else ps.stop();
    }
  }
}

/** Enable/disable ALL effect lights & particles at once. */
export function setAllEffectLightsEnabled(enabled: boolean) {
  allDisabled = !enabled;
  if (enabled) {
    disabledGroups.clear();
    enabledOverrides.clear();
  }
  for (const light of effectLights.values()) light.setEnabled(enabled);
  for (const ps of effectParticles.values()) {
    if (enabled) ps.start(); else ps.stop();
  }
}

// Groups explicitly re-enabled after a global disable
const enabledOverrides: Set<string> = new Set();

/** Check if a light name belongs to a disabled group. */
function isGroupDisabled(lightName: string): boolean {
  // Check explicit overrides first
  for (const prefix of enabledOverrides) {
    if (lightName.startsWith(prefix)) return false;
  }
  if (allDisabled) return true;
  for (const prefix of disabledGroups) {
    if (lightName.startsWith(prefix)) return true;
  }
  return false;
}

/** Get a specific effect light by full name (e.g. "oil_lamp_left_light"). */
export function getEffectLight(name: string): PointLight | undefined {
  return effectLights.get(name);
}

/** Add a flickering warm point light for a candle set. No particles. */
export function addCandleLight(scene: Scene, position: Vector3, name: string) {
  const lightName = `${name}_light`;
  const light = new PointLight(lightName, position.add(new Vector3(0, 0.5, 0)), scene);
  light.diffuse = new Color3(1.0, 0.65, 0.2);
  light.specular = new Color3(1.0, 0.5, 0.1);
  light.intensity = 8.0;
  light.range = 18;
  if (isGroupDisabled(lightName)) light.setEnabled(false);
  effectLights.set(lightName, light);

  let flickerTime = Math.random() * 100;
  scene.onBeforeRenderObservable.add(() => {
    if (!light.isEnabled()) return;
    flickerTime += 0.05 + Math.random() * 0.02;
    const flicker = 7.0 + Math.sin(flickerTime * 3) * 1.0 + Math.sin(flickerTime * 7.3) * 0.5;
    light.intensity = flicker * emitterMultiplier;
  });
}

/** Add a flickering amber point light for the chandelier. No particles. */
export function addChandelierGlow(scene: Scene, position: Vector3, name: string) {
  const lightName = `${name}_light`;
  const light = new PointLight(lightName, position.add(new Vector3(0, -0.3, 0)), scene);
  light.diffuse = new Color3(1.0, 0.6, 0.15);
  light.specular = new Color3(1.0, 0.45, 0.1);
  light.intensity = 18.0;
  light.range = 35;
  if (isGroupDisabled(lightName)) light.setEnabled(false);
  effectLights.set(lightName, light);

  let flickerTime = Math.random() * 100;
  scene.onBeforeRenderObservable.add(() => {
    if (!light.isEnabled()) return;
    flickerTime += 0.03 + Math.random() * 0.01;
    const flicker = 16.0 + Math.sin(flickerTime * 2.5) * 2.0 + Math.sin(flickerTime * 6.1) * 1.0;
    light.intensity = flicker * emitterMultiplier;
  });
}

/** Purple flickering light + flame particles for streak saver lamps. */
export function addSaverLampGlow(scene: Scene, position: Vector3, name: string) {
  const lightPos = position.add(new Vector3(0, 0.7, 0));

  // Purple point light
  const lightName = `${name}_light`;
  const light = new PointLight(lightName, lightPos, scene);
  light.diffuse = new Color3(0.6, 0.15, 0.9);
  light.specular = new Color3(0.5, 0.1, 0.8);
  light.intensity = 6.0;
  light.range = 12;
  if (isGroupDisabled(lightName)) light.setEnabled(false);
  effectLights.set(lightName, light);

  let flickerTime = Math.random() * 100;
  scene.onBeforeRenderObservable.add(() => {
    if (!light.isEnabled()) return;
    flickerTime += 0.06 + Math.random() * 0.03;
    const flicker = 5.0 + Math.sin(flickerTime * 3.5) * 1.5 + Math.sin(flickerTime * 8.1) * 0.6;
    light.intensity = flicker * emitterMultiplier;
  });

  // Purple flame particles
  const particles = new ParticleSystem(`${name}_flame`, 30, scene);
  particles.particleTexture = new Texture(createFlameDataURL(), scene);

  particles.emitter = lightPos;
  particles.minEmitBox = new Vector3(-0.05, 0, -0.05);
  particles.maxEmitBox = new Vector3(0.05, 0, 0.05);

  particles.direction1 = new Vector3(-0.02, 0.15, -0.02);
  particles.direction2 = new Vector3(0.02, 0.3, 0.02);

  particles.gravity = new Vector3(0, 0.05, 0);

  particles.minEmitPower = 0.1;
  particles.maxEmitPower = 0.3;

  particles.emitRate = 12;

  particles.minLifeTime = 0.3;
  particles.maxLifeTime = 0.7;

  particles.minSize = 0.06;
  particles.maxSize = 0.15;

  // Purple-violet flame colors
  particles.color1 = new Color4(0.7, 0.2, 1.0, 0.9);
  particles.color2 = new Color4(0.4, 0.05, 0.8, 0.7);
  particles.colorDead = new Color4(0.2, 0.0, 0.4, 0.0);

  particles.blendMode = ParticleSystem.BLENDMODE_ADD;
  const flameName = `${name}_flame`;
  effectParticles.set(flameName, particles);

  if (isGroupDisabled(flameName) || isGroupDisabled(lightName)) {
    particles.stop();
  } else {
    particles.start();
  }
}

/** Green fire glow for the magic potion — point light + flame particles */
export function addPotionGlow(scene: Scene, position: Vector3, name: string) {
  const lightPos = position.add(new Vector3(0, 0.4, 0));

  // Green point light
  const lightName = `${name}_light`;
  const light = new PointLight(lightName, lightPos, scene);
  light.diffuse = new Color3(0.15, 1.0, 0.3);
  light.specular = new Color3(0.1, 0.8, 0.2);
  light.intensity = 5.0;
  light.range = 8;
  if (isGroupDisabled(lightName)) light.setEnabled(false);
  effectLights.set(lightName, light);

  let flickerTime = Math.random() * 100;
  scene.onBeforeRenderObservable.add(() => {
    if (!light.isEnabled()) return;
    flickerTime += 0.07 + Math.random() * 0.03;
    const flicker = 4.0 + Math.sin(flickerTime * 4.0) * 1.2 + Math.sin(flickerTime * 9.5) * 0.5;
    light.intensity = flicker * emitterMultiplier;
  });

  // Green flame particles rising from the potion
  const particles = new ParticleSystem(`${name}_flame`, 25, scene);
  particles.particleTexture = new Texture(createFlameDataURL(), scene);

  particles.emitter = lightPos;
  particles.minEmitBox = new Vector3(-0.03, 0, -0.03);
  particles.maxEmitBox = new Vector3(0.03, 0, 0.03);

  particles.direction1 = new Vector3(-0.015, 0.12, -0.015);
  particles.direction2 = new Vector3(0.015, 0.25, 0.015);

  particles.gravity = new Vector3(0, 0.03, 0);

  particles.minEmitPower = 0.08;
  particles.maxEmitPower = 0.2;

  particles.emitRate = 10;

  particles.minLifeTime = 0.3;
  particles.maxLifeTime = 0.6;

  particles.minSize = 0.04;
  particles.maxSize = 0.12;

  // Green → dark green → fade
  particles.color1 = new Color4(0.2, 1.0, 0.3, 0.9);
  particles.color2 = new Color4(0.1, 0.7, 0.15, 0.7);
  particles.colorDead = new Color4(0.0, 0.2, 0.0, 0.0);

  particles.blendMode = ParticleSystem.BLENDMODE_ADD;
  const flameName = `${name}_flame`;
  effectParticles.set(flameName, particles);

  if (isGroupDisabled(flameName) || isGroupDisabled(lightName)) {
    particles.stop();
  } else {
    particles.start();
  }
}

/** Canvas-generated 16x16 soft flame texture (white radial gradient). */
function createFlameDataURL(): string {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return canvas.toDataURL();
}

/** Set intensity multiplier for all candle/chandelier lights */
export function setEmitterMultiplier(value: number) {
  emitterMultiplier = value;
}
