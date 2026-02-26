import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/loaders/glTF';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { makeMovable } from './makeMovable';

const TILE_PATH = '/assets/models/dungeon_tiles/';
const TILE_MODEL = 'base_basic_pbr.glb';
const GRID_SIZE = 5;
const FLOOR_DEPTH = 6; // extra row to reach the back wall
const WALL_HEIGHT = 5;
const TILE_SCALE = 1;

export async function createDungeonGeometry(scene: Scene) {
  const result = await SceneLoader.ImportMeshAsync('', TILE_PATH, TILE_MODEL, scene);
  const root = result.meshes[0];

  const wrapper = new TransformNode('tileWrapper', scene);
  root.parent = wrapper;
  wrapper.rotation.x = -Math.PI / 2;
  wrapper.scaling = new Vector3(TILE_SCALE, TILE_SCALE, TILE_SCALE);

  wrapper.computeWorldMatrix(true);
  for (const mesh of result.meshes) {
    mesh.computeWorldMatrix(true);
  }

  const childMeshes = result.meshes.filter(m => m.getTotalVertices() > 0);
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of childMeshes) {
    const bounds = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, bounds.minimumWorld);
    max = Vector3.Maximize(max, bounds.maximumWorld);
  }

  const sizeX = max.x - min.x;
  const sizeZ = max.z - min.z;
  console.log(`Tile size: ${sizeX.toFixed(2)} x ${sizeZ.toFixed(2)}`);

  const tileWidth = sizeX;
  const tileDepth = sizeZ;

  wrapper.setEnabled(false);

  const offsetX = ((GRID_SIZE - 1) * tileWidth) / 2;
  const offsetZ = ((GRID_SIZE - 1) * tileDepth) / 2;

  // --- Floor (extra depth to reach back wall) ---
  const floorOffsetZ = ((FLOOR_DEPTH - 1) * tileDepth) / 2;
  for (let row = 0; row < FLOOR_DEPTH; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const clone = wrapper.clone(`floor_${row}_${col}`, null)!;
      clone.position = new Vector3(col * tileWidth - offsetX, 0, row * tileDepth - floorOffsetZ);
      clone.rotation = new Vector3(-Math.PI / 2, 0, 0);
      clone.setEnabled(true);
    }
  }

  // --- Right wall ---
  for (let row = 0; row < WALL_HEIGHT; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const clone = wrapper.clone(`rightWall_${row}_${col}`, null)!;
      clone.position = new Vector3(offsetX + tileWidth / 2, row * tileDepth, col * tileDepth - offsetZ);
      clone.rotation = new Vector3(0, -Math.PI / 2, 0);
      clone.setEnabled(true);
    }
  }

  // --- Left wall ---
  for (let row = 0; row < WALL_HEIGHT; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const clone = wrapper.clone(`leftWall_${row}_${col}`, null)!;
      clone.position = new Vector3(-offsetX - tileWidth / 2, row * tileDepth, col * tileDepth - offsetZ);
      clone.rotation = new Vector3(0, Math.PI / 2, 0);
      clone.setEnabled(true);
    }
  }

  // --- Back wall ---
  for (let row = 0; row < WALL_HEIGHT; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const clone = wrapper.clone(`backWall_${row}_${col}`, null)!;
      clone.position = new Vector3(col * tileWidth - offsetX, row * tileDepth, offsetZ + tileDepth / 2);
      clone.rotation = new Vector3(0, 0, 0);
      clone.setEnabled(true);
    }
  }

  // --- Bookshelf (against left wall) ---
  const bookshelfResult = await SceneLoader.ImportMeshAsync(
    '', '/assets/models/bookshelf/', 'base_basic_pbr.glb', scene,
  );
  const bookshelf = bookshelfResult.meshes[0];
  bookshelf.position = new Vector3(-4, 0, 0);
  bookshelf.scaling = new Vector3(1, 1, 1);
  bookshelf.metadata = { interactable: true, objectId: 'bookshelf' };
  for (const mesh of bookshelfResult.meshes) {
    if (mesh !== bookshelf) {
      mesh.metadata = { interactable: true, objectId: 'bookshelf' };
    }
  }
  makeMovable(bookshelf, 'bookshelf', scene);
}
