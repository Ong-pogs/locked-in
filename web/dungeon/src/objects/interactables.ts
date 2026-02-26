import { Scene } from '@babylonjs/core/scene';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { sendToRN } from '../bridge';

/**
 * Sets up tap detection on interactable meshes.
 * Meshes with `metadata.interactable === true` trigger objectTapped messages.
 */
export function setupInteractables(scene: Scene) {
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type !== PointerEventTypes.POINTERTAP) return;

    const pickResult = pointerInfo.pickInfo;
    if (!pickResult?.hit || !pickResult.pickedMesh) return;

    const mesh = pickResult.pickedMesh;

    // Walk up parent chain to find interactable
    let target: AbstractMesh | null = mesh;
    while (target) {
      if (target.metadata?.interactable) {
        const objectId = target.metadata.objectId as string;
        sendToRN({ type: 'objectTapped', payload: { objectId } });
        flashMesh(target, scene);
        return;
      }
      target = target.parent as AbstractMesh | null;
    }
  });
}

/** Brief emissive flash on tapped object for visual feedback. */
function flashMesh(mesh: AbstractMesh, scene: Scene) {
  const mat = mesh.material;
  if (!(mat instanceof StandardMaterial)) return;

  const originalEmissive = mat.emissiveColor.clone();
  mat.emissiveColor = new Color3(0.4, 0.3, 0.15);

  setTimeout(() => {
    mat.emissiveColor = originalEmissive;
  }, 200);
}
