import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager';
import '@babylonjs/loaders/glTF';
import { addCandleLight, addChandelierGlow, addSaverLampGlow, addPotionGlow } from '../effects/candleFlames';

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
let gizmoManager: GizmoManager;

// Model roots keyed by name — for gizmo selection
const modelRoots: Map<string, TransformNode> = new Map();

export type GizmoMode = 'position' | 'rotation' | 'scale' | 'none';

/** Per-model triangle/vertex stats, populated during loading */
export const modelStats: Map<string, { tris: number; verts: number }> = new Map();

export function setupGizmos(scene: Scene) {
  gizmoManager = new GizmoManager(scene);
  gizmoManager.positionGizmoEnabled = true;
  gizmoManager.rotationGizmoEnabled = false;
  gizmoManager.scaleGizmoEnabled = false;
  gizmoManager.boundingBoxGizmoEnabled = false;
  gizmoManager.attachableMeshes = null; // allow attaching to any mesh

  // When a gizmo drag ends, log the transform for easy copy-paste
  const logOnDragEnd = () => {
    const node = gizmoManager.gizmos.positionGizmo?.attachedNode
      ?? gizmoManager.gizmos.rotationGizmo?.attachedNode
      ?? gizmoManager.gizmos.scaleGizmo?.attachedNode;
    if (node && node instanceof TransformNode) {
      // Walk up to the model root
      let root: TransformNode = node;
      for (const [name, r] of modelRoots) {
        if (node === r || isDescendantOf(node, r)) {
          root = r;
          break;
        }
      }
      const p = root.position;
      const s = root.scaling;
      let r = root.rotation;
      if (root.rotationQuaternion) {
        r = root.rotationQuaternion.toEulerAngles();
      }
      console.log(
        `[${root.name}] pos: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})` +
        ` rot: (${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.z.toFixed(2)})` +
        ` scale: (${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)})`
      );
    }
  };

  // Attach drag-end logging to each gizmo type
  for (const gizmo of [
    gizmoManager.gizmos.positionGizmo?.xGizmo,
    gizmoManager.gizmos.positionGizmo?.yGizmo,
    gizmoManager.gizmos.positionGizmo?.zGizmo,
  ]) {
    gizmo?.dragBehavior.onDragEndObservable.add(logOnDragEnd);
  }

  // Fire selection callback when gizmo attaches to a mesh
  gizmoManager.onAttachedToMeshObservable.add((mesh) => {
    if (!mesh || !onSelectCb) return;
    let root: TransformNode = mesh;
    let rootName = mesh.name;
    for (const [name, r] of modelRoots) {
      if (mesh === r || isDescendantOf(mesh as unknown as TransformNode, r)) {
        root = r;
        rootName = name;
        break;
      }
    }
    onSelectCb(rootName, root);
  });
}

function isDescendantOf(node: TransformNode, parent: TransformNode): boolean {
  let current = node.parent;
  while (current) {
    if (current === parent) return true;
    current = current.parent;
  }
  return false;
}

/** Callback fired whenever a model is selected via gizmo click */
let onSelectCb: ((name: string, root: TransformNode) => void) | null = null;
export function onModelSelect(cb: (name: string, root: TransformNode) => void) {
  onSelectCb = cb;
}

/** Get the currently selected model root (if any) */
export function getSelectedModel(): TransformNode | null {
  if (!gizmoManager) return null;
  const node = gizmoManager.gizmos.positionGizmo?.attachedNode
    ?? gizmoManager.gizmos.rotationGizmo?.attachedNode
    ?? gizmoManager.gizmos.scaleGizmo?.attachedNode;
  if (!node || !(node instanceof TransformNode)) return null;
  let root: TransformNode = node;
  for (const [, r] of modelRoots) {
    if (node === r || isDescendantOf(node, r)) { root = r; break; }
  }
  return root;
}

/** Apply exact transform values to the currently selected model */
export function setModelTransform(
  prop: 'position' | 'rotation' | 'scaling',
  axis: 'x' | 'y' | 'z',
  value: number,
) {
  if (!gizmoManager) return;
  const node = gizmoManager.gizmos.positionGizmo?.attachedNode
    ?? gizmoManager.gizmos.rotationGizmo?.attachedNode
    ?? gizmoManager.gizmos.scaleGizmo?.attachedNode;
  if (!node || !(node instanceof TransformNode)) return;

  // Walk up to model root
  let root: TransformNode = node;
  for (const [, r] of modelRoots) {
    if (node === r || isDescendantOf(node, r)) { root = r; break; }
  }
  root[prop][axis] = value;
}

export function setGizmoMode(mode: GizmoMode) {
  if (!gizmoManager) return;
  gizmoManager.positionGizmoEnabled = mode === 'position';
  gizmoManager.rotationGizmoEnabled = mode === 'rotation';
  gizmoManager.scaleGizmoEnabled = mode === 'scale';

  // Fix rotation gizmo with non-uniform scaling
  if (gizmoManager.gizmos.rotationGizmo) {
    gizmoManager.gizmos.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
  }

  // Re-attach drag-end logging for newly enabled gizmos
  const logOnDragEnd = () => {
    const node = gizmoManager.gizmos.positionGizmo?.attachedNode
      ?? gizmoManager.gizmos.rotationGizmo?.attachedNode
      ?? gizmoManager.gizmos.scaleGizmo?.attachedNode;
    if (node && node instanceof TransformNode) {
      let root: TransformNode = node;
      for (const [, r] of modelRoots) {
        if (node === r || isDescendantOf(node, r)) { root = r; break; }
      }
      const p = root.position;
      const s = root.scaling;
      // Rotation gizmo sets rotationQuaternion — convert to euler for logging
      let r = root.rotation;
      if (root.rotationQuaternion) {
        r = root.rotationQuaternion.toEulerAngles();
      }
      console.log(
        `[${root.name}] pos: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})` +
        ` rot: (${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.z.toFixed(2)})` +
        ` scale: (${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)})`
      );
    }
  };

  const allGizmos = [
    gizmoManager.gizmos.positionGizmo?.xGizmo,
    gizmoManager.gizmos.positionGizmo?.yGizmo,
    gizmoManager.gizmos.positionGizmo?.zGizmo,
    gizmoManager.gizmos.rotationGizmo?.xGizmo,
    gizmoManager.gizmos.rotationGizmo?.yGizmo,
    gizmoManager.gizmos.rotationGizmo?.zGizmo,
    gizmoManager.gizmos.scaleGizmo?.xGizmo,
    gizmoManager.gizmos.scaleGizmo?.yGizmo,
    gizmoManager.gizmos.scaleGizmo?.zGizmo,
  ];
  for (const g of allGizmos) {
    g?.dragBehavior.onDragEndObservable.add(logOnDragEnd);
  }
}

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

const FLOOR_Y = -2.95;

export async function createDungeonGeometry(scene: Scene) {
  activeScene = scene;
  // Floor + ceiling
  createFloor(scene);
  createCeiling(scene);

  // Walls — normals face inward, aligned to floor
  const wallCenterY = FLOOR_Y + ROOM_HEIGHT / 2;
  // Back wall — flat (no alcove)
  createWall(scene, 'backWall', ROOM_WIDTH, ROOM_HEIGHT,
    new Vector3(0, wallCenterY, ROOM_DEPTH / 2),
    0, ROOM_WIDTH / TILE_SIZE, ROOM_HEIGHT / TILE_SIZE);
  // Right wall
  createWall(scene, 'rightWall', ROOM_DEPTH, ROOM_HEIGHT,
    new Vector3(ROOM_WIDTH / 2, wallCenterY, 0),
    Math.PI / 2, 5, 3);

  const M = '/assets/models/';

  const potionPos = new Vector3(5.50, -1.40, -0.50);
  const chandelierPos = new Vector3(0.00, 5.40, 1.48);

  const candlePositions: { name: string; pos: Vector3; scale?: Vector3; rot?: Vector3 }[] = [
    { name: 'candles_set', pos: new Vector3(3.30, -2.95, 6.58), scale: new Vector3(3.00, 3.00, 3.00) },
    { name: 'candles_set2', pos: new Vector3(5.45, -2.95, 4.45), scale: new Vector3(3.00, 3.00, 3.00), rot: new Vector3(0, 0.75, 0) },
    { name: 'candles_set3', pos: new Vector3(6.59, -2.95, -1.31), scale: new Vector3(3.00, 3.00, 3.00) },
    { name: 'candles_set4', pos: new Vector3(-0.69, 0.53, 7.53), scale: new Vector3(3.00, 3.00, 3.00) },
  ];

  const saverLampPositions: { name: string; pos: Vector3; scale: Vector3; rot: Vector3 }[] = [
    { name: 'oil_lamp_left', pos: new Vector3(1.64, 0.48, 7.06), scale: new Vector3(3.00, 3.00, 3.00), rot: new Vector3(0, 3.14, 0) },
    { name: 'oil_lamp_center', pos: new Vector3(2.07, 0.48, 7.04), scale: new Vector3(3.00, 3.00, 3.00), rot: new Vector3(0, 3.14, 0) },
    { name: 'oil_lamp_right', pos: new Vector3(2.50, 0.48, 6.90), scale: new Vector3(3.00, 3.00, 3.00), rot: new Vector3(0, 3.14, 0) },
  ];

  // ── Load unique models in parallel + batch-instance repeated ones ──
  const [uniqueResults] = await Promise.all([
    // Unique models (each GLB loaded once)
    Promise.all([
      /* 0 */ loadModel(scene, M, 'bookshelf.glb',
        'bookshelf', new Vector3(0.86, -1.20, 7.15), new Vector3(3.20, -1.73, 2.07), new Vector3(0, -2.99, 0)),
      /* 1 */ loadModel(scene, M, 'alchemy_table_-_game_model.glb',
        'alchemy_table', new Vector3(6.22, -3.03, 1.56), new Vector3(0.03, 0.03, 0.03), new Vector3(0, 3.14, 0)),
      /* 2 */ loadModel(scene, M + 'alchemy_yield/', 'base_basic_shaded.glb',
        'alchemy_yield', new Vector3(6.22, -1.50, 1.56), new Vector3(2.00, 2.00, 2.00), new Vector3(0, 1.79, 0)),
      /* 3 */ loadModel(scene, M, 'a_slightly_different_magic_fire_potion.glb',
        'fire_potion', potionPos, new Vector3(0.50, 0.50, 0.50), new Vector3(0, 3.14, 0)),
      /* 4 */ loadModel(scene, M, 'medieval_chandelier3.glb',
        'chandelier', chandelierPos, new Vector3(0.10, 0.10, 0.10), new Vector3(0, 3.14, 0)),
      /* 5 */ loadModel(scene, M, 'old_chest.glb',
        'old_chest', new Vector3(3.19, -1.13, 7.62), new Vector3(3.50, 2.80, 3.00), new Vector3(0, -2.41, 0)),
    ]),
    // Batch-instanced models (GLB loaded once, cloned for each placement)
    loadModelBatch(scene, M, 'candles_set.glb', candlePositions),
    loadModelBatch(scene, M, 'old_gas_lamp.glb', saverLampPositions),
  ]);
  const results = uniqueResults;

  // Post-load setup: alchemy yield glass
  const yieldResult = results[2];
  for (const mesh of yieldResult.meshes) {
    if (!mesh.material) continue;
    const mat = mesh.material as PBRMaterial;
    if (!(mat instanceof PBRMaterial)) continue;
    if (mat.emissiveTexture) mat.albedoTexture = mat.emissiveTexture;
    mat.albedoColor = new Color3(0.7, 0.85, 0.9);
    mat.emissiveColor = new Color3(0.08, 0.1, 0.12);
    mat.alpha = 0.55;
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    mat.metallic = 0.9;
    mat.roughness = 0.05;
    mat.backFaceCulling = false;
  }

  // Add all glow/light effects
  addPotionGlow(scene, potionPos, 'fire_potion');
  addChandelierGlow(scene, chandelierPos, 'chandelier');
  for (const c of candlePositions) addCandleLight(scene, c.pos, c.name);
  for (const lamp of saverLampPositions) addSaverLampGlow(scene, lamp.pos, lamp.name);

  // Gizmo system — click models to select, use UI to switch mode
  setupGizmos(scene);
}

/* ---------- Room geometry helpers ---------- */

function createFloor(scene: Scene) {
  const floor = MeshBuilder.CreateGround('floor', {
    width: ROOM_WIDTH,
    height: ROOM_DEPTH,
  }, scene);
  floor.position.y = FLOOR_Y;
  floor.material = createTiledMaterial('floorMat', 4, 4, scene);
}

function createCeiling(scene: Scene) {
  const ceiling = MeshBuilder.CreateGround('ceiling', {
    width: ROOM_WIDTH,
    height: ROOM_DEPTH,
  }, scene);
  ceiling.position.y = FLOOR_Y + ROOM_HEIGHT;
  ceiling.rotation.x = Math.PI; // flip so visible from below
  ceiling.material = createTiledMaterial('ceilingMat', 4, 4, scene);
}

function createWall(
  scene: Scene, name: string, width: number, height: number,
  position: Vector3, rotationY: number,
  uScale: number, vScale: number,
  parent?: TransformNode,
) {
  const wall = MeshBuilder.CreatePlane(name, { width, height }, scene);
  wall.position = position;
  wall.rotation.y = rotationY;
  wall.material = createTiledMaterial(`${name}Mat`, uScale, vScale, scene);
  if (parent) wall.parent = parent;
  return wall;
}


function createTiledMaterial(
  name: string, uScale: number, vScale: number, scene: Scene,
): StandardMaterial {
  const isMob = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const m = new StandardMaterial(name, scene);
  const tex = new Texture(TILE_TEXTURE_PATH, scene);
  tex.uScale = uScale;
  tex.vScale = vScale;
  m.diffuseTexture = tex;
  m.specularColor = new Color3(0.1, 0.1, 0.1);
  m.backFaceCulling = false;
  m.maxSimultaneousLights = isMob ? 8 : 16;
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
      dst.data[i] = (nx * 0.5 + 0.5) * 255;
      dst.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      dst.data[i + 2] = (nzn * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }

  ctx.putImageData(dst, 0, 0);
  return canvas.toDataURL();
}

/* ---------- GLB Bookshelf loader ---------- */

const AUTO_FIT_HEIGHT = 2.0; // target height in world units for auto-scaled models

/**
 * Load a GLB once, then instantiate it at multiple positions.
 * Saves network requests, parse time, and GPU memory vs loading the same file N times.
 */
async function loadModelBatch(
  scene: Scene, path: string, file: string,
  placements: { name: string; pos: Vector3; scale?: Vector3; rot?: Vector3 }[],
) {
  // Load the asset container (parsed once, not added to scene yet)
  const container = await SceneLoader.LoadAssetContainerAsync(path, file, scene);

  const isMob = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // Fix materials on the master copy
  for (const mesh of container.meshes) {
    if (!mesh.material) continue;
    const mat = mesh.material as any;
    if ('maxSimultaneousLights' in mat) {
      mat.maxSimultaneousLights = isMob ? 12 : 16;
    }
    if (mat instanceof PBRMaterial) {
      if (mat.unlit) { mat.unlit = false; mat.metallic = 0; mat.roughness = 0.9; }
      if (mat.emissiveTexture && !mat.albedoTexture) {
        mat.albedoTexture = mat.emissiveTexture;
        mat.emissiveTexture = null;
        mat.emissiveColor = new Color3(0, 0, 0);
        mat.metallic = 0; mat.roughness = 0.9;
      }
      const eLen = mat.emissiveColor.r + mat.emissiveColor.g + mat.emissiveColor.b;
      const aLen = mat.albedoColor.r + mat.albedoColor.g + mat.albedoColor.b;
      if (eLen > 0.5 && aLen < 0.1 && !mat.albedoTexture) {
        mat.albedoColor = mat.emissiveColor.clone();
        mat.emissiveColor = new Color3(0, 0, 0);
        mat.metallic = 0; mat.roughness = 0.9;
      }
    }
  }

  // Count tris from master (shared across all instances)
  let totalTris = 0;
  let totalVerts = 0;
  for (const mesh of container.meshes) {
    totalTris += (mesh.getTotalIndices() / 3) | 0;
    totalVerts += mesh.getTotalVertices();
  }

  // Instantiate at each placement
  const NON_INTERACTIVE = new Set(['candles_set', 'candles_set2', 'candles_set3', 'candles_set4']);

  for (const p of placements) {
    const entries = container.instantiateModelsToScene(
      (sourceName) => `${p.name}_${sourceName}`,
      false, // don't clone materials — share them
    );

    const root = entries.rootNodes[0] as TransformNode;
    root.name = p.name;
    root.position = p.pos;
    if (p.rot) root.rotation = p.rot;
    if (p.scale) root.scaling = p.scale;

    modelRoots.set(p.name, root);
    modelStats.set(p.name, { tris: totalTris, verts: totalVerts });

    // Tag interactable meshes
    if (!NON_INTERACTIVE.has(p.name)) {
      for (const node of entries.rootNodes) {
        const meshes = (node as TransformNode).getChildMeshes();
        for (const mesh of meshes) {
          if (mesh.getTotalVertices() > 0) {
            mesh.metadata = { interactable: true, objectId: p.name };
          }
        }
      }
    }

    console.log(`[model-batch] ${p.name}: ${totalTris.toLocaleString()} tris (shared from ${file})`);
  }
}

async function loadModel(
  scene: Scene, path: string, file: string,
  name: string, position: Vector3, scaling?: Vector3, rotation?: Vector3,
) {
  const result = await SceneLoader.ImportMeshAsync('', path, file, scene);
  const root = result.meshes[0];
  root.name = name;
  root.position = position;
  if (rotation) root.rotation = rotation;
  modelRoots.set(name, root as unknown as TransformNode);

  // Measure raw bounding box
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of result.meshes) {
    mesh.computeWorldMatrix(true);
    if (mesh.getTotalVertices() > 0) {
      const b = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, b.minimumWorld);
      max = Vector3.Maximize(max, b.maximumWorld);
    }
    // Allow lights to affect models — mobile GPUs can't compile shaders with 16 lights,
    // cap at 8 (Babylon picks the 8 most impactful lights per mesh automatically)
    const isMob = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (mesh.material) {
      const mat = mesh.material as any;
      if ('maxSimultaneousLights' in mat) {
        mat.maxSimultaneousLights = isMob ? 12 : 16;
      }
      // Fix unlit / emissive-only GLB models so they respond to scene lights.
      // Skip for alchemy_yield — its baked emissive texture IS the visual.
      if (mat instanceof PBRMaterial && name !== 'alchemy_yield') {
        if (mat.unlit) {
          mat.unlit = false;
          mat.metallic = 0;
          mat.roughness = 0.9;
        }
        // Emissive texture present but no albedo → move to albedo
        if (mat.emissiveTexture && !mat.albedoTexture) {
          console.log(`[loadModel] ${name}: moving emissiveTexture → albedoTexture`);
          mat.albedoTexture = mat.emissiveTexture;
          mat.emissiveTexture = null;
          mat.emissiveColor = new Color3(0, 0, 0);
          mat.metallic = 0;
          mat.roughness = 0.9;
        }
        // Emissive color bright but albedo black → swap
        const eLen = mat.emissiveColor.r + mat.emissiveColor.g + mat.emissiveColor.b;
        const aLen = mat.albedoColor.r + mat.albedoColor.g + mat.albedoColor.b;
        if (eLen > 0.5 && aLen < 0.1 && !mat.albedoTexture) {
          console.log(`[loadModel] ${name}: moving emissiveColor → albedoColor`);
          mat.albedoColor = mat.emissiveColor.clone();
          mat.emissiveColor = new Color3(0, 0, 0);
          mat.metallic = 0;
          mat.roughness = 0.9;
        }
      }
    }
  }

  const size = max.subtract(min);
  const maxDim = Math.max(size.x, size.y, size.z);

  if (scaling) {
    root.scaling = scaling;
  } else if (maxDim > 0) {
    const s = AUTO_FIT_HEIGHT / maxDim;
    root.scaling = new Vector3(s, s, s);
  }

  // Count triangles and vertices per model
  let totalTris = 0;
  let totalVerts = 0;
  for (const mesh of result.meshes) {
    totalTris += (mesh.getTotalIndices() / 3) | 0;
    totalVerts += mesh.getTotalVertices();
  }

  modelStats.set(name, { tris: totalTris, verts: totalVerts });

  console.log(
    `[model] ${name}: ${totalTris.toLocaleString()} tris, ${totalVerts.toLocaleString()} verts` +
    ` | raw: ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}` +
    ` → scale: (${root.scaling.x.toFixed(2)}, ${root.scaling.y.toFixed(2)}, ${root.scaling.z.toFixed(2)})`
  );

  // Tag meshes as interactable (skip non-interactive objects)
  const NON_INTERACTABLE = ['chandelier', 'candles_set', 'candles_set2', 'candles_set3', 'candles_set4'];
  if (!NON_INTERACTABLE.includes(name)) {
    for (const mesh of result.meshes) {
      if (mesh.getTotalVertices() > 0) {
        mesh.metadata = { interactable: true, objectId: name };
      }
    }
  }

  return result;
}
