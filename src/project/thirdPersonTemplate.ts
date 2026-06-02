import { getPlatform } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { useEditorStore } from '../store/editorStore';
import { inspectModel } from '../three/inspectModel';
import type { AssetItem } from '../types';

/** The Quaternius "Universal Animation Library" pawn that ships with the engine (public/templates). */
const TEMPLATE_URL = 'templates/defaultPawn.glb';
const TEMPLATE_NAME = 'defaultPawn.glb';

/**
 * Build a ready-to-play third-person scene from the bundled rig: imports + splits the model (skeleton,
 * skeletal mesh, 45 animations), adds a ground plane, and spawns a pawn with an Idle/Walk/Jog/Jump
 * Animator Controller, a character controller (mouse-look follow camera, +Z forward), and an editable
 * controller blueprint. Returns the pawn's object id. Requires a project to be open.
 */
export async function createThirdPersonTemplate(): Promise<string | undefined> {
  const editor = useEditorStore.getState();

  // Reuse the template model if it's already imported + split; otherwise fetch + import it once.
  let modelAsset = editor.assets.find((asset) => asset.name === TEMPLATE_NAME && asset.type === 'model');
  const alreadySplit = modelAsset && editor.skeletalMeshes.some((mesh) => mesh.sourceAssetId === modelAsset!.id);

  if (!modelAsset || !alreadySplit) {
    const response = await fetch(TEMPLATE_URL);
    if (!response.ok) throw new Error('Bundled template model not found.');
    const blob = await response.blob();
    const file = new File([blob], TEMPLATE_NAME, { type: 'model/gltf-binary' });
    const platform = await getPlatform();
    const dir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(dir, file);
    const assetId = `asset-${crypto.randomUUID()}`;
    const item: AssetItem = { id: assetId, name: TEMPLATE_NAME, type: 'model', size: file.size, path, url, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    const inspection = await inspectModel(file);
    useEditorStore.getState().registerImportedModel({ assetId, assetName: TEMPLATE_NAME, inspection });
    modelAsset = useEditorStore.getState().assets.find((asset) => asset.id === assetId);
  }
  if (!modelAsset) return undefined;

  const store = useEditorStore.getState();
  // Visual ground whose top sits at y=0 (the character controller's default ground level).
  const groundId = store.createObjectWithProps('cube', {
    name: 'Ground',
    position: [0, -0.1, 0],
    color: '#2A3142',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  store.updateTransform(groundId, 'scale', [24, 0.2, 24]);

  // The pawn: model + auto-built locomotion controller + character controller + editable blueprint.
  const pawnId = store.createCharacterPawn(modelAsset.id, 'Player');
  if (!pawnId) return undefined;

  // Round it out with the full gameplay kit so the template is a real game starter out of the box:
  // ranged pistol (aim/shoot/reload), health + hit reactions + death→ragdoll, interactions, and emotes.
  const kit = useEditorStore.getState().addGameplayKit;
  kit(pawnId, 'ranged');
  kit(pawnId, 'health');
  kit(pawnId, 'interactions');
  kit(pawnId, 'emotes');

  return pawnId;
}
