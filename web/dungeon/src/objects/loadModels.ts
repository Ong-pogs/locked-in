import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

const GRID_SIZE = 7;
const FLOOR_DEPTH = 8;
const WALL_HEIGHT = 5;
const TILE_SIZE = 2;

const ROOM_WIDTH = GRID_SIZE * TILE_SIZE;   // 14
const ROOM_DEPTH = FLOOR_DEPTH * TILE_SIZE; // 16
const ROOM_HEIGHT = WALL_HEIGHT * TILE_SIZE; // 10

const TILE_TEXTURE_PATH = '/assets/textures/tile_texture.png';

export interface TextureSet {
  diffuse: string;
  normal?: string;    // pre-made normal map (use as-is)
  bump?: string;      // height/displacement map — converted to normal map at runtime
  specular?: string;
  bumpLevel?: number; // normal map intensity (default 1.5)
}

// Track room materials so we can hot-swap textures
const roomMaterials: { mat: StandardMaterial; uScale: number; vScale: number }[] = [];
let activeScene: Scene;

export async function setRoomTexture(set: TextureSet) {
  // Resolve normal map: use pre-made normal, or generate from height map
  let normalSrc: string | undefined;
  if (set.normal) {
    normalSrc = set.normal;
  } else if (set.bump) {
    normalSrc = await heightToNormalMap(set.bump);
  }

  const level = set.bumpLevel ?? 1.5;

  for (const entry of roomMaterials) {
    // Diffuse
    entry.mat.diffuseTexture?.dispose();
    const diffTex = new Texture(set.diffuse, activeScene);
    diffTex.uScale = entry.uScale;
    diffTex.vScale = entry.vScale;
    entry.mat.diffuseTexture = diffTex;

    // Normal / bump
    entry.mat.bumpTexture?.dispose();
    if (normalSrc) {
      const bumpTex = new Texture(normalSrc, activeScene);
      bumpTex.uScale = entry.uScale;
      bumpTex.vScale = entry.vScale;
      bumpTex.level = level;
      entry.mat.bumpTexture = bumpTex;
    } else {
      entry.mat.bumpTexture = null;
    }

    // Specular
    entry.mat.specularTexture?.dispose();
    if (set.specular) {
      const specTex = new Texture(set.specular, activeScene);
      specTex.uScale = entry.uScale;
      specTex.vScale = entry.vScale;
      entry.mat.specularTexture = specTex;
      entry.mat.specularColor = new Color3(0.4, 0.4, 0.4);
    } else {
      entry.mat.specularTexture = null;
      entry.mat.specularColor = new Color3(0.1, 0.1, 0.1);
    }
  }
}

export async function createDungeonGeometry(scene: Scene) {
  activeScene = scene;
  // Floor
  createFloor(scene);

  // Walls (back, left, right) — normals face inward
  createWall(scene, 'backWall', ROOM_WIDTH, ROOM_HEIGHT,
    new Vector3(0, ROOM_HEIGHT / 2, ROOM_DEPTH / 2),
    0, 4, 3);
  createWall(scene, 'leftWall', ROOM_DEPTH, ROOM_HEIGHT,
    new Vector3(-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0),
    -Math.PI / 2, 5, 3);
  createWall(scene, 'rightWall', ROOM_DEPTH, ROOM_HEIGHT,
    new Vector3(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0),
    Math.PI / 2, 5, 3);

  // Bookshelf + red book (unchanged)
  const bookshelfPos = new Vector3(-5.5, 0, 1);
  createBookshelf(scene, bookshelfPos);
  createSingleBook(scene, bookshelfPos);
}

/* ---------- Room geometry helpers ---------- */

function createFloor(scene: Scene) {
  const floor = MeshBuilder.CreateGround('floor', {
    width: ROOM_WIDTH,
    height: ROOM_DEPTH,
  }, scene);
  floor.material = createTiledMaterial('floorMat', 4, 4, scene);
}

function createWall(
  scene: Scene, name: string, width: number, height: number,
  position: Vector3, rotationY: number,
  uScale: number, vScale: number,
) {
  const wall = MeshBuilder.CreatePlane(name, { width, height }, scene);
  wall.position = position;
  wall.rotation.y = rotationY;
  wall.material = createTiledMaterial(`${name}Mat`, uScale, vScale, scene);
}

function createTiledMaterial(
  name: string, uScale: number, vScale: number, scene: Scene,
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const tex = new Texture(TILE_TEXTURE_PATH, scene);
  tex.uScale = uScale;
  tex.vScale = vScale;
  m.diffuseTexture = tex;
  m.specularColor = new Color3(0.1, 0.1, 0.1);
  m.backFaceCulling = false;
  m.maxSimultaneousLights = 8;
  roomMaterials.push({ mat: m, uScale, vScale });
  return m;
}

/* ---------- Height → Normal map converter ---------- */

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = path;
  });
}

async function heightToNormalMap(imagePath: string, maxRes = 1024, strength = 2): Promise<string> {
  const img = await loadImage(imagePath);

  // Cap resolution so processing stays fast (~200ms at 1024²)
  const scale = Math.min(1, maxRes / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);

  const getHeight = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return (src.data[i] + src.data[i + 1] + src.data[i + 2]) / (3 * 255);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = getHeight((x - 1 + w) % w, y);
      const r = getHeight((x + 1) % w, y);
      const u = getHeight(x, (y - 1 + h) % h);
      const d = getHeight(x, (y + 1) % h);

      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      const nzn = nz / len;

      const i = (y * w + x) * 4;
      dst.data[i]     = (nx * 0.5 + 0.5) * 255;
      dst.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      dst.data[i + 2] = (nzn * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }

  ctx.putImageData(dst, 0, 0);
  return canvas.toDataURL();
}

/* ---------- Bookshelf & Book (unchanged) ---------- */

function mat(name: string, color: Color3, scene: Scene, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  if (alpha < 1) { m.alpha = alpha; }
  return m;
}

function createBookshelf(scene: Scene, pos: Vector3) {
  const parent = new TransformNode('bookshelf_root', scene);
  const wood = mat('shelf_wood', new Color3(0.3, 0.18, 0.08), scene);
  const darkWood = mat('shelf_darkWood', new Color3(0.2, 0.12, 0.05), scene);

  // Back panel
  const back = MeshBuilder.CreateBox('shelf_back', { width: 1.8, height: 3, depth: 0.08 }, scene);
  back.position = new Vector3(0, 1.5, 0.35);
  back.material = darkWood;
  back.parent = parent;

  // Left side
  const left = MeshBuilder.CreateBox('shelf_left', { width: 0.08, height: 3, depth: 0.7 }, scene);
  left.position = new Vector3(-0.86, 1.5, 0);
  left.material = wood;
  left.parent = parent;

  // Right side
  const right = MeshBuilder.CreateBox('shelf_right', { width: 0.08, height: 3, depth: 0.7 }, scene);
  right.position = new Vector3(0.86, 1.5, 0);
  right.material = wood;
  right.parent = parent;

  // 4 shelves (horizontal planks)
  const shelfHeights = [0.05, 0.75, 1.5, 2.25, 3.0];
  shelfHeights.forEach((y, i) => {
    const shelf = MeshBuilder.CreateBox(`shelf_plank_${i}`, { width: 1.8, height: 0.06, depth: 0.7 }, scene);
    shelf.position = new Vector3(0, y, 0);
    shelf.material = wood;
    shelf.parent = parent;
  });

  // Some book blocks on shelves (simple colored boxes)
  const bookColors = [
    new Color3(0.55, 0.12, 0.1),
    new Color3(0.12, 0.22, 0.45),
    new Color3(0.15, 0.35, 0.15),
    new Color3(0.5, 0.35, 0.1),
    new Color3(0.35, 0.1, 0.35),
  ];
  const shelfSlots = [0.12, 0.82, 1.57, 2.32]; // Y positions just above each shelf
  let bi = 0;
  for (const sy of shelfSlots) {
    let x = -0.65;
    const count = 3 + (bi % 2);
    for (let b = 0; b < count; b++) {
      const w = 0.12 + (bi % 3) * 0.04;
      const h = 0.45 + (bi % 4) * 0.05;
      const book = MeshBuilder.CreateBox(`shelfbook_${bi}`, { width: w, height: h, depth: 0.25 }, scene);
      book.position = new Vector3(x + w / 2, sy + h / 2, 0.05);
      book.material = mat(`shelfbook_mat_${bi}`, bookColors[bi % bookColors.length], scene);
      book.parent = parent;
      x += w + 0.06;
      bi++;
    }
  }

  parent.position = pos;

  // Tag everything as interactable
  for (const child of parent.getChildMeshes()) {
    child.metadata = { interactable: true, objectId: 'bookshelf' };
  }
}

function createSingleBook(scene: Scene, bookshelfPos: Vector3) {
  const book = MeshBuilder.CreateBox('book_main', {
    width: 0.4, height: 0.9, depth: 0.45,
  }, scene);

  // Placed in front of the bookshelf so it's clearly visible and clickable
  book.position = bookshelfPos.add(new Vector3(0, 0.5, -1.2));
  book.rotation.y = 0.15;
  book.rotation.z = 0.05;
  book.isPickable = true;

  const bookMat = mat('book_mainMat', new Color3(0.6, 0.12, 0.1), scene);
  bookMat.emissiveColor = new Color3(0.2, 0.06, 0.03);
  book.material = bookMat;

  book.metadata = { interactable: true, objectId: 'book' };
}
