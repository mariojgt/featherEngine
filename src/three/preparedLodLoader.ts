import * as THREE from 'three';
import type { GLTFLoaderPlugin, GLTFParser } from 'three-stdlib';
import { registerPreparedLods } from './meshLodCache';
import { PREPARED_GEOMETRY_EXTENSION, GEOMETRY_COOK_VERSION, type PreparedLods } from './prepareGeometry';

/** Register directly with the shared loader so cloned, instanced and exported models all benefit. */
export function preparedLodPlugin(parser: GLTFParser): GLTFLoaderPlugin & { name: string } {
  return {
    name: PREPARED_GEOMETRY_EXTENSION,
    async afterRoot(result) {
      const pending: Promise<void>[] = [], visited = new Set<THREE.BufferGeometry>();
      for (const scene of result.scenes) scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || visited.has(mesh.geometry)) return;
        visited.add(mesh.geometry);
        const ref = parser.associations.get(object) as { meshes?: number; primitives?: number } | undefined;
        if (ref?.meshes === undefined || ref.primitives === undefined) return;
        const extension = parser.json.meshes?.[ref.meshes]?.primitives?.[ref.primitives]?.extensions?.[PREPARED_GEOMETRY_EXTENSION] as PreparedLods | undefined;
        if (!extension || extension.version !== GEOMETRY_COOK_VERSION || !Array.isArray(extension.indices) || extension.indices.length !== 2) return;
        pending.push((async () => {
          try {
            const levels = await Promise.all(extension.indices.map((index) => {
              if (!Number.isInteger(index) || index < 0) throw new Error('Invalid prepared accessor.');
              return parser.loadAccessor(index);
            }));
            registerPreparedLods(mesh.geometry, levels.map((attribute) => {
              if (attribute.itemSize !== 1) throw new Error('Invalid prepared index width.');
              return Uint32Array.from({ length: attribute.count }, (_, i) => attribute.getX(i));
            }), extension.errors);
          } catch (error) { console.warn('Prepared mesh detail could not be loaded; using original geometry.', error); }
        })());
      });
      await Promise.all(pending);
    },
  };
}
