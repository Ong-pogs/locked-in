import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import '@babylonjs/core/Layers/effectLayerSceneComponent';
import { HighlightLayer } from '@babylonjs/core/Layers/highlightLayer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Observer } from '@babylonjs/core/Misc/observable';
import { modelRoots } from '../objects/loadModels';
import { sendToRN } from '../bridge';

let hl: HighlightLayer | null = null;
let sceneRef: Scene | null = null;
let cameraRef: ArcRotateCamera | null = null;
let pulseObserver: Observer<Scene> | null = null;
let highlightedMeshes: Mesh[] = [];

/** Mapping from tour objectId to all objectIds that should be highlighted together. */
const GROUP_MAP: Record<string, string[]> = {
  oil_lamp_center: ['oil_lamp_left', 'oil_lamp_center', 'oil_lamp_right'],
  alchemy_table: ['alchemy_table', 'alchemy_yield'],
};

export function initTourHighlight(scene: Scene, camera: ArcRotateCamera) {
  // Already initialised for this scene — no-op
  if (hl && sceneRef === scene) return;
  // Stale singleton from a previous scene — tear down before re-initialising
  if (hl) disposeTourHighlight();
  sceneRef = scene;
  cameraRef = camera;

  hl = new HighlightLayer('tourHL', scene);
  hl.innerGlow = true;
  hl.outerGlow = true;
  hl.blurHorizontalSize = 0.5;
  hl.blurVerticalSize = 0.5;

  // Pulse animation — gentle oscillation of blur size
  let elapsed = 0;
  pulseObserver = scene.onBeforeRenderObservable.add(() => {
    if (!hl || highlightedMeshes.length === 0) return;
    const dt = scene.getEngine().getDeltaTime() / 1000;
    elapsed += dt;
    const t = Math.sin(elapsed * (2 * Math.PI / 2.4)); // 2.4s period
    hl.blurHorizontalSize = 0.4 + 0.3 * (t * 0.5 + 0.5); // 0.4 – 0.7
    hl.blurVerticalSize = hl.blurHorizontalSize;
  });
}

export function highlightObject(objectId: string) {
  if (!hl || !sceneRef || !cameraRef) return;
  clearHighlight();

  // Resolve which objectIds to highlight
  const ids = GROUP_MAP[objectId] ?? [objectId];

  for (const id of ids) {
    const root = modelRoots.get(id);
    if (!root) continue;
    const meshes = root.getChildMeshes(false);
    for (const mesh of meshes) {
      if (mesh instanceof Mesh && mesh.getTotalVertices() > 0) {
        hl.addMesh(mesh, Color3.White());
        highlightedMeshes.push(mesh);
      }
    }
    // Also try root itself if it's a Mesh
    if (root instanceof Mesh && root.getTotalVertices() > 0) {
      hl.addMesh(root as Mesh, Color3.White());
      highlightedMeshes.push(root as Mesh);
    }
  }

  // Project the primary object's bounding center to screen coordinates
  const primaryRoot = modelRoots.get(objectId);
  if (!primaryRoot) return;

  const center = computeBoundingCenter(primaryRoot.getChildMeshes(false));
  if (!center) return;

  const engine = sceneRef.getEngine();
  const width = engine.getRenderWidth();
  const height = engine.getRenderHeight();

  const viewport = cameraRef.viewport.toGlobal(width, height);
  const screenPos = Vector3.Project(
    center,
    primaryRoot.getWorldMatrix(),
    sceneRef.getTransformMatrix(),
    viewport,
  );

  // Normalise to 0–1
  const x = screenPos.x / width;
  const y = screenPos.y / height;

  sendToRN({
    type: 'tourScreenPos',
    payload: { objectId, x, y },
  });
}

/** Get the HighlightLayer instance for live tuning (test mode). */
export function getHighlightLayer() { return hl; }

export function clearHighlight() {
  if (!hl) return;
  for (const mesh of highlightedMeshes) {
    hl.removeMesh(mesh);
  }
  highlightedMeshes = [];
}

export function disposeTourHighlight() {
  if (pulseObserver && sceneRef) {
    sceneRef.onBeforeRenderObservable.remove(pulseObserver);
  }
  pulseObserver = null;
  if (hl) hl.dispose();
  hl = null;
  sceneRef = null;
  cameraRef = null;
  highlightedMeshes = [];
}

function computeBoundingCenter(meshes: AbstractMesh[]): Vector3 | null {
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  let found = false;

  for (const mesh of meshes) {
    if (mesh.getTotalVertices() === 0) continue;
    mesh.computeWorldMatrix(true);
    const b = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, b.minimumWorld);
    max = Vector3.Maximize(max, b.maximumWorld);
    found = true;
  }

  if (!found) return null;
  return Vector3.Center(min, max);
}
