import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export type Viewpoint =
  | 'overview'
  | 'bookshelf'
  | 'fireplace'
  | 'alchemy'
  | 'noticeboard'
  | 'character';

export interface ViewpointDef {
  position: Vector3;
  target: Vector3;
}

/**
 * 6 fixed camera viewpoints for the dungeon room.
 * Positions assume room is roughly 10x10x6 units, centered at origin.
 */
export const VIEWPOINTS: Record<Viewpoint, ViewpointDef> = {
  overview: {
    position: new Vector3(0, 5, -8),
    target: new Vector3(0, 1.5, 0),
  },
  bookshelf: {
    position: new Vector3(-4, 3, -3),
    target: new Vector3(-5, 2, 2),
  },
  fireplace: {
    position: new Vector3(0, 2.5, -4),
    target: new Vector3(0, 1.5, 3),
  },
  alchemy: {
    position: new Vector3(4, 3, -3),
    target: new Vector3(5, 1.5, 1),
  },
  noticeboard: {
    position: new Vector3(-2, 3, -2),
    target: new Vector3(-3, 2.5, 4),
  },
  character: {
    position: new Vector3(1, 2.5, -3),
    target: new Vector3(1.5, 1.5, 2),
  },
};

/** Ordered array for swipe cycling. */
export const VIEWPOINT_ORDER: Viewpoint[] = [
  'overview',
  'bookshelf',
  'fireplace',
  'alchemy',
  'noticeboard',
  'character',
];
