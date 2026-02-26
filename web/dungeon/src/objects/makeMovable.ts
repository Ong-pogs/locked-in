import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { PointerDragBehavior } from '@babylonjs/core/Behaviors/Meshes/pointerDragBehavior';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { KeyboardEventTypes } from '@babylonjs/core/Events/keyboardEvents';

/**
 * Makes a mesh draggable on the XZ ground plane + rotatable with keyboard.
 * Logs position & rotation to console on every move so you can copy the values.
 *
 * Controls:
 *   - Drag: move on XZ plane
 *   - Q / E: rotate Y axis (left / right)
 *   - R / F: move up / down (Y axis)
 *   - [ / ]: scale down / up
 *
 * When you like the placement, tell me and I'll lock it in with the logged values.
 */
export function makeMovable(mesh: AbstractMesh, name: string, scene: Scene) {
  // GLB models use rotationQuaternion by default — null it so .rotation (Euler) works
  mesh.rotationQuaternion = null;

  // Drag on ground plane
  const drag = new PointerDragBehavior({ dragPlaneNormal: new Vector3(0, 1, 0) });
  drag.onDragEndObservable.add(() => logTransform(mesh, name));
  mesh.addBehavior(drag);

  // Keyboard controls when this mesh or its children are picked
  let selected = false;

  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === 2 /* POINTERTAP */) {
      const picked = pointerInfo.pickInfo?.pickedMesh;
      if (!picked) { selected = false; return; }
      // Check if picked mesh is this mesh or a child of it
      let target: AbstractMesh | null = picked;
      while (target) {
        if (target === mesh) { selected = true; logTransform(mesh, name); return; }
        target = target.parent as AbstractMesh | null;
      }
      selected = false;
    }
  });

  scene.onKeyboardObservable.add((kbInfo) => {
    if (!selected || kbInfo.type !== KeyboardEventTypes.KEYDOWN) return;

    const key = kbInfo.event.key.toLowerCase();
    switch (key) {
      case 'q': mesh.rotation.y -= 0.1; break;
      case 'e': mesh.rotation.y += 0.1; break;
      case 'r': mesh.position.y += 0.1; break;
      case 'f': mesh.position.y -= 0.1; break;
      case '[': mesh.scaling.scaleInPlace(0.95); break;
      case ']': mesh.scaling.scaleInPlace(1.05); break;
    }
    logTransform(mesh, name);
  });

  console.log(`[movable] "${name}" ready — drag to move, click to select, then Q/E rotate, R/F height, [/] scale`);
  logTransform(mesh, name);
}

function logTransform(mesh: AbstractMesh, name: string) {
  const p = mesh.position;
  const r = mesh.rotation;
  const s = mesh.scaling;
  console.log(
    `[${name}] pos=(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) ` +
    `rot=(${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.z.toFixed(2)}) ` +
    `scale=(${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)})`
  );
}
