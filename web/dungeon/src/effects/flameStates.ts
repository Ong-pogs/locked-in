import { Color4 } from '@babylonjs/core/Maths/math.color';

export type FlameState = 'BURNING' | 'LIT' | 'SPUTTERING' | 'COLD';

export interface FlameConfig {
  emitRate: number;
  minLifeTime: number;
  maxLifeTime: number;
  minSize: number;
  maxSize: number;
  color1: Color4;
  color2: Color4;
  colorDead: Color4;
  lightIntensity: number;
}

export const FLAME_CONFIGS: Record<FlameState, FlameConfig> = {
  BURNING: {
    emitRate: 200,
    minLifeTime: 0.3,
    maxLifeTime: 0.8,
    minSize: 0.15,
    maxSize: 0.5,
    color1: new Color4(1.0, 0.6, 0.1, 1.0),
    color2: new Color4(1.0, 0.3, 0.0, 0.8),
    colorDead: new Color4(0.3, 0.05, 0.0, 0.0),
    lightIntensity: 3.0,
  },
  LIT: {
    emitRate: 100,
    minLifeTime: 0.2,
    maxLifeTime: 0.6,
    minSize: 0.1,
    maxSize: 0.35,
    color1: new Color4(1.0, 0.65, 0.2, 0.9),
    color2: new Color4(0.9, 0.4, 0.1, 0.7),
    colorDead: new Color4(0.2, 0.04, 0.0, 0.0),
    lightIntensity: 1.8,
  },
  SPUTTERING: {
    emitRate: 30,
    minLifeTime: 0.1,
    maxLifeTime: 0.4,
    minSize: 0.05,
    maxSize: 0.2,
    color1: new Color4(0.8, 0.3, 0.1, 0.7),
    color2: new Color4(0.5, 0.15, 0.05, 0.4),
    colorDead: new Color4(0.1, 0.02, 0.0, 0.0),
    lightIntensity: 0.6,
  },
  COLD: {
    emitRate: 0,
    minLifeTime: 0,
    maxLifeTime: 0,
    minSize: 0,
    maxSize: 0,
    color1: new Color4(0.1, 0.05, 0.02, 0.2),
    color2: new Color4(0.05, 0.02, 0.01, 0.1),
    colorDead: new Color4(0, 0, 0, 0),
    lightIntensity: 0.15,
  },
};
