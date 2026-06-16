import { ChevronRight, Link2, MousePointer2, Palette, Settings2, Unlink } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import { defaultCharacter, defaultLight, defaultVehicle, selectActiveObjects, useEditorStore } from '../store/editorStore';
import { objectToken, useStableActiveObjects } from '../store/stableSelectors';
import { useAssetUrl } from '../three/ModelAsset';
import { DRACO_DECODER_PATH, extendGLTFLoader } from '../three/gltfDecoders';
import { focusWorkspacePanel } from './workspacePanels';
import { SocketPickerModal } from './SocketPickerModal';
import type { AnimationAsset, AnimatorComponent, AnimatorController, AssetItem, CableComponent, CharacterControllerComponent, ClothComponent, JointComponent, JointType, LightComponent, MaterialDefinition, MeshRendererComponent, ParticleEmitterShape, ParticleSystemComponent, PhysicsComponent, SceneObject, SkeletalMeshAsset, TerrainComponent, TransformComponent, Vector3Tuple, VehicleComponent, VehicleWheelSetup, WaterVolumeComponent } from '../types';
import { resolveVehicleWheels } from '../runtime/vehicleWheels';
import { particlePresetIds } from '../runtime/particlePresets';
import { PHYSICS_MATERIAL_PRESETS, applyPhysicsMaterialPreset } from '../runtime/physicsMaterials';
import { WATER_STYLE_PRESETS } from '../three/presets';
import { withTerrainDefaults } from '../terrain/terrain';

const axes = ['X', 'Y', 'Z'] as const;

function InspectorSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const storageKey = `nf.inspector.section.${title}`;
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? defaultOpen : saved === '1';
  });
  const toggle = () => {
    setOpen((v) => {
      localStorage.setItem(storageKey, v ? '0' : '1');
      return !v;
    });
  };
  return (
    <section className={open ? 'inspector-section' : 'inspector-section collapsed'}>
      <h3
        className="inspector-section-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <ChevronRight size={13} className="inspector-section-caret" aria-hidden />
        {title}
      </h3>
      {open && children}
    </section>
  );
}

const toDegrees = (value: number) => Math.round((value * 180) / Math.PI);
const toRadians = (value: number) => (value * Math.PI) / 180;

function NumberInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  precision = 2,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isInteger(value) ? value : Number(value.toFixed(precision))}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function VectorField({
  label,
  value,
  onChange,
  rotation,
  step,
  precision,
}: {
  label: string;
  value: Vector3Tuple;
  onChange: (value: Vector3Tuple) => void;
  rotation?: boolean;
  /** Override the per-axis input step (defaults: 1 for rotation, 0.1 otherwise). */
  step?: number;
  /** Decimal places shown — raise for fine values like scale 0.005. */
  precision?: number;
}) {
  const displayValue = rotation ? (value.map(toDegrees) as Vector3Tuple) : value;

  return (
    <label className="vector-field">
      <span>{label}</span>
      <div>
        {axes.map((axis, index) => (
          <span key={axis} className="axis-input">
            <em>{axis}</em>
            <NumberInput
              value={displayValue[index]}
              step={step ?? (rotation ? 1 : 0.1)}
              precision={precision ?? 2}
              onChange={(nextValue) => {
                const next = [...displayValue] as Vector3Tuple;
                next[index] = nextValue;
                onChange(rotation ? (next.map(toRadians) as Vector3Tuple) : next);
              }}
            />
          </span>
        ))}
      </div>
    </label>
  );
}

export function RangeField({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="range-field">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <strong>{value.toFixed(2)}</strong>
    </label>
  );
}

const physicsLayers = Array.from({ length: 16 }, (_, index) => index);

function LayerMaskField({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const mask = value & 0xffff;
  return (
    <div className="layer-mask-field">
      <span>Collides With</span>
      <div>
        {physicsLayers.map((layer) => {
          const bit = 1 << layer;
          return (
            <label key={layer} title={`Layer ${layer}`}>
              <input
                type="checkbox"
                checked={Boolean(mask & bit)}
                onChange={(event) => onChange(event.target.checked ? mask | bit : mask & ~bit)}
              />
              <em>{layer}</em>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function RendererSection({
  renderer,
  defaultHideInPlay,
  modelAssets,
  imageAssets,
  materials,
  onChange,
  onModelChange,
  onMaterialChange,
  onSlotMaterialChange,
  onEditMaterial,
}: {
  renderer: MeshRendererComponent;
  defaultHideInPlay?: boolean;
  modelAssets: AssetItem[];
  imageAssets: AssetItem[];
  materials: MaterialDefinition[];
  onChange: (patch: Partial<MeshRendererComponent>) => void;
  onModelChange: (assetId?: string) => void;
  onMaterialChange: (materialId?: string) => void;
  onSlotMaterialChange: (slotIndex: number, materialId?: string) => void;
  onEditMaterial: (materialId: string) => void;
}) {
  const usingModel = Boolean(renderer.modelAssetId);
  const usingMaterial = Boolean(renderer.materialId && materials.some((m) => m.id === renderer.materialId));
  // The imported materials for this model, in slot order (created by registerImportedModel). Each slot
  // defaults to its imported material and can be swapped for another here, or edited in the Material panel.
  const modelSlotMaterials = usingModel ? materials.filter((m) => m.sourceAssetId === renderer.modelAssetId) : [];
  const hasSlots = modelSlotMaterials.length > 0;
  const materialControls = (
    <>
      <label className="field-row">
        <span>Color</span>
        <input type="color" value={renderer.color} onChange={(event) => onChange({ color: event.target.value })} />
      </label>
      <RangeField label="Metalness" value={renderer.metalness} onChange={(metalness) => onChange({ metalness })} />
      <RangeField label="Roughness" value={renderer.roughness} onChange={(roughness) => onChange({ roughness })} />
      <RangeField label="Opacity" value={renderer.opacity ?? 1} onChange={(opacity) => onChange({ opacity })} />
    </>
  );

  return (
    <InspectorSection title="Renderer">
      <label className="field-row">
        <span>Hide in Play</span>
        <input
          type="checkbox"
          checked={renderer.hideInPlay ?? Boolean(defaultHideInPlay)}
          onChange={(event) => onChange({ hideInPlay: event.target.checked })}
        />
      </label>
      {defaultHideInPlay && renderer.hideInPlay === undefined && (
        <p className="field-hint">Trigger volumes are hidden during Play by default. Turn this off to debug the sensor visually.</p>
      )}
      <label className="field-row">
        <span>Model</span>
        <select value={renderer.modelAssetId ?? ''} onChange={(event) => onModelChange(event.target.value || undefined)}>
          <option value="">Built-in mesh</option>
          {modelAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>

      {!usingModel && (
        <label className="field-row">
          <span>Mesh</span>
          <select value={renderer.mesh} onChange={(event) => onChange({ mesh: event.target.value as MeshRendererComponent['mesh'] })}>
            <option value="cube">Cube</option>
            <option value="sphere">Sphere</option>
            <option value="capsule">Capsule</option>
            <option value="plane">Plane</option>
          </select>
        </label>
      )}

      {/* An imported model exposes one editable material per slot; each defaults to the material created
          for it on import (edit in the Material panel) and can be swapped for another here. */}
      {hasSlots ? (
        <div className="field-stack">
          <span className="field-label">Model Materials</span>
          {modelSlotMaterials.map((slotDefault, index) => {
            const overrideId = renderer.materialSlots?.[index];
            const effectiveId = overrideId ?? slotDefault.id;
            return (
              <label className="field-row" key={slotDefault.id}>
                <span title={slotDefault.name}>{slotDefault.name}</span>
                <span className="inline-with-button">
                  <select value={overrideId ?? ''} onChange={(event) => onSlotMaterialChange(index, event.target.value || undefined)}>
                    <option value="">Default ({slotDefault.name})</option>
                    {materials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.name}
                      </option>
                    ))}
                  </select>
                  <button className="icon-button compact" title="Edit this material" onClick={() => onEditMaterial(effectiveId)}>
                    <Palette size={13} aria-hidden />
                  </button>
                </span>
              </label>
            );
          })}
          <p className="field-hint">Each material can be edited in the Material panel (assign a base-color/normal map, etc.) or replaced with another material here.</p>
        </div>
      ) : (
        <>
          {/* A reusable material asset, when assigned, drives the whole surface. */}
          <label className="field-row">
            <span>Material</span>
            <select
              value={renderer.materialId ?? ''}
              onChange={(event) => onMaterialChange(event.target.value || undefined)}
            >
              <option value="">None (inline)</option>
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name}
                </option>
              ))}
            </select>
          </label>

          {usingMaterial ? (
        <div className="script-card">
          <div>
            <Palette size={14} aria-hidden />
            <span>{materials.find((m) => m.id === renderer.materialId)?.name}</span>
          </div>
          <p>Shared material asset — edits apply to every object using it.</p>
          <div className="script-actions">
            <button onClick={() => onEditMaterial(renderer.materialId!)}>Edit</button>
            <button onClick={() => onMaterialChange(undefined)}>
              <Unlink size={13} aria-hidden />
              Detach
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Base-color texture — applies to both built-in meshes and imported models. */}
          <label className="field-row">
            <span>Texture</span>
            <select
              value={renderer.textureAssetId ?? ''}
              onChange={(event) => onChange({ textureAssetId: event.target.value || undefined })}
            >
              <option value="">None</option>
              {imageAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>

          {usingModel ? (
            <>
              {/* Imported models keep their baked materials unless the user opts to override them. */}
              <label className="field-row">
                <span>Override material</span>
                <input
                  type="checkbox"
                  checked={renderer.overrideMaterial ?? false}
                  onChange={(event) => onChange({ overrideMaterial: event.target.checked })}
                />
              </label>
              {renderer.overrideMaterial && materialControls}
            </>
          ) : (
            materialControls
          )}
            </>
          )}
        </>
      )}
    </InspectorSection>
  );
}

/** Lists the animation clips baked into a model GLB. Suspends while the GLB loads. */
function ClipOptions({ url }: { url: string }) {
  const { animations } = useGLTF(url, DRACO_DECODER_PATH, true, extendGLTFLoader);
  return (
    <>
      {animations.map((clip) => (
        <option key={clip.name} value={clip.name}>
          {clip.name}
        </option>
      ))}
    </>
  );
}

function AnimatorSection({
  objectId,
  animator,
  modelUrl,
  meshAsset,
  compatibleAnimations,
  controllers,
  liveStateName,
  onToggle,
  onChange,
  onControllerChange,
  onEditController,
}: {
  objectId: string;
  animator: AnimatorComponent | undefined;
  modelUrl?: string;
  /** The Skeletal Mesh asset for the assigned model, if it was split on import. */
  meshAsset?: SkeletalMeshAsset;
  /** Animation assets that share this mesh's skeleton — including ones from other characters. */
  compatibleAnimations: AnimationAsset[];
  /** Animator Controllers compatible with this mesh's skeleton. */
  controllers: AnimatorController[];
  /** Name of the controller's currently-active state during Play (live readout). */
  liveStateName?: string;
  onToggle: () => void;
  onChange: (patch: Partial<AnimatorComponent>) => void;
  onControllerChange: (controllerId?: string) => void;
  onEditController: () => void;
}) {
  const usingController = Boolean(animator?.controllerId && controllers.some((c) => c.id === animator?.controllerId));
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const runtimeAnimators = useEditorStore((state) => state.runtimeAnimators);
  const setRuntimeAnimatorParam = useEditorStore((state) => state.setRuntimeAnimatorParam);
  const activeController = controllers.find((c) => c.id === animator?.controllerId);
  const liveParams = runtimeAnimators[objectId]?.params;
  return (
    <InspectorSection title="Animation">
      {!modelUrl ? (
        <p className="field-hint">Assign an imported model in the Renderer to play its animations.</p>
      ) : (
        <>
          <label className="field-row">
            <span>Enabled</span>
            <input type="checkbox" checked={animator?.enabled ?? false} onChange={onToggle} />
          </label>

          {animator?.enabled && meshAsset && (
            // A controller (state machine) drives the clip automatically. "None" = play one clip manually.
            <label className="field-row">
              <span>Controller</span>
              <select value={animator.controllerId ?? ''} onChange={(event) => onControllerChange(event.target.value || undefined)}>
                <option value="">None (single clip)</option>
                {controllers.map((controller) => (
                  <option key={controller.id} value={controller.id}>
                    {controller.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {animator?.enabled && usingController ? (
            <div className="script-card">
              <div>
                <Link2 size={14} aria-hidden />
                <span>{controllers.find((c) => c.id === animator?.controllerId)?.name}</span>
              </div>
              <p>State machine drives the animation.{liveStateName ? ` Now: ${liveStateName}` : ''}</p>
              {isPlaying && activeController && (
                <div className="anim-live">
                  <span className="inspector-subhead">Live Parameters</span>
                  {activeController.parameters.map((param) => {
                    const value = liveParams?.[param.id] ?? param.defaultValue;
                    const editable = param.source === 'manual';
                    if (param.type === 'trigger') {
                      return (
                        <button key={param.id} className="full-button" onClick={() => setRuntimeAnimatorParam(objectId, param.id, true)}>
                          Fire “{param.name}”
                        </button>
                      );
                    }
                    if (param.type === 'bool') {
                      return (
                        <label className="field-row" key={param.id}>
                          <span>{param.name}{editable ? '' : ' (auto)'}</span>
                          <input type="checkbox" checked={Boolean(value)} disabled={!editable} onChange={(event) => setRuntimeAnimatorParam(objectId, param.id, event.target.checked)} />
                        </label>
                      );
                    }
                    return (
                      <label className="range-field" key={param.id}>
                        <span>{param.name}{editable ? '' : ' (auto)'}</span>
                        <input type="range" min={0} max={10} step={0.1} value={Number(value)} disabled={!editable} onChange={(event) => setRuntimeAnimatorParam(objectId, param.id, Number(event.target.value))} />
                        <strong>{Number(value).toFixed(2)}</strong>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="script-actions">
                <button onClick={onEditController}>Edit</button>
              </div>
            </div>
          ) : animator?.enabled ? (
            <>
              {meshAsset ? (
                // Rigged model: pick from animations compatible with this mesh's skeleton — clips from
                // other characters on the same skeleton appear here too (the reuse story).
                <>
                  <label className="field-row">
                    <span>Animation</span>
                    <select
                      value={animator.animationId ?? ''}
                      onChange={(event) => onChange({ animationId: event.target.value || undefined, clip: undefined })}
                    >
                      <option value="">None (bind pose)</option>
                      {compatibleAnimations.map((anim) => (
                        <option key={anim.id} value={anim.id}>
                          {anim.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="field-hint">
                    {compatibleAnimations.length} clip{compatibleAnimations.length === 1 ? '' : 's'} on “{meshAsset.name}”’s skeleton.
                  </p>
                </>
              ) : (
                // Un-split / legacy model: play a raw clip straight from its GLB.
                <label className="field-row">
                  <span>Clip</span>
                  <select value={animator.clip ?? ''} onChange={(event) => onChange({ clip: event.target.value || undefined })}>
                    <option value="">None (bind pose)</option>
                    <Suspense fallback={null}>
                      <ClipOptions url={modelUrl} />
                    </Suspense>
                  </select>
                </label>
              )}
              <RangeField label="Speed" value={animator.speed} min={0} max={3} step={0.05} onChange={(speed) => onChange({ speed })} />
              <label className="field-row">
                <span>Loop</span>
                <input type="checkbox" checked={animator.loop} onChange={(event) => onChange({ loop: event.target.checked })} />
              </label>
            </>
          ) : null}
        </>
      )}
    </InspectorSection>
  );
}

/** Attach this object to a bone "socket" of a skinned character — its Transform becomes the offset. */
function AttachmentSection({ objectId }: { objectId: string }) {
  // Structurally-stable list (shared hook): this section reads only object identity/name/model/
  // attachment — never per-frame transforms — so it must NOT re-render 60×/s during Play.
  const sceneObjects = useStableActiveObjects();
  const skeletalMeshes = useEditorStore((state) => state.skeletalMeshes);
  const skeletons = useEditorStore((state) => state.skeletons);
  const setAttachment = useEditorStore((state) => state.setAttachment);
  const [picking, setPicking] = useState(false);
  const object = sceneObjects.find((o) => o.id === objectId);
  const attachment = object?.attachment;

  // Candidate targets: other objects that render a skinned (rigged) mesh, so they expose bones.
  const targets = sceneObjects.filter(
    (o) => o.id !== objectId && o.renderer?.modelAssetId && skeletalMeshes.some((m) => m.sourceAssetId === o.renderer!.modelAssetId),
  );
  const targetMesh = attachment ? skeletalMeshes.find((m) => m.sourceAssetId === sceneObjects.find((o) => o.id === attachment.targetObjectId)?.renderer?.modelAssetId) : undefined;
  const targetSkeleton = targetMesh ? skeletons.find((s) => s.id === targetMesh.skeletonId) : undefined;
  const bones = targetSkeleton?.boneNames ?? [];
  const sockets = targetSkeleton?.sockets ?? [];

  return (
    <InspectorSection title="Attachment (bone socket)" defaultOpen={false}>
      {targets.length === 0 && !attachment ? (
        <p className="field-hint">Add a rigged character to the scene to attach this object to one of its bones.</p>
      ) : (
        <>
          <label className="field-row">
            <span>Attach to</span>
            <select
              value={attachment?.targetObjectId ?? ''}
              onChange={(event) => {
                const targetObjectId = event.target.value;
                if (!targetObjectId) return setAttachment(objectId, undefined);
                const mesh = skeletalMeshes.find((m) => m.sourceAssetId === sceneObjects.find((o) => o.id === targetObjectId)?.renderer?.modelAssetId);
                const firstBone = mesh ? skeletons.find((s) => s.id === mesh.skeletonId)?.boneNames[0] : undefined;
                setAttachment(objectId, { targetObjectId, boneName: attachment?.boneName ?? firstBone ?? '' });
              }}
            >
              <option value="">None</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {attachment && (
            <>
              {sockets.length > 0 && (
                <label className="field-row">
                  <span>Socket</span>
                  <select
                    value={attachment.socketName ?? ''}
                    onChange={(event) => setAttachment(objectId, { ...attachment, socketName: event.target.value || undefined })}
                  >
                    <option value="">None (raw bone)</option>
                    {sockets.map((socket) => (
                      <option key={socket.id} value={socket.name}>
                        {socket.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field-row">
                <span>Bone</span>
                <select value={attachment.boneName} onChange={(event) => setAttachment(objectId, { ...attachment, boneName: event.target.value })}>
                  {bones.map((bone) => (
                    <option key={bone} value={bone}>
                      {bone}
                    </option>
                  ))}
                </select>
              </label>
              <button className="full-button" onClick={() => setPicking(true)}>
                Pick on skeleton…
              </button>
              <p className="field-hint">Attach offset — seat the weapon in the hand (overrides the Transform above).</p>
              <VectorField
                label="Offset Pos"
                value={attachment.offsetPosition ?? object!.transform.position}
                onChange={(offsetPosition) => setAttachment(objectId, { ...attachment, offsetPosition })}
              />
              <VectorField
                label="Offset Rot"
                rotation
                value={attachment.offsetRotation ?? object!.transform.rotation}
                onChange={(offsetRotation) => setAttachment(objectId, { ...attachment, offsetRotation })}
              />
              <VectorField
                label="Offset Scale"
                step={0.001}
                precision={4}
                value={attachment.offsetScale ?? object!.transform.scale}
                onChange={(offsetScale) => setAttachment(objectId, { ...attachment, offsetScale })}
              />
            </>
          )}
        </>
      )}
      {picking && attachment && (
        <SocketPickerModal
          targetObjectId={attachment.targetObjectId}
          value={attachment.boneName}
          onPick={(boneName) => {
            setAttachment(objectId, { ...attachment, boneName });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </InspectorSection>
  );
}

/** World-space UI (a widget anchored over this object) + per-instance variables for `self.*` bindings. */
function UISection({ objectId }: { objectId: string }) {
  // Structural subscription: ui/variables edits refresh this section; Play-mode motion doesn't.
  const object = useStableActiveObjects().find((o) => o.id === objectId);
  const uiDocuments = useEditorStore((state) => state.uiDocuments);
  const attachUI = useEditorStore((state) => state.attachUI);
  const detachUI = useEditorStore((state) => state.detachUI);
  const updateUIComponent = useEditorStore((state) => state.updateUIComponent);
  const setActiveUIDocument = useEditorStore((state) => state.setActiveUIDocument);
  const setObjectVariable = useEditorStore((state) => state.setObjectVariable);
  const [newKey, setNewKey] = useState('');
  const [newTag, setNewTag] = useState('');

  const worldDocs = uiDocuments.filter((doc) => doc.surface === 'world');
  const ui = object?.ui;
  const variables = object?.variables ?? {};

  return (
    <InspectorSection title="UI (world widget)">
      {worldDocs.length === 0 ? (
        <p className="field-hint">Create a “world” UI document in the UI panel to anchor a widget (e.g. a health bar) over this object.</p>
      ) : (
        <label className="field-row">
          <span>Widget</span>
          <select
            value={ui?.documentId ?? ''}
            onChange={(event) => (event.target.value ? attachUI(objectId, event.target.value) : detachUI(objectId))}
          >
            <option value="">None</option>
            {worldDocs.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {ui && (
        <>
          <VectorField label="Offset" value={ui.offset} onChange={(offset) => updateUIComponent(objectId, { offset })} />
          <label className="field-row">
            <span>Scale</span>
            <input
              type="number"
              step="0.1"
              value={ui.scale}
              onChange={(event) => updateUIComponent(objectId, { scale: Number(event.target.value) })}
            />
          </label>
          <label className="field-row">
            <span>Billboard</span>
            <input type="checkbox" checked={ui.billboard} onChange={(event) => updateUIComponent(objectId, { billboard: event.target.checked })} />
          </label>
          <label className="field-row" title="Render the UI onto a flat in-world screen (monitor/terminal). Needs the widget's renderer set to WebGL.">
            <span>Diegetic screen</span>
            <input type="checkbox" checked={ui.diegetic ?? false} onChange={(event) => updateUIComponent(objectId, { diegetic: event.target.checked })} />
          </label>
          {ui.diegetic && (
            <label className="field-row">
              <span>Surface W×H</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <input type="number" step="0.1" value={ui.surfaceWidth ?? 1.6} onChange={(event) => updateUIComponent(objectId, { surfaceWidth: Number(event.target.value) })} />
                <input type="number" step="0.1" value={ui.surfaceHeight ?? 0.9} onChange={(event) => updateUIComponent(objectId, { surfaceHeight: Number(event.target.value) })} />
              </span>
            </label>
          )}
          <button
            className="full-button"
            onClick={() => {
              setActiveUIDocument(ui.documentId);
              focusWorkspacePanel('ui');
            }}
          >
            Edit widget
          </button>
        </>
      )}

      <h3 style={{ marginTop: 10 }}>Tags</h3>
      <p className="field-hint">
        Label this object so a <code>Find Actor By Tag</code> node can locate it (stored as the <code>tags</code> instance variable).
      </p>
      {(() => {
        const tagsRaw = typeof variables.tags === 'string' ? variables.tags : '';
        const tagList = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
        const writeTags = (next: string[]) => setObjectVariable(objectId, 'tags', Array.from(new Set(next)).join(','));
        return (
          <>
            {tagList.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {tagList.map((tag) => (
                  <span
                    key={tag}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 6, background: 'rgba(120,140,200,0.18)', fontSize: 12 }}
                  >
                    {tag}
                    <button
                      title={`Remove tag "${tag}"`}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }}
                      onClick={() => writeTags(tagList.filter((t) => t !== tag))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="field-row">
              <input
                placeholder="new tag (e.g. Objective, Enemy)"
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newTag.trim()) {
                    writeTags([...tagList, newTag.trim()]);
                    setNewTag('');
                  }
                }}
              />
              <button
                className="full-button"
                onClick={() => {
                  const tag = newTag.trim();
                  if (tag) {
                    writeTags([...tagList, tag]);
                    setNewTag('');
                  }
                }}
              >
                Add tag
              </button>
            </div>
          </>
        );
      })()}

      <h3 style={{ marginTop: 10 }}>Instance Variables</h3>
      <p className="field-hint">Per-object data read by world UI as <code>self.&lt;key&gt;</code> and by scripts.</p>
      {Object.entries(variables).map(([key, value]) => (
        <label className="field-row" key={key}>
          <span>{key}</span>
          <input
            type={typeof value === 'number' ? 'number' : 'text'}
            value={Array.isArray(value) ? value.join(',') : String(value)}
            onChange={(event) =>
              setObjectVariable(objectId, key, typeof value === 'number' ? Number(event.target.value) : event.target.value)
            }
          />
        </label>
      ))}
      <div className="field-row">
        <input placeholder="new key (e.g. health)" value={newKey} onChange={(event) => setNewKey(event.target.value)} />
        <button
          className="full-button"
          onClick={() => {
            const key = newKey.trim();
            if (key) {
              setObjectVariable(objectId, key, 100);
              setNewKey('');
            }
          }}
        >
          Add
        </button>
      </div>
    </InspectorSection>
  );
}

/** A friendly label for a key/mouse binding code. */
function bindingLabel(code: string): string {
  if (code === 'Mouse0') return 'Left Click';
  if (code === 'Mouse1') return 'Middle Click';
  if (code === 'Mouse2') return 'Right Click';
  return code;
}

/** Click, then press a key OR mouse button to rebind. Stores the code (e.g. "KeyW", "Space", "Mouse0"). */
function KeyBinding({ label, value, onChange }: { label: string; value: string; onChange: (code: string) => void }) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.code !== 'Escape') onChange(event.code);
      setListening(false);
    };
    const onMouse = (event: MouseEvent) => {
      event.preventDefault();
      onChange(`Mouse${event.button}`);
      setListening(false);
    };
    // Defer attaching mouse capture so the click that started listening isn't captured itself.
    const id = window.setTimeout(() => {
      window.addEventListener('keydown', onKey);
      window.addEventListener('mousedown', onMouse);
      window.addEventListener('contextmenu', onMouse);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouse);
      window.removeEventListener('contextmenu', onMouse);
    };
  }, [listening, onChange]);

  return (
    <label className="field-row">
      <span>{label}</span>
      <button type="button" className={listening ? 'key-capture listening' : 'key-capture'} onClick={() => setListening(true)}>
        {listening ? 'Press key / click…' : bindingLabel(value)}
      </button>
    </label>
  );
}

function VehicleSection({
  objectId,
  vehicle,
  onToggle,
  onChange,
}: {
  objectId: string;
  vehicle: VehicleComponent | undefined;
  onToggle: () => void;
  onChange: (patch: Partial<VehicleComponent>) => void;
}) {
  const v = vehicle ? { ...defaultVehicle(), ...vehicle } : undefined;
  // Car customization: swap the body/wheel models + paint without hand-editing each child object.
  const assets = useEditorStore((state) => state.assets);
  const updateRenderer = useEditorStore((state) => state.updateRenderer);
  const modelAssets = useMemo(() => assets.filter((a) => a.type === 'model'), [assets]);
  // Structurally-stable: this section only reads model ids, and subscribing to the raw objects array
  // re-rendered the whole vehicle-tuning panel 60×/s during Play (the array identity changes whenever
  // the car moves — i.e. always). Model swaps/garage edits still bump the structural token.
  const objects = useStableActiveObjects();
  const carObject = objects.find((o) => o.id === objectId);
  const bodyModelId = carObject?.renderer?.modelAssetId ?? '';
  const firstWheelId = v?.wheelObjectIds?.[0];
  const wheelModelId = objects.find((o) => o.id === firstWheelId)?.renderer?.modelAssetId ?? '';
  const swapBody = (assetId: string) => updateRenderer(objectId, { modelAssetId: assetId || undefined });
  const swapWheels = (assetId: string) => {
    for (const wid of v?.wheelObjectIds ?? []) updateRenderer(wid, { modelAssetId: assetId || undefined });
  };
  const paintBody = (color: string) => updateRenderer(objectId, { color, overrideMaterial: true });
  const num = (label: string, key: keyof VehicleComponent, step = 0.1, fallback = 0) => (
    <label className="field-row">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Number(v?.[key] ?? fallback)}
        onChange={(event) => onChange({ [key]: Number(event.target.value) } as Partial<VehicleComponent>)}
      />
    </label>
  );
  return (
    <InspectorSection title="Vehicle Controller">
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={v?.enabled ?? false} onChange={onToggle} />
      </label>
      {v && v.enabled && (
        <>
          <p className="field-hint">W accelerate · S brake/reverse · A/D steer · Space handbrake (drift) · H horn · Mouse look.</p>

          <h4 className="inspector-subhead">Customize (frame · wheels · paint)</h4>
          <label className="field-row">
            <span>Body</span>
            <select value={bodyModelId} onChange={(event) => swapBody(event.target.value)}>
              <option value="">— primitive —</option>
              {modelAssets.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          </label>
          <label className="field-row">
            <span>Wheels</span>
            <select value={wheelModelId} onChange={(event) => swapWheels(event.target.value)} disabled={!v.wheelObjectIds.length}>
              <option value="">— primitive —</option>
              {modelAssets.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          </label>
          <label className="field-row">
            <span>Paint</span>
            <input type="color" value={(carObject?.renderer?.color ?? '#d24b3c')} onChange={(event) => paintBody(event.target.value)} />
          </label>
          <p className="field-hint">Swap the car frame + wheels to any imported model, and pick a paint colour — applies live. (The AI can do this too: "change the car body to the truck".)</p>

          <label className="field-row">
            <span>Physics Model</span>
            <select
              value={v.physicsModel ?? 'arcade'}
              onChange={(event) => onChange({ physicsModel: event.target.value as 'arcade' | 'raycast' })}
            >
              <option value="arcade">Arcade (tire model)</option>
              <option value="raycast">Raycast Sim (real physics)</option>
            </select>
          </label>

          <label className="field-row">
            <span>AI driver</span>
            <input type="checkbox" checked={Boolean(v.aiDriver)} onChange={(event) => onChange({ aiDriver: event.target.checked })} />
          </label>
          {v.aiDriver && (
            <>
              <label className="field-row">
                <span>AI mode</span>
                <select value={v.aiMode ?? 'race'} onChange={(event) => onChange({ aiMode: event.target.value as 'race' | 'wander' })}>
                  <option value="race">Race (lap checkpoints in order)</option>
                  <option value="wander">Wander (ambient traffic)</option>
                </select>
              </label>
              <RangeField label="AI skill" value={v.aiSkill ?? 0.7} onChange={(aiSkill) => onChange({ aiSkill })} />
              <p className="field-hint">
                Self-driving around the scene's "Checkpoint &lt;n&gt;" gates — Race laps them in order (a rival);
                Wander treats them as a road network and roams it at city pace (traffic).
              </p>
            </>
          )}

          {v.physicsModel === 'raycast' ? (
            <>
              <p className="field-hint">
                Real Rapier ray-cast vehicle: per-wheel suspension, weight transfer, tire friction and genuine
                rollovers. The sim builds its own dynamic chassis, so the car needs no Rapier body of its own.
              </p>

              <h4 className="inspector-subhead">Wheel Rig</h4>
              <p className="field-hint">
                Each wheel is referenced WITH its role — axle drives the drivetrain split, brake bias and anti-roll
                pairing; side drives placement; steered turns with input. Order never matters. Legacy cars (ordered
                wheel lists) keep working; any edit here upgrades them to explicit roles.
              </p>
              {(() => {
                const rig = resolveVehicleWheels(v);
                const writeRig = (next: VehicleWheelSetup[]) => onChange({ wheels: next });
                const patchWheel = (index: number, patch: Partial<VehicleWheelSetup>) =>
                  writeRig(rig.map((w, i) => (i === index ? { ...w, ...patch } : w)));
                // Candidates: the car's children + grandchildren (wheels usually sit under steering anchors).
                const childIds = new Set(objects.filter((o) => o.parentId === objectId).map((o) => o.id));
                const candidates = objects.filter(
                  (o) => (childIds.has(o.parentId ?? '') || o.parentId === objectId) && o.id !== objectId && !o.particles,
                );
                const inRig = new Set(rig.map((w) => w.objectId));
                const nameOf = (id: string) => objects.find((o) => o.id === id)?.name ?? '(missing object)';
                return (
                  <>
                    {rig.map((w, index) => (
                      <div className="field-row" key={`${w.objectId}-${index}`}>
                        <span title={nameOf(w.objectId)}>{nameOf(w.objectId).slice(0, 12)}</span>
                        <div className="library-row">
                          <select value={w.axle} onChange={(event) => patchWheel(index, { axle: event.target.value as 'front' | 'rear' })}>
                            <option value="front">Front</option>
                            <option value="rear">Rear</option>
                          </select>
                          <select value={w.side} onChange={(event) => patchWheel(index, { side: event.target.value as 'left' | 'right' })}>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                          </select>
                          <label title="Steered: this wheel turns with steering input">
                            <input type="checkbox" checked={w.steered} onChange={(event) => patchWheel(index, { steered: event.target.checked })} />
                          </label>
                          <button title="Remove wheel" onClick={() => writeRig(rig.filter((_, i) => i !== index))}>✕</button>
                        </div>
                      </div>
                    ))}
                    <label className="field-row">
                      <span>Add wheel</span>
                      <select
                        value=""
                        onChange={(event) => {
                          if (!event.target.value) return;
                          writeRig([...rig, { objectId: event.target.value, axle: 'rear', side: 'left', steered: false }]);
                        }}
                      >
                        <option value="">— pick a child object —</option>
                        {candidates.filter((o) => !inRig.has(o.id)).map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    </label>
                    {rig.length > 0 && (
                      <button
                        className="full-button"
                        title="Set each wheel's axle/side from its position on the car (front = +Z, left = −X); fronts become steered."
                        onClick={() => {
                          writeRig(
                            rig.map((w) => {
                              const wheel = objects.find((o) => o.id === w.objectId);
                              const anchor = wheel?.parentId && wheel.parentId !== objectId ? objects.find((o) => o.id === wheel.parentId) : undefined;
                              const x = (anchor?.transform.position[0] ?? 0) + (wheel?.transform.position[0] ?? 0);
                              const z = (anchor?.transform.position[2] ?? 0) + (wheel?.transform.position[2] ?? 0);
                              const axle = z >= 0 ? ('front' as const) : ('rear' as const);
                              return { objectId: w.objectId, axle, side: x < 0 ? ('left' as const) : ('right' as const), steered: axle === 'front' };
                            }),
                          );
                        }}
                      >
                        Auto-assign roles from positions
                      </button>
                    )}
                  </>
                );
              })()}

              <h4 className="inspector-subhead">Engine &amp; Brakes</h4>
              {num('Engine Force', 'engineForce', 50, 2600)}
              {num('Brake Force', 'brakeForce', 50, 2200)}
              {num('Handbrake Force', 'handbrakeForce', 50, 1400)}
              {num('Engine Braking', 'engineBrakeForce', 50, 600)}
              {num('Brake Bias (front)', 'brakeBias', 0.05, 0.55)}
              <label className="field-row">
                <span>Drivetrain</span>
                <select
                  value={v.drivetrain ?? 'rwd'}
                  onChange={(event) => onChange({ drivetrain: event.target.value as 'fwd' | 'rwd' | 'awd' })}
                >
                  <option value="fwd">Front-wheel drive</option>
                  <option value="rwd">Rear-wheel drive</option>
                  <option value="awd">All-wheel drive</option>
                </select>
              </label>
              {num('Steer Angle', 'steerAngle', 0.02, 0.6)}

              <h4 className="inspector-subhead">Gearbox &amp; Engine</h4>
              <label className="field-row">
                <span>Transmission</span>
                <select
                  value={v.transmission ?? 'auto'}
                  onChange={(event) => onChange({ transmission: event.target.value as 'auto' | 'manual' })}
                >
                  <option value="auto">Automatic</option>
                  <option value="manual">Manual (E/Q · gamepad Y/LB)</option>
                </select>
              </label>
              {num('Final Drive', 'finalDrive', 0.1, 3.6)}
              {num('Idle RPM', 'idleRpm', 50, 900)}
              {num('Redline RPM', 'maxRpm', 100, 7200)}
              {num('Upshift RPM (auto)', 'shiftUpRpm', 100, 6500)}
              {num('Downshift RPM (auto)', 'shiftDownRpm', 100, 2400)}
              {num('Shift Time (s)', 'shiftTime', 0.02, 0.22)}
              <p className="field-hint">
                The engine runs a torque curve through {(v.gearRatios ?? [3.1, 2.05, 1.55, 1.2, 0.97, 0.8]).length} gears — engine
                pitch climbs each gear and drops on the shift. Bind HUD text to the <code>RPM</code> and <code>Gear</code> project
                variables for a tachometer.
              </p>

              <h4 className="inspector-subhead">Aero &amp; Balance</h4>
              {num('Aero Drag', 'aeroDrag', 0.05, 0.35)}
              {num('Downforce', 'downforceSim', 0.1, 1.1)}
              {num('Anti-roll Front', 'antiRollFront', 250, 6000)}
              {num('Anti-roll Rear', 'antiRollRear', 250, 4200)}
              <p className="field-hint">Anti-roll bars flatten cornering. Stiffer REAR = more oversteer (rotates), stiffer FRONT = more understeer (stable).</p>

              <h4 className="inspector-subhead">Assists &amp; Surfaces</h4>
              <label className="field-row">
                <span>ABS</span>
                <input type="checkbox" checked={v.absEnabled ?? true} onChange={(event) => onChange({ absEnabled: event.target.checked })} />
              </label>
              <label className="field-row">
                <span>Traction Control</span>
                <input type="checkbox" checked={v.tcsEnabled ?? true} onChange={(event) => onChange({ tcsEnabled: event.target.checked })} />
              </label>
              <label className="field-row">
                <span>Surface Grip</span>
                <input type="checkbox" checked={v.surfaceGripEnabled ?? true} onChange={(event) => onChange({ surfaceGripEnabled: event.target.checked })} />
              </label>
              {num('Counter-steer Assist', 'counterSteerAssist', 0.05, 0.5)}
              <p className="field-hint">Counter-steer assist feeds automatic opposite lock when the car genuinely slides — drifts stay catchable. 0 = off, 1 = strong.</p>
              <p className="field-hint">
                With Surface Grip on, each wheel reads the <code>surface</code> instance variable of whatever it rolls over
                (tarmac/curb/dirt/grass/gravel/sand/snow/ice) — running wide onto tagged grass costs real grip. Untagged ground = tarmac.
              </p>

              <h4 className="inspector-subhead">Chassis</h4>
              {num('Mass (kg)', 'chassisMass', 25, 1100)}
              {num('Center of Mass Y', 'centerOfMassY', 0.05, -0.4)}
              {num('Linear Damping', 'linearDamping', 0.02, 0.04)}
              {num('Angular Damping', 'angularDamping', 0.05, 0.6)}
              <p className="field-hint">A lower (more negative) Center of Mass Y makes the car far harder to roll; heavier mass = more planted.</p>

              <h4 className="inspector-subhead">Tires &amp; Suspension</h4>
              {num('Wheel Radius', 'wheelRadius', 0.02, 0.4)}
              {num('Friction Slip (grip)', 'wheelFrictionSlip', 0.05, 1.4)}
              {num('Side Friction', 'sideFrictionStiffness', 0.05, 0.9)}
              {num('Load Sensitivity', 'loadSensitivity', 0.05, 0.6)}
              {num('Susp. Rest Length', 'suspensionRestLength', 0.02, 0.35)}
              {num('Susp. Stiffness', 'suspensionStiffnessSim', 1, 24)}
              {num('Compression Damping', 'suspensionCompression', 0.02, 0.82)}
              {num('Relax Damping', 'suspensionRelaxation', 0.02, 0.88)}
              {num('Max Susp. Travel', 'maxSuspensionTravelSim', 0.02, 0.3)}
              {num('Max Susp. Force', 'maxSuspensionForce', 500, 30000)}

              <h4 className="inspector-subhead">Crash Damage</h4>
              <label className="field-row">
                <span>Soft-body dents</span>
                <input type="checkbox" checked={v.deformable ?? false} onChange={(event) => onChange({ deformable: event.target.checked })} />
              </label>
              <p className="field-hint">When on, the car body MESH plastically dents/crumples where it takes hard hits during Play (BeamNG-style).</p>

              <h4 className="inspector-subhead">Garage (body swap)</h4>
              <p className="field-hint">
                The ordered body list for an in-game garage. At runtime a <code>CarBody</code> project variable (0, 1, 2…)
                picks which body model the chassis wears — wire garage UI buttons to bump it (the sim template's G menu
                does exactly this). Any imported model can be a body; the physics chassis re-fits automatically.
              </p>
              {(v.garageBodyIds ?? []).map((assetId, index) => {
                const list = v.garageBodyIds ?? [];
                const move = (dir: -1 | 1) => {
                  const next = [...list];
                  const swapIdx = index + dir;
                  if (swapIdx < 0 || swapIdx >= next.length) return;
                  [next[index], next[swapIdx]] = [next[swapIdx], next[index]];
                  onChange({ garageBodyIds: next });
                };
                return (
                  <div className="field-row" key={`${assetId}-${index}`}>
                    <span>#{index}</span>
                    <div className="library-row">
                      <select
                        value={assetId}
                        onChange={(event) => {
                          const next = [...list];
                          next[index] = event.target.value;
                          onChange({ garageBodyIds: next });
                        }}
                      >
                        {modelAssets.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                        {!modelAssets.some((a) => a.id === assetId) && <option value={assetId}>(missing asset)</option>}
                      </select>
                      <button title="Move up" onClick={() => move(-1)} disabled={index === 0}>↑</button>
                      <button title="Move down" onClick={() => move(1)} disabled={index === list.length - 1}>↓</button>
                      <button title="Remove from garage" onClick={() => onChange({ garageBodyIds: list.filter((_, i) => i !== index) })}>✕</button>
                    </div>
                  </div>
                );
              })}
              <label className="field-row">
                <span>Add body</span>
                <select
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    onChange({ garageBodyIds: [...(v.garageBodyIds ?? []), event.target.value] });
                  }}
                >
                  <option value="">— pick a model asset —</option>
                  {modelAssets.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <h4 className="inspector-subhead">Drivetrain</h4>
              {num('Max Speed', 'maxSpeed', 1, 26)}
              {num('Max Reverse', 'maxReverseSpeed', 1, 9)}
              {num('Acceleration', 'acceleration', 1, 16)}
              {num('Braking', 'braking', 1, 34)}
              {num('Drag', 'drag', 1, 9)}

              <h4 className="inspector-subhead">Steering</h4>
              {num('Steer Angle', 'steerAngle', 0.02, 0.55)}
              {num('Turn Rate', 'turnRate', 0.05, 2)}
              {num('Grip', 'gripFactor', 0.05, 0.9)}
              {num('Handbrake Grip', 'handbrakeGrip', 0.02, 0.28)}
              {num('Weight Transfer', 'weightTransfer', 0.05, 0.42)}
              {num('Traction Control', 'tractionControl', 0.05, 0.35)}
              {num('Downforce', 'downforce', 0.05, 0.18)}

              <h4 className="inspector-subhead">Suspension (feel)</h4>
              {num('Body Roll', 'bodyRoll', 0.01, 0.05)}
              {num('Body Pitch', 'bodyPitch', 0.01, 0.04)}
              {num('Stiffness', 'suspensionStiffness', 0.02, 0.18)}
              {num('Wheel Radius', 'wheelRadius', 0.02, 0.4)}
              <p className="field-hint">
                Weight Transfer lowers grip under hard load; Traction Control trims throttle during wheelspin; Downforce plants fast cars.
                Body Roll = lean into turns; Body Pitch = squat/dive under accel/brake; Stiffness = how fast it settles.
                Wheel Radius sets how fast the wheels spin. Wheels: {v.wheelObjectIds.length} · steered: {v.steeredWheelIds.length} · tire marks: {v.tireMarkIds.length}.
              </p>

              <h4 className="inspector-subhead">Crash Physics</h4>
              <label className="field-row">
                <span>Damage</span>
                <input type="checkbox" checked={v.crashDamageEnabled ?? true} onChange={(event) => onChange({ crashDamageEnabled: event.target.checked })} />
              </label>
              {num('Damage Speed', 'crashDamageThreshold', 0.5, 9)}
              {num('Rollover Speed', 'crashRolloverThreshold', 0.5, 16)}
              {num('Rollover Force', 'crashRolloverStrength', 0.05, 0.42)}
              {num('Visual Crush', 'crashDeformation', 0.05, 0.45)}
              {num('Wheel Break', 'crashWheelBreakThreshold', 0.1, 1.6)}
              <label className="field-row">
                <span>Debris</span>
                <input type="checkbox" checked={v.crashDebris ?? true} onChange={(event) => onChange({ crashDebris: event.target.checked })} />
              </label>
              <p className="field-hint">Hard fixed-object impacts add damage, kick the body with torque, allow real rollovers, bend wheels out of alignment, and can throw small debris.</p>
            </>
          )}

          <h4 className="inspector-subhead">Camera</h4>
          <label className="field-row">
            <span>Follow Camera</span>
            <input type="checkbox" checked={v.cameraFollow} onChange={(event) => onChange({ cameraFollow: event.target.checked })} />
          </label>
          <label className="field-row">
            <span>Mouse Look</span>
            <input type="checkbox" checked={v.mouseLook} onChange={(event) => onChange({ mouseLook: event.target.checked })} />
          </label>
          {num('Camera Pitch', 'cameraPitch', 0.02, 0.24)}
        </>
      )}
    </InspectorSection>
  );
}

function CharacterSection({
  objectId,
  character,
  onToggle,
  onChange,
}: {
  objectId: string;
  character: CharacterControllerComponent | undefined;
  onToggle: () => void;
  onChange: (patch: Partial<CharacterControllerComponent>) => void;
}) {
  const cameraRigTarget = useEditorStore((state) => state.cameraRigTarget);
  const setCameraRigTarget = useEditorStore((state) => state.setCameraRigTarget);
  const rigging = cameraRigTarget === objectId;
  // Backfill defaults so a controller created before newer fields existed renders without crashing.
  const cc = character ? { ...defaultCharacter(), ...character } : undefined;
  const setOffset = (index: number, value: number) => {
    const next = [...(cc?.cameraOffset ?? [0, 2.6, -6])] as [number, number, number];
    next[index] = value;
    onChange({ cameraOffset: next });
  };
  const num = (label: string, key: keyof CharacterControllerComponent, step = 0.1, fallback = 0) => (
    <label className="field-row">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Number(cc?.[key] ?? fallback)}
        onChange={(event) => onChange({ [key]: Number(event.target.value) } as Partial<CharacterControllerComponent>)}
      />
    </label>
  );
  // Player-sound pickers (audio asset ids; the runtime plays each automatically on its event).
  const assets = useEditorStore((state) => state.assets);
  const audioAssets = useMemo(() => assets.filter((asset) => asset.type === 'audio'), [assets]);
  const sound = (label: string, key: keyof CharacterControllerComponent) => (
    <label className="field-row">
      <span>{label}</span>
      <select
        value={(cc?.[key] as string | undefined) ?? ''}
        onChange={(event) => onChange({ [key]: event.target.value || undefined } as Partial<CharacterControllerComponent>)}
      >
        <option value="">None</option>
        {audioAssets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <InspectorSection title="Character Controller">
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={cc?.enabled ?? false} onChange={onToggle} />
      </label>
      {cc && cc.enabled && (
        <>
          <p className="field-hint">WASD move · Shift sprint · C crouch · Space jump · Q roll · Left‑click attack. Feeds the animator automatically.</p>

          <h4 className="inspector-subhead">Movement</h4>
          {num('Move Speed', 'moveSpeed')}
          {num('Sprint ×', 'sprintMultiplier')}
          {num('Crouch ×', 'crouchMultiplier')}
          {num('Turn Speed', 'turnSpeed')}
          {num('Jump', 'jumpStrength')}
          {num('Gravity', 'gravity')}
          {num('Ground Y', 'groundLevel')}

          <h4 className="inspector-subhead">Feel</h4>
          {num('Acceleration', 'acceleration', 1, 60)}
          {num('Deceleration', 'deceleration', 1, 70)}
          {num('Air Control', 'airControl', 0.05, 0.35)}
          {num('Fall Multiplier', 'fallMultiplier', 0.1, 1.9)}
          {num('Jump Cut', 'jumpCutMultiplier', 0.05, 0.45)}
          {num('Coyote Time', 'coyoteTime', 0.02, 0.12)}
          {num('Jump Buffer', 'jumpBufferTime', 0.02, 0.15)}
          {num('Landing Recovery', 'landingRecovery', 0.05, 0.4)}
          {num('Apex Hang', 'apexHang', 0.05, 0.65)}
          {num('Sprint Turn ×', 'sprintTurnFactor', 0.05, 0.55)}
          <p className="field-hint">
            Higher Accel/Decel = snappier starts &amp; stops. Fall Multiplier &gt;1 makes the jump less floaty; Jump Cut
            shortens a tapped jump; Coyote Time lets you jump just after leaving a ledge; Jump Buffer remembers a
            press made just before landing. Landing Recovery (0–1) saps speed + dips the camera after hard
            landings; Apex Hang &lt;1 floats the jump peak; Sprint Turn ×&lt;1 makes fast runs carve wider arcs.
          </p>

          <label className="field-row">
            <span>Flip Facing 180°</span>
            <input
              type="checkbox"
              checked={Math.abs(cc.modelYawOffset) > 0.01}
              onChange={(event) => onChange({ modelYawOffset: event.target.checked ? Math.PI : 0 })}
            />
          </label>

          <h4 className="inspector-subhead">Traversal</h4>
          <label className="field-row">
            <span>Turn In Place</span>
            <input
              type="checkbox"
              checked={Boolean(cc.turnInPlace)}
              onChange={(event) => onChange({ turnInPlace: event.target.checked })}
            />
          </label>
          {cc.turnInPlace && (
            <>
              {num('Turn Threshold', 'turnInPlaceThreshold', 0.05, 0.45)}
              {num('Turn In Place Speed', 'turnInPlaceSpeed', 0.5, cc.turnSpeed)}
            </>
          )}
          <label className="field-row">
            <span>Mantle / Vault</span>
            <input
              type="checkbox"
              checked={Boolean(cc.mantleEnabled)}
              onChange={(event) => onChange({ mantleEnabled: event.target.checked })}
            />
          </label>
          {cc.mantleEnabled && (
            <>
              <KeyBinding label="Mantle Key" value={cc.keyMantle || cc.keyJump} onChange={(keyMantle) => onChange({ keyMantle })} />
              {num('Mantle Range', 'mantleRange', 0.05, 1.35)}
              {num('Mantle Max Height', 'mantleMaxHeight', 0.05, 1.45)}
              {num('Vault Max Height', 'vaultMaxHeight', 0.05, 0.9)}
              {num('Mantle Duration', 'mantleDuration', 0.02, 0.38)}
              <p className="field-hint">Tag obstacles with vaultable or mantleable instance variables so the controller knows they are traversal targets.</p>
            </>
          )}

          <h4 className="inspector-subhead">Lock-On Targeting</h4>
          <label className="field-row">
            <span>Lock-On</span>
            <input
              type="checkbox"
              checked={Boolean(cc.lockOnEnabled)}
              onChange={(event) => onChange({ lockOnEnabled: event.target.checked })}
            />
          </label>
          {cc.lockOnEnabled && (
            <>
              <KeyBinding label="Lock-On Key" value={cc.keyLockOn ?? 'KeyT'} onChange={(keyLockOn) => onChange({ keyLockOn })} />
              {num('Lock Range', 'lockOnRange', 0.5, 16)}
              {num('Break Distance', 'lockOnBreakDistance', 0.5, 22)}
              <p className="field-hint">
                Locks the nearest living target (an object with a health instance variable, or tagged enemy). The
                character strafes facing it and the camera keeps both in frame; the lock breaks on death or distance.
              </p>
            </>
          )}

          <h4 className="inspector-subhead">Roll / Dodge</h4>
          {num('Roll Speed', 'rollSpeed')}
          {num('Roll Duration', 'rollDuration', 0.05)}
          <p className="field-hint">
            Roll distance ≈ {(cc.rollSpeed * cc.rollDuration).toFixed(1)} units (speed × duration). The dodge goes
            toward the held movement direction (sideways/backwards too — vital while locked on).
          </p>

          <h4 className="inspector-subhead">Sprint Slide</h4>
          <label className="field-row">
            <span>Slide</span>
            <input
              type="checkbox"
              checked={cc.slideEnabled ?? true}
              onChange={(event) => onChange({ slideEnabled: event.target.checked })}
            />
          </label>
          {(cc.slideEnabled ?? true) && (
            <>
              {num('Slide Duration', 'slideDuration', 0.05, 0.9)}
              {num('Slide Boost ×', 'slideSpeedBoost', 0.05, 1.2)}
              <p className="field-hint">Tap crouch while sprinting to power-slide; jumping cancels into a slide-hop.</p>
            </>
          )}

          <h4 className="inspector-subhead">Controls</h4>
          <KeyBinding label="Forward" value={cc.keyForward} onChange={(keyForward) => onChange({ keyForward })} />
          <KeyBinding label="Back" value={cc.keyBackward} onChange={(keyBackward) => onChange({ keyBackward })} />
          <KeyBinding label="Left" value={cc.keyLeft} onChange={(keyLeft) => onChange({ keyLeft })} />
          <KeyBinding label="Right" value={cc.keyRight} onChange={(keyRight) => onChange({ keyRight })} />
          <KeyBinding label="Jump" value={cc.keyJump} onChange={(keyJump) => onChange({ keyJump })} />
          <KeyBinding label="Sprint" value={cc.keySprint} onChange={(keySprint) => onChange({ keySprint })} />
          <KeyBinding label="Crouch" value={cc.keyCrouch} onChange={(keyCrouch) => onChange({ keyCrouch })} />
          <KeyBinding label="Crawl" value={cc.keyCrawl ?? 'KeyZ'} onChange={(keyCrawl) => onChange({ keyCrawl })} />
          <label className="field-row">
            <span>Strafe (face camera)</span>
            <input type="checkbox" checked={Boolean(cc.strafe)} onChange={(event) => onChange({ strafe: event.target.checked })} />
          </label>
          <KeyBinding label="Roll" value={cc.keyRoll} onChange={(keyRoll) => onChange({ keyRoll })} />
          <KeyBinding label="Attack" value={cc.keyAttack} onChange={(keyAttack) => onChange({ keyAttack })} />
          <KeyBinding label="Aim" value={cc.keyAim} onChange={(keyAim) => onChange({ keyAim })} />
          <KeyBinding label="Reload" value={cc.keyReload} onChange={(keyReload) => onChange({ keyReload })} />
          <KeyBinding label="Interact" value={cc.keyInteract} onChange={(keyInteract) => onChange({ keyInteract })} />
          <label className="field-row">
            <span>Interact Range</span>
            <input
              type="number"
              step={0.5}
              min={0}
              value={cc.interactRange ?? 3}
              onChange={(event) => onChange({ interactRange: Number(event.target.value) })}
            />
          </label>
          <KeyBinding label="Emote" value={cc.keyEmote} onChange={(keyEmote) => onChange({ keyEmote })} />
          <KeyBinding label="Ragdoll" value={cc.keyRagdoll} onChange={(keyRagdoll) => onChange({ keyRagdoll })} />

          <h4 className="inspector-subhead">Sounds</h4>
          <p className="field-hint">Played automatically on each event. Import audio assets (mp3/wav) into the project first.</p>
          {sound('Footsteps', 'footstepSoundId')}
          {sound('Jump', 'jumpSoundId')}
          {sound('Land', 'landSoundId')}
          {sound('Splash (water)', 'swimSoundId')}
          {sound('Attack', 'attackSoundId')}
          {sound('Hurt', 'hurtSoundId')}

          <h4 className="inspector-subhead">Camera</h4>
          <label className="field-row">
            <span>Follow Camera</span>
            <input type="checkbox" checked={cc.cameraFollow} onChange={(event) => onChange({ cameraFollow: event.target.checked })} />
          </label>
          {cc.cameraFollow && (
            <>
              <label className="field-row">
                <span>Mode</span>
                <select
                  value={cc.cameraMode}
                  onChange={(event) => onChange({ cameraMode: event.target.value as CharacterControllerComponent['cameraMode'] })}
                >
                  <option value="thirdPerson">Third Person</option>
                  <option value="firstPerson">First Person</option>
                </select>
              </label>
              <button
                className={rigging ? 'full-button active' : 'full-button'}
                onClick={() => setCameraRigTarget(rigging ? undefined : objectId)}
              >
                {rigging ? 'Done positioning' : 'Position Camera (gizmo)'}
              </button>
              <label className="field-row">
                <span>Side</span>
                <input type="number" step={0.1} value={cc.cameraOffset[0]} onChange={(event) => setOffset(0, Number(event.target.value))} />
              </label>
              <label className="field-row">
                <span>Up</span>
                <input type="number" step={0.1} value={cc.cameraOffset[1]} onChange={(event) => setOffset(1, Number(event.target.value))} />
              </label>
              <label className="field-row">
                <span>Back</span>
                <input type="number" step={0.1} value={cc.cameraOffset[2]} onChange={(event) => setOffset(2, Number(event.target.value))} />
              </label>
              {num('Pitch', 'cameraPitch', 0.05)}
              <KeyBinding
                label="Swap Shoulder"
                value={cc.keySwapShoulder ?? 'KeyV'}
                onChange={(keySwapShoulder) => onChange({ keySwapShoulder })}
              />
              <label className="field-row">
                <span>Mouse Look</span>
                <input type="checkbox" checked={cc.mouseLook} onChange={(event) => onChange({ mouseLook: event.target.checked })} />
              </label>
              {cc.mouseLook && (
                <>
                  {num('Sensitivity', 'mouseSensitivity', 0.0005)}
                  <label className="field-row">
                    <span>Camera-Relative Move</span>
                    <input
                      type="checkbox"
                      checked={cc.cameraRelativeMovement}
                      onChange={(event) => onChange({ cameraRelativeMovement: event.target.checked })}
                    />
                  </label>
                </>
              )}
            </>
          )}
        </>
      )}
    </InspectorSection>
  );
}

/** Light tuning for a `kind: 'light'` object — point / spot / directional. */
function LightSection({ light, onChange }: { light: LightComponent | undefined; onChange: (patch: Partial<LightComponent>) => void }) {
  const l = { ...defaultLight(), ...light };
  return (
    <InspectorSection title="Light">
      <label className="field-row">
        <span>Type</span>
        <select value={l.type} onChange={(e) => onChange({ type: e.target.value as LightComponent['type'] })}>
          <option value="point">Point</option>
          <option value="spot">Spot</option>
          <option value="directional">Directional (sun)</option>
        </select>
      </label>
      <label className="field-row">
        <span>Color</span>
        <input type="color" value={l.color} onChange={(e) => onChange({ color: e.target.value })} />
      </label>
      <label className="field-row">
        <span>Intensity</span>
        <input type="number" step={0.5} value={l.intensity} onChange={(e) => onChange({ intensity: Number(e.target.value) })} />
      </label>
      {l.type !== 'directional' && (
        <label className="field-row">
          <span>Range</span>
          <input type="number" step={1} value={l.distance} onChange={(e) => onChange({ distance: Number(e.target.value) })} />
        </label>
      )}
      {l.type === 'spot' && (
        <label className="field-row">
          <span>Cone°</span>
          <input type="number" step={1} value={Math.round((l.angle * 180) / Math.PI)} onChange={(e) => onChange({ angle: (Number(e.target.value) * Math.PI) / 180 })} />
        </label>
      )}
      <label className="field-row">
        <span>Cast Shadow</span>
        <input type="checkbox" checked={l.castShadow} onChange={(e) => onChange({ castShadow: e.target.checked })} />
      </label>
    </InspectorSection>
  );
}

/** Project-wide post-processing (bloom + vignette). Shown when nothing is selected (a "world" setting). */
function RenderSettingsSection() {
  const rs = useEditorStore((state) => state.renderSettings);
  const update = useEditorStore((state) => state.updateRenderSettings);
  return (
    <InspectorSection title="Post-Processing" defaultOpen={false}>
      <p className="field-hint">Project-wide bloom + vignette — applies in Play and the exported game. Bloom makes neon/tracers glow.</p>
      <label className="field-row">
        <span>Bloom</span>
        <input type="checkbox" checked={rs.bloomEnabled} onChange={(e) => update({ bloomEnabled: e.target.checked })} />
      </label>
      {rs.bloomEnabled && (
        <>
          <label className="field-row">
            <span>Intensity</span>
            <input type="number" step={0.1} value={rs.bloomIntensity} onChange={(e) => update({ bloomIntensity: Number(e.target.value) })} />
          </label>
          <label className="field-row">
            <span>Threshold</span>
            <input type="number" step={0.05} value={rs.bloomThreshold} onChange={(e) => update({ bloomThreshold: Number(e.target.value) })} />
          </label>
          <label className="field-row">
            <span>Spread</span>
            <input type="number" step={0.05} value={rs.bloomRadius} onChange={(e) => update({ bloomRadius: Number(e.target.value) })} />
          </label>
        </>
      )}
      <label className="field-row">
        <span>Vignette</span>
        <input type="checkbox" checked={rs.vignetteEnabled} onChange={(e) => update({ vignetteEnabled: e.target.checked })} />
      </label>
      <label className="field-row">
        <span>Minimap</span>
        <input type="checkbox" checked={rs.minimapEnabled ?? false} onChange={(e) => update({ minimapEnabled: e.target.checked })} />
      </label>
      {rs.minimapEnabled && (
        <>
          <label className="field-row">
            <span>Rotate w/ player</span>
            <input type="checkbox" checked={rs.minimapRotate ?? true} onChange={(e) => update({ minimapRotate: e.target.checked })} />
          </label>
          <label className="field-row">
            <span>Range</span>
            <input type="number" step={5} value={rs.minimapRange ?? 60} onChange={(e) => update({ minimapRange: Number(e.target.value) })} />
          </label>
        </>
      )}
    </InspectorSection>
  );
}

function ParticleSection({
  objectId,
  particles,
  imageAssets,
}: {
  objectId: string;
  particles: ParticleSystemComponent | undefined;
  imageAssets: AssetItem[];
}) {
  const addParticles = useEditorStore((state) => state.addParticles);
  const updateParticles = useEditorStore((state) => state.updateParticles);
  const removeParticles = useEditorStore((state) => state.removeParticles);
  const particleSystems = useEditorStore((state) => state.particleSystems);
  const setObjectParticleSystem = useEditorStore((state) => state.setObjectParticleSystem);
  const setActiveParticleSystem = useEditorStore((state) => state.setActiveParticleSystem);

  // "Source" picker: a reusable asset (edits propagate to every instance) vs an inline custom emitter.
  const sourceRow = (
    <label className="field-row">
      <span>Source</span>
      <select
        value={particles?.systemId ?? (particles ? 'inline' : '')}
        onChange={(event) => {
          const value = event.target.value;
          if (value === '') removeParticles(objectId);
          else if (value === 'inline') addParticles(objectId);
          else setObjectParticleSystem(objectId, value);
        }}
      >
        <option value="">None</option>
        <option value="inline">Inline (custom)</option>
        {particleSystems.length > 0 && <option disabled>── Assets ──</option>}
        {particleSystems.map((system) => (
          <option key={system.id} value={system.id}>
            {system.name}
          </option>
        ))}
      </select>
    </label>
  );

  if (!particles) {
    return (
      <InspectorSection title="Particles">
        <p className="field-hint">Fire, smoke, sparks, magic, fountains — a live emitter that previews here and plays in-game. Pick a reusable asset or add an inline emitter.</p>
        {sourceRow}
        <label className="field-row">
          <span>Preset</span>
          <select
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) addParticles(objectId, event.target.value as (typeof particlePresetIds)[number]);
            }}
          >
            <option value="" disabled>
              Add inline emitter from preset…
            </option>
            {particlePresetIds.map((preset) => (
              <option key={preset} value={preset}>
                {preset.charAt(0).toUpperCase() + preset.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <button className="full-button" onClick={() => addParticles(objectId)}>
          Add Inline Emitter
        </button>
      </InspectorSection>
    );
  }

  const onChange = (patch: Partial<ParticleSystemComponent>) => updateParticles(objectId, patch);

  // Referencing a reusable asset — the asset's config wins, so edit it in the Particle System panel.
  if (particles.systemId) {
    const asset = particleSystems.find((p) => p.id === particles.systemId);
    return (
      <InspectorSection title="Particles">
        {sourceRow}
        <p className="field-hint">{asset ? `Using particle system "${asset.name}". Edit it once to update every object that uses it.` : 'Referenced particle system was removed.'}</p>
        <label className="field-row">
          <span>Enabled</span>
          <input type="checkbox" checked={particles.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
        </label>
        {asset && (
          <button
            className="full-button"
            onClick={() => {
              setActiveParticleSystem(asset.id);
              focusWorkspacePanel('particles');
            }}
          >
            Edit Particle System
          </button>
        )}
        <button className="full-button" onClick={() => removeParticles(objectId)}>
          Remove Emitter
        </button>
      </InspectorSection>
    );
  }

  return (
    <InspectorSection title="Particles">
      {sourceRow}
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={particles.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      </label>
      <label className="field-row">
        <span>Preset</span>
        <select
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) addParticles(objectId, event.target.value as (typeof particlePresetIds)[number]);
          }}
        >
          <option value="">Re-seed from preset…</option>
          {particlePresetIds.map((preset) => (
            <option key={preset} value={preset}>
              {preset.charAt(0).toUpperCase() + preset.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="field-row">
        <span>Looping</span>
        <input type="checkbox" checked={particles.looping} onChange={(event) => onChange({ looping: event.target.checked })} />
      </label>
      {particles.looping ? (
        <label className="field-row">
          <span>Rate /s</span>
          <NumberInput value={particles.rate} min={0} step={1} onChange={(rate) => onChange({ rate })} />
        </label>
      ) : (
        <label className="field-row">
          <span>Burst</span>
          <NumberInput value={particles.burst} min={0} step={1} onChange={(burst) => onChange({ burst })} />
        </label>
      )}
      <label className="field-row">
        <span>Max</span>
        <NumberInput value={particles.maxParticles} min={1} max={4000} step={10} onChange={(maxParticles) => onChange({ maxParticles })} />
      </label>
      <label className="field-row">
        <span>Shape</span>
        <select value={particles.shape} onChange={(event) => onChange({ shape: event.target.value as ParticleEmitterShape })}>
          <option value="point">Point</option>
          <option value="cone">Cone</option>
          <option value="disc">Disc</option>
          <option value="sphere">Sphere</option>
          <option value="hemisphere">Hemisphere</option>
          <option value="box">Box</option>
        </select>
      </label>
      <label className="field-row">
        <span>Radius</span>
        <NumberInput value={particles.shapeRadius} min={0} step={0.05} onChange={(shapeRadius) => onChange({ shapeRadius })} />
      </label>
      <label className="field-row">
        <span>Spread °</span>
        <NumberInput value={particles.coneAngle} min={0} max={180} step={1} onChange={(coneAngle) => onChange({ coneAngle })} />
      </label>
      <VectorField label="Direction" value={particles.direction} onChange={(direction) => onChange({ direction })} />
      <label className="field-row">
        <span>Speed</span>
        <NumberInput value={particles.speed} step={0.1} onChange={(speed) => onChange({ speed })} />
      </label>
      <RangeField label="Speed Jitter" value={particles.speedJitter} onChange={(speedJitter) => onChange({ speedJitter })} />
      <label className="field-row">
        <span>Gravity</span>
        <NumberInput value={particles.gravity} step={0.1} onChange={(gravity) => onChange({ gravity })} />
      </label>
      <RangeField label="Drag" value={particles.drag} max={3} onChange={(drag) => onChange({ drag })} />
      <label className="field-row">
        <span>Lifetime</span>
        <NumberInput value={particles.lifetime} min={0.05} step={0.1} onChange={(lifetime) => onChange({ lifetime })} />
      </label>
      <RangeField label="Life Jitter" value={particles.lifetimeJitter} onChange={(lifetimeJitter) => onChange({ lifetimeJitter })} />
      <label className="field-row">
        <span>Start Size</span>
        <NumberInput value={particles.startSize} min={0} step={0.02} onChange={(startSize) => onChange({ startSize })} />
      </label>
      <label className="field-row">
        <span>End Size</span>
        <NumberInput value={particles.endSize} min={0} step={0.02} onChange={(endSize) => onChange({ endSize })} />
      </label>
      <label className="field-row">
        <span>Start Color</span>
        <input type="color" value={particles.startColor} onChange={(event) => onChange({ startColor: event.target.value })} />
      </label>
      <label className="field-row">
        <span>End Color</span>
        <input type="color" value={particles.endColor} onChange={(event) => onChange({ endColor: event.target.value })} />
      </label>
      <RangeField label="Start Opacity" value={particles.startOpacity} onChange={(startOpacity) => onChange({ startOpacity })} />
      <RangeField label="End Opacity" value={particles.endOpacity} onChange={(endOpacity) => onChange({ endOpacity })} />
      <label className="field-row">
        <span>Blend</span>
        <select value={particles.blend} onChange={(event) => onChange({ blend: event.target.value as ParticleSystemComponent['blend'] })}>
          <option value="additive">Additive (glow)</option>
          <option value="normal">Normal (smoke)</option>
        </select>
      </label>
      <label className="field-row">
        <span>World Space</span>
        <input type="checkbox" checked={particles.worldSpace} onChange={(event) => onChange({ worldSpace: event.target.checked })} />
      </label>
      <label className="field-row">
        <span>Emit Light</span>
        <input type="checkbox" checked={particles.light ?? false} onChange={(event) => onChange({ light: event.target.checked })} />
      </label>
      <label className="field-row">
        <span>Sprite</span>
        <select value={particles.textureAssetId ?? ''} onChange={(event) => onChange({ textureAssetId: event.target.value || undefined })}>
          <option value="">Soft dot</option>
          {imageAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>
      <button className="full-button" onClick={() => removeParticles(objectId)}>
        Remove Emitter
      </button>
    </InspectorSection>
  );
}

function TerrainSection({
  terrain,
  onChange,
}: {
  terrain: TerrainComponent;
  onChange: (patch: Partial<TerrainComponent>) => void;
}) {
  const t = withTerrainDefaults(terrain);
  const patchFoliage = (patch: Partial<TerrainComponent['foliage']>) =>
    onChange({ foliage: { ...t.foliage, ...patch } });
  return (
    <InspectorSection title="Terrain">
      <button className="full-button" onClick={() => focusWorkspacePanel('terrain')}>
        Terrain Tools
      </button>
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={t.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      </label>
      <label className="field-row">
        <span>Size</span>
        <NumberInput value={t.size} min={32} step={32} onChange={(size) => onChange({ size })} />
      </label>
      <label className="field-row">
        <span>Chunk</span>
        <NumberInput value={t.chunkSize} min={8} step={8} onChange={(chunkSize) => onChange({ chunkSize })} />
      </label>
      <label className="field-row">
        <span>Resolution</span>
        <NumberInput value={t.resolution} min={4} max={64} step={1} onChange={(resolution) => onChange({ resolution })} />
      </label>
      <label className="field-row">
        <span>Stream Radius</span>
        <NumberInput value={t.streamRadius} min={1} max={10} step={1} onChange={(streamRadius) => onChange({ streamRadius })} />
      </label>
      <label className="field-row">
        <span>Physics Radius</span>
        <NumberInput value={t.physicsRadius} min={1} max={5} step={1} onChange={(physicsRadius) => onChange({ physicsRadius })} />
      </label>
      <label className="field-row">
        <span>Seed</span>
        <NumberInput value={t.seed} step={1} precision={0} onChange={(seed) => onChange({ seed })} />
      </label>
      <label className="field-row">
        <span>Height</span>
        <NumberInput value={t.heightScale} min={0} step={0.5} onChange={(heightScale) => onChange({ heightScale })} />
      </label>
      <label className="field-row">
        <span>Frequency</span>
        <NumberInput value={t.frequency} min={0.001} max={0.25} step={0.001} precision={4} onChange={(frequency) => onChange({ frequency })} />
      </label>
      <label className="field-row">
        <span>Octaves</span>
        <NumberInput value={t.octaves} min={1} max={8} step={1} onChange={(octaves) => onChange({ octaves })} />
      </label>
      <label className="field-row">
        <span>Low Color</span>
        <input type="color" value={t.lowColor} onChange={(event) => onChange({ lowColor: event.target.value })} />
      </label>
      <label className="field-row">
        <span>Mid Color</span>
        <input type="color" value={t.midColor} onChange={(event) => onChange({ midColor: event.target.value })} />
      </label>
      <label className="field-row">
        <span>High Color</span>
        <input type="color" value={t.highColor} onChange={(event) => onChange({ highColor: event.target.value })} />
      </label>

      <h4 className="inspector-subhead">Foliage</h4>
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={t.foliage.enabled} onChange={(event) => patchFoliage({ enabled: event.target.checked })} />
      </label>
      <label className="field-row">
        <span>Mode</span>
        <select value={t.foliage.mode} onChange={(event) => patchFoliage({ mode: event.target.value as TerrainComponent['foliage']['mode'] })}>
          <option value="grass">Grass</option>
          <option value="trees">Trees</option>
          <option value="mixed">Mixed</option>
        </select>
      </label>
      <RangeField label="Grass Density" value={t.foliage.density} onChange={(density) => patchFoliage({ density })} />
      <RangeField label="Tree Density" value={t.foliage.treeDensity} onChange={(treeDensity) => patchFoliage({ treeDensity })} />
      <RangeField label="Slope Limit" value={t.foliage.slopeLimit} onChange={(slopeLimit) => patchFoliage({ slopeLimit })} />
      <label className="field-row">
        <span>Min Scale</span>
        <NumberInput value={t.foliage.minScale} min={0.1} step={0.1} onChange={(minScale) => patchFoliage({ minScale })} />
      </label>
      <label className="field-row">
        <span>Max Scale</span>
        <NumberInput value={t.foliage.maxScale} min={0.1} step={0.1} onChange={(maxScale) => patchFoliage({ maxScale })} />
      </label>
      <label className="field-row">
        <span>Grass Color</span>
        <input type="color" value={t.foliage.grassColor} onChange={(event) => patchFoliage({ grassColor: event.target.value })} />
      </label>
      <label className="field-row">
        <span>Tree Color</span>
        <input type="color" value={t.foliage.treeColor} onChange={(event) => patchFoliage({ treeColor: event.target.value })} />
      </label>
    </InspectorSection>
  );
}

const JOINT_TYPE_HINTS: Record<JointType, string> = {
  fixed: 'Welds the two bodies rigidly — they move as one. Good for stuck/welded debris.',
  spherical: 'Ball-and-socket: free rotation about the anchor, no separation. Chains, pendulums, shoulders.',
  hinge: 'Rotates about one axis only. Doors, wheels, levers, valves. Add limits + a motor to drive it.',
  slider: 'Slides along one axis only. Lifts, drawers, pistons, sliding doors. Add limits + a motor.',
  spring: 'Distance spring toward a rest length, with stiffness + damping. Bungees, suspension, soft tethers.',
  rope: 'Caps the separation at a maximum length — slack until taut. Tethers, hanging signs, leashes.',
};

function JointSection({
  joint,
  objectId,
  sceneObjects,
  onAdd,
  onChange,
  onRemove,
}: {
  joint?: JointComponent;
  objectId: string;
  sceneObjects: SceneObject[];
  onAdd: () => void;
  onChange: (patch: Partial<JointComponent>) => void;
  onRemove: () => void;
}) {
  if (!joint) {
    return (
      <InspectorSection title="Joint">
        <p className="field-hint">
          Constrain this body to another (or pin it in the world): hinge doors &amp; wheels, sliding lifts,
          springs, ropes, ball-and-socket chains, or rigid welds. Adds a physics body if missing.
        </p>
        <button className="full-button" onClick={onAdd}>Add Joint</button>
      </InspectorSection>
    );
  }

  const isHinge = joint.type === 'hinge';
  const isSlider = joint.type === 'slider';
  const isSpring = joint.type === 'spring';
  const isRope = joint.type === 'rope';
  const showAxis = isHinge || isSlider;
  const showLimits = isHinge || isSlider;
  // List every other object — picking one auto-enables physics on it (a joint links two bodies), so we
  // don't pre-filter to physics-enabled objects (which left the list empty and read as "can't attach").
  const connectable = sceneObjects.filter((object) => object.id !== objectId);
  const connected = joint.connectedObjectId ? sceneObjects.find((o) => o.id === joint.connectedObjectId) : undefined;

  return (
    <InspectorSection title="Joint">
      <label className="field-row">
        <span>Type</span>
        <select value={joint.type} onChange={(event) => onChange({ type: event.target.value as JointType })}>
          <option value="fixed">Fixed (weld)</option>
          <option value="spherical">Spherical (ball)</option>
          <option value="hinge">Hinge (door/wheel)</option>
          <option value="slider">Slider (lift/piston)</option>
          <option value="spring">Spring</option>
          <option value="rope">Rope</option>
        </select>
      </label>
      <p className="field-hint">{JOINT_TYPE_HINTS[joint.type]}</p>

      <label className="field-row">
        <span>Connect to</span>
        <select
          value={joint.connectedObjectId ?? ''}
          onChange={(event) => onChange({ connectedObjectId: event.target.value || undefined })}
        >
          <option value="">World (pin in place)</option>
          {connectable.map((object) => (
            <option key={object.id} value={object.id}>
              {object.name}{object.physics?.enabled ? '' : ' (no physics)'}
            </option>
          ))}
        </select>
      </label>
      {connected && !connected.physics?.enabled && (
        <p className="field-hint">“{connected.name}” has no physics body yet — it will be given a dynamic body automatically so the joint can act on it.</p>
      )}

      <VectorField label="Anchor (self)" value={joint.localAnchor} onChange={(localAnchor) => onChange({ localAnchor })} />
      {joint.connectedObjectId && (
        <VectorField label="Anchor (other)" value={joint.connectedAnchor} onChange={(connectedAnchor) => onChange({ connectedAnchor })} />
      )}
      {showAxis && <VectorField label="Axis" value={joint.axis} onChange={(axis) => onChange({ axis })} />}

      {showLimits && (
        <>
          <label className="field-row">
            <span>Limits</span>
            <input type="checkbox" checked={joint.limitsEnabled ?? false} onChange={(event) => onChange({ limitsEnabled: event.target.checked })} />
          </label>
          {joint.limitsEnabled && (
            <>
              <label className="field-row">
                <span>{isHinge ? 'Min (rad)' : 'Min (units)'}</span>
                <NumberInput value={joint.limitMin ?? 0} step={0.1} onChange={(limitMin) => onChange({ limitMin })} />
              </label>
              <label className="field-row">
                <span>{isHinge ? 'Max (rad)' : 'Max (units)'}</span>
                <NumberInput value={joint.limitMax ?? 0} step={0.1} onChange={(limitMax) => onChange({ limitMax })} />
              </label>
            </>
          )}
          <label className="field-row">
            <span>Motor speed</span>
            <NumberInput value={joint.motorTargetVelocity ?? 0} step={0.1} onChange={(motorTargetVelocity) => onChange({ motorTargetVelocity })} />
          </label>
          {(joint.motorTargetVelocity ?? 0) !== 0 && (
            <label className="field-row">
              <span>Motor force</span>
              <NumberInput value={joint.motorMaxForce ?? 20} min={0} step={1} onChange={(motorMaxForce) => onChange({ motorMaxForce })} />
            </label>
          )}
          <p className="field-hint">Motor speed drives the joint (rad/s for hinge, units/s for slider). 0 = free.</p>
        </>
      )}

      {isSpring && (
        <>
          <label className="field-row">
            <span>Rest length</span>
            <NumberInput value={joint.restLength ?? 1} min={0} step={0.1} onChange={(restLength) => onChange({ restLength })} />
          </label>
          <label className="field-row">
            <span>Stiffness</span>
            <NumberInput value={joint.stiffness ?? 40} min={0} step={1} onChange={(stiffness) => onChange({ stiffness })} />
          </label>
          <label className="field-row">
            <span>Damping</span>
            <NumberInput value={joint.damping ?? 4} min={0} step={0.5} onChange={(damping) => onChange({ damping })} />
          </label>
        </>
      )}

      {isRope && (
        <label className="field-row">
          <span>Max length</span>
          <NumberInput value={joint.maxLength ?? 2} min={0} step={0.1} onChange={(maxLength) => onChange({ maxLength })} />
        </label>
      )}

      <label className="field-row">
        <span>Bodies collide</span>
        <input type="checkbox" checked={joint.collideConnected ?? false} onChange={(event) => onChange({ collideConnected: event.target.checked })} />
      </label>

      <button className="full-button" onClick={onRemove}>Remove Joint</button>
    </InspectorSection>
  );
}

const CLOTH_PIN_LABELS: Record<ClothComponent['pinMode'], string> = {
  'top-edge': 'Top edge (banner / curtain)',
  'top-corners': 'Top corners (flag on ropes)',
  'four-corners': 'Four corners (tarp / net)',
  'left-edge': 'Left edge (flag on a pole)',
  none: 'None (free falling sheet)',
};

function ClothSection({
  cloth,
  modelAssets,
  onAdd,
  onChange,
  onRemove,
}: {
  cloth?: ClothComponent;
  modelAssets: AssetItem[];
  onAdd: () => void;
  onChange: (patch: Partial<ClothComponent>) => void;
  onRemove: () => void;
}) {
  if (!cloth) {
    return (
      <InspectorSection title="Cloth">
        <p className="field-hint">
          Turn this object into a real-time cloth sheet (Verlet sim, separate from rigid-body physics):
          flags, banners, curtains, capes, hanging cloth. Wind + gravity + collision, pinned per the mode you pick.
        </p>
        <button className="full-button" onClick={onAdd}>Add Cloth</button>
      </InspectorSection>
    );
  }
  return (
    <InspectorSection title="Cloth">
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={cloth.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      </label>
      <label className="field-row">
        <span>Shape</span>
        <select value={cloth.sourceMode ?? 'grid'} onChange={(event) => onChange({ sourceMode: event.target.value as ClothComponent['sourceMode'] })}>
          <option value="grid">Grid sheet</option>
          <option value="mesh">Imported mesh</option>
        </select>
      </label>
      {cloth.sourceMode === 'mesh' && (
        <>
          <label className="field-row">
            <span>Cloth mesh</span>
            <select value={cloth.meshAssetId ?? ''} onChange={(event) => onChange({ meshAssetId: event.target.value || undefined })}>
              <option value="">Pick a model…</option>
              {modelAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.name}</option>
              ))}
            </select>
          </label>
          <p className="field-hint">The model's mesh becomes the cloth (its vertices simulate, edges hold it together). Pick a Pinned edge below to anchor it (e.g. a flag's pole edge).</p>
        </>
      )}
      <label className="field-row">
        <span>Pinned</span>
        <select value={cloth.pinMode} onChange={(event) => onChange({ pinMode: event.target.value as ClothComponent['pinMode'] })}>
          {(Object.keys(CLOTH_PIN_LABELS) as ClothComponent['pinMode'][]).map((mode) => (
            <option key={mode} value={mode}>{CLOTH_PIN_LABELS[mode]}</option>
          ))}
        </select>
      </label>
      <p className="field-hint">Pinned particles follow this object — parent the cloth to a character to make a cape.</p>
      <label className="field-row">
        <span>Width</span>
        <NumberInput value={cloth.width} min={0.1} step={0.1} onChange={(width) => onChange({ width })} />
      </label>
      <label className="field-row">
        <span>Height</span>
        <NumberInput value={cloth.height} min={0.1} step={0.1} onChange={(height) => onChange({ height })} />
      </label>
      <label className="field-row">
        <span>Resolution</span>
        <NumberInput value={cloth.resolution} min={4} max={32} step={1} onChange={(resolution) => onChange({ resolution })} />
      </label>
      <p className="field-hint">Grid divisions per side (4–32). Higher = smoother + softer, but costlier.</p>
      <label className="field-row">
        <span>Stiffness</span>
        <NumberInput value={cloth.stiffness} min={1} max={12} step={1} onChange={(stiffness) => onChange({ stiffness })} />
      </label>
      <RangeField label="Damping" value={cloth.damping} max={0.95} onChange={(damping) => onChange({ damping })} />
      <label className="field-row">
        <span>Gravity</span>
        <NumberInput value={cloth.gravityScale} step={0.1} onChange={(gravityScale) => onChange({ gravityScale })} />
      </label>
      <VectorField label="Wind" value={cloth.wind} onChange={(wind) => onChange({ wind })} />
      <RangeField label="Turbulence" value={cloth.turbulence} onChange={(turbulence) => onChange({ turbulence })} />
      <label className="field-row">
        <span>Collide floor</span>
        <input type="checkbox" checked={cloth.collideFloor} onChange={(event) => onChange({ collideFloor: event.target.checked })} />
      </label>
      {cloth.collideFloor && (
        <label className="field-row">
          <span>Floor Y</span>
          <NumberInput value={cloth.floorY} step={0.1} onChange={(floorY) => onChange({ floorY })} />
        </label>
      )}
      <label className="field-row">
        <span>Collide bodies</span>
        <input type="checkbox" checked={cloth.collideBodies} onChange={(event) => onChange({ collideBodies: event.target.checked })} />
      </label>
      <p className="field-hint">Collides with nearby physics/character colliders (sphere/box/capsule approximations).</p>
      <RangeField label="Tear" value={cloth.tearFactor} max={5} onChange={(tearFactor) => onChange({ tearFactor })} />
      <p className="field-hint">0 = never tears; &gt;1 lets seams snap when stretched past that ratio.</p>
      <button className="full-button" onClick={onRemove}>Remove Cloth</button>
    </InspectorSection>
  );
}

function CableSection({
  cable,
  objectId,
  sceneObjects,
  onAdd,
  onChange,
  onRemove,
}: {
  cable?: CableComponent;
  objectId: string;
  sceneObjects: SceneObject[];
  onAdd: () => void;
  onChange: (patch: Partial<CableComponent>) => void;
  onRemove: () => void;
}) {
  if (!cable) {
    return (
      <InspectorSection title="Cable">
        <p className="field-hint">
          Turn this object into a real-time cable / rope (Verlet sim rendered as a tube, separate from rigid-body
          physics): power lines, tow ropes, chains, hanging wires, vines, hoses. The start follows this object;
          attach the far end to another object to span the two.
        </p>
        <button className="full-button" onClick={onAdd}>Add Cable</button>
      </InspectorSection>
    );
  }
  const endTargets = sceneObjects.filter((object) => object.id !== objectId);
  return (
    <InspectorSection title="Cable">
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={cable.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      </label>
      <label className="field-row">
        <span>Attach end to</span>
        <select value={cable.endObjectId ?? ''} onChange={(event) => onChange({ endObjectId: event.target.value || undefined })}>
          <option value="">— free hanging —</option>
          {endTargets.map((object) => (
            <option key={object.id} value={object.id}>{object.name}</option>
          ))}
        </select>
      </label>
      <p className="field-hint">The start is pinned to this object. Pick another object to pin the far end to it (Unreal AttachEndTo); leave free to dangle.</p>
      <VectorField label="Start offset" value={cable.startOffset ?? [0, 0, 0]} onChange={(startOffset) => onChange({ startOffset })} />
      <p className="field-hint">Where the cable leaves THIS object (local space) — e.g. a crane-tip pulley, a hand socket.</p>
      <label className="field-row">
        <span>Use existing physics joint</span>
        <input type="checkbox" checked={cable.followJoint ?? false} onChange={(event) => onChange({ followJoint: event.target.checked })} />
      </label>
      <p className="field-hint">
        Already added a rope joint (Physics → Joint) to the swinging object? Turn this on and the cable just DRAWS that
        constraint — its far end comes from the joint and it creates NO second constraint (so it won't fight your joint).
        Leave "Attach end to" empty; the joint provides the end. Use this when you wired the physics yourself.
      </p>
      {(cable.endObjectId || cable.followJoint) && <VectorField label="End offset" value={cable.endOffset ?? [0, 0, 0]} onChange={(endOffset) => onChange({ endOffset })} />}
      {cable.endObjectId && !cable.followJoint && (
        <>
          <label className="field-row">
            <span>Physical (rope)</span>
            <input type="checkbox" checked={cable.physics ?? false} onChange={(event) => onChange({ physics: event.target.checked })} />
          </label>
          <p className="field-hint">
            Lets the CABLE create the rope joint for you between the two ends (capped at Length) so a dynamic end swings —
            wrecking ball, pendulum, tow rope. Seeds bodies if missing: this object → fixed pivot, the attached end → dynamic.
            Swings during Play. (If you already have your own joint, use "Use existing physics joint" above instead.)
          </p>
          {cable.physics && (
            <>
              <label className="field-row">
                <span>Constraint</span>
                <select value={cable.physicsMode ?? 'rope'} onChange={(event) => onChange({ physicsMode: event.target.value as CableComponent['physicsMode'] })}>
                  <option value="rope">Rope (slack → taut)</option>
                  <option value="spring">Spring (elastic / bungee)</option>
                </select>
              </label>
              {cable.physicsMode === 'spring' && (
                <>
                  <label className="field-row">
                    <span>Spring stiffness</span>
                    <NumberInput value={cable.springStiffness ?? 40} min={0} step={1} onChange={(springStiffness) => onChange({ springStiffness })} />
                  </label>
                  <label className="field-row">
                    <span>Spring damping</span>
                    <NumberInput value={cable.springDamping ?? 4} min={0} step={0.5} onChange={(springDamping) => onChange({ springDamping })} />
                  </label>
                </>
              )}
            </>
          )}
        </>
      )}
      <label className="field-row">
        <span>Length</span>
        <NumberInput value={cable.length} min={0.1} step={0.1} onChange={(length) => onChange({ length })} />
      </label>
      <p className="field-hint">Rest length / slack. Longer than the gap between the ends = it sags; shorter = pulled taut.</p>
      <label className="field-row">
        <span>Radius</span>
        <NumberInput value={cable.radius} min={0.005} step={0.01} onChange={(radius) => onChange({ radius })} />
      </label>
      <label className="field-row">
        <span>Style</span>
        <select value={cable.style ?? 'cable'} onChange={(event) => onChange({ style: event.target.value as CableComponent['style'] })}>
          <option value="cable">Cable (smooth tube)</option>
          <option value="rope">Rope (braided twist)</option>
          <option value="chain">Chain (beaded links)</option>
          <option value="wire">Wire (thin)</option>
        </select>
      </label>
      <p className="field-hint">Visual look. Use a metal material for chain/wire. Chain/rope add a twist + link beads.</p>
      <label className="field-row">
        <span>Segments</span>
        <NumberInput value={cable.segments} min={2} max={64} step={1} onChange={(segments) => onChange({ segments })} />
      </label>
      <p className="field-hint">Links along the cable (2–64). Higher = smoother sag, costlier.</p>
      <label className="field-row">
        <span>Stiffness</span>
        <NumberInput value={cable.stiffness} min={1} max={16} step={1} onChange={(stiffness) => onChange({ stiffness })} />
      </label>
      <RangeField label="Damping" value={cable.damping} max={0.95} onChange={(damping) => onChange({ damping })} />
      <label className="field-row">
        <span>Gravity</span>
        <NumberInput value={cable.gravityScale} step={0.1} onChange={(gravityScale) => onChange({ gravityScale })} />
      </label>
      <VectorField label="Wind" value={cable.wind} onChange={(wind) => onChange({ wind })} />
      <RangeField label="Turbulence" value={cable.turbulence} onChange={(turbulence) => onChange({ turbulence })} />
      <label className="field-row">
        <span>Collide floor</span>
        <input type="checkbox" checked={cable.collideFloor} onChange={(event) => onChange({ collideFloor: event.target.checked })} />
      </label>
      {cable.collideFloor && (
        <label className="field-row">
          <span>Floor Y</span>
          <NumberInput value={cable.floorY} step={0.1} onChange={(floorY) => onChange({ floorY })} />
        </label>
      )}
      <label className="field-row">
        <span>Collide bodies</span>
        <input type="checkbox" checked={cable.collideBodies} onChange={(event) => onChange({ collideBodies: event.target.checked })} />
      </label>
      <p className="field-hint">Collides with nearby physics/character colliders (sphere/box/capsule approximations).</p>
      <RangeField label="Tear" value={cable.tearFactor} max={5} onChange={(tearFactor) => onChange({ tearFactor })} />
      <p className="field-hint">0 = never tears; &gt;1 lets the cable snap when stretched past that ratio.</p>
      <label className="field-row">
        <span>Tension color</span>
        <input type="checkbox" checked={cable.tensionColor ?? false} onChange={(event) => onChange({ tensionColor: event.target.checked })} />
      </label>
      <p className="field-hint">Tints the cable toward red as it nears its breaking stretch — visual strain feedback.</p>
      <button className="full-button" onClick={onRemove}>Remove Cable</button>
    </InspectorSection>
  );
}

function PhysicsSection({
  physics,
  onChange,
}: {
  physics: PhysicsComponent;
  onChange: (patch: Partial<PhysicsComponent>) => void;
}) {
  const selectedPreset = PHYSICS_MATERIAL_PRESETS.find((preset) => preset.id === (physics.materialPreset ?? 'default'));
  return (
    <InspectorSection title="Physics">
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={physics.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      </label>
      <label className="field-row">
        <span>Body</span>
        <select value={physics.bodyType} onChange={(event) => onChange({ bodyType: event.target.value as PhysicsComponent['bodyType'] })}>
          <option value="fixed">Static (wall / floor)</option>
          <option value="dynamic">Dynamic (falls / moves)</option>
          <option value="kinematic">Kinematic (scripted mover)</option>
        </select>
      </label>
      <label className="field-row">
        <span>Collider</span>
        <select value={physics.collider} onChange={(event) => onChange({ collider: event.target.value as PhysicsComponent['collider'] })}>
          <option value="box">Box</option>
          <option value="sphere">Sphere</option>
          <option value="capsule">Capsule</option>
          <option value="mesh">Mesh (exact)</option>
          <option value="convex">Convex hull</option>
        </select>
      </label>
      {(physics.collider === 'mesh' || physics.collider === 'convex') && (
        <p className="field-hint">
          {physics.collider === 'mesh'
            ? 'Exact triangle collider from the imported model — best for STATIC geometry. Dynamic bodies should use Convex hull.'
            : 'Convex hull of the model — cheaper and valid for dynamic bodies. Falls back to a box until the model loads (and if it has no model).'}
        </p>
      )}
      <label className="field-row">
        <span>Trigger</span>
        <input type="checkbox" checked={physics.isTrigger ?? false} onChange={(event) => onChange({ isTrigger: event.target.checked })} />
      </label>
      {physics.isTrigger && <p className="field-hint">Trigger colliders detect overlaps but do not block, push, or get pushed.</p>}
      <label className="field-row">
        <span>Layer</span>
        <select value={physics.collisionLayer ?? 0} onChange={(event) => onChange({ collisionLayer: Number(event.target.value) })}>
          {physicsLayers.map((layer) => (
            <option key={layer} value={layer}>
              Layer {layer}
            </option>
          ))}
        </select>
      </label>
      <LayerMaskField value={physics.collisionMask ?? 0xffff} onChange={(collisionMask) => onChange({ collisionMask })} />
      <label className="field-row">
        <span>Mass</span>
        <NumberInput value={physics.mass} min={0} step={0.1} onChange={(mass) => onChange({ mass })} />
      </label>
      <label className="field-row">
        <span>Gravity</span>
        <NumberInput value={physics.gravityScale} step={0.1} onChange={(gravityScale) => onChange({ gravityScale })} />
      </label>
      <label className="field-row">
        <span>Material</span>
        <select
          value={physics.materialPreset ?? 'default'}
          onChange={(event) => onChange(applyPhysicsMaterialPreset(physics, event.target.value as NonNullable<PhysicsComponent['materialPreset']>))}
        >
          {PHYSICS_MATERIAL_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
      {selectedPreset && <p className="field-hint">{selectedPreset.description}</p>}
      <RangeField label="Friction" value={physics.friction} onChange={(friction) => onChange({ friction })} />
      <RangeField label="Bounce" value={physics.restitution ?? 0.05} onChange={(restitution) => onChange({ restitution })} />
      {physics.bodyType === 'dynamic' && (
        <>
          <label className="field-row">
            <span>Wind influence</span>
            <NumberInput value={physics.windInfluence ?? 0} min={0} step={0.1} onChange={(windInfluence) => onChange({ windInfluence })} />
          </label>
          <p className="field-hint">How strongly global scene Wind pushes this body. 0 = ignores wind. Set the wind itself in Scene Settings.</p>
          <label className="field-row">
            <span>Continuous collision</span>
            <input type="checkbox" checked={physics.ccd ?? false} onChange={(event) => onChange({ ccd: event.target.checked })} />
          </label>
          {physics.ccd && (
            <p className="field-hint">Stops this body tunnelling through thin walls/floors at high speed. Small cost — use for fast objects.</p>
          )}
        </>
      )}
      {physics.bodyType === 'fixed' && (
        <>
          <label className="field-row">
            <span>Knock-over speed</span>
            <NumberInput value={physics.knockOverThreshold ?? 0} min={0} step={1} onChange={(knockOverThreshold) => onChange({ knockOverThreshold })} />
          </label>
          <p className="field-hint">
            Breakaway prop: hit faster than this (units/sec) and the body turns dynamic and tumbles, carrying the
            impact — lamp posts, signs, fences. 0 = never breaks away.
          </p>
        </>
      )}
    </InspectorSection>
  );
}

function WaterSection({
  water,
  onToggle,
  onChange,
}: {
  water?: WaterVolumeComponent;
  onToggle: () => void;
  onChange: (patch: Partial<WaterVolumeComponent>) => void;
}) {
  if (!water?.enabled) {
    return (
      <InspectorSection title="Water Volume">
        <p className="field-hint">Adds swim mode for characters and buoyancy, drag, wave lift, and surface bounce for dynamic physics bodies.</p>
        <button className="full-button" onClick={onToggle}>Add Water Volume</button>
      </InspectorSection>
    );
  }

  return (
    <InspectorSection title="Water Volume">
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={water.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      </label>

      <label className="field-row">
        <span>Style</span>
        <select
          value={water.style ?? 'custom'}
          onChange={(event) => onChange({ style: event.target.value as WaterVolumeComponent['style'] })}
        >
          {WATER_STYLE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      <p className="field-hint">Picking a style sets the look below; tweaking any value switches it to Custom.</p>

      <h4 className="inspector-subhead">Look</h4>
      <label className="field-row">
        <span>Shallow color</span>
        <input type="color" value={water.shallowColor ?? '#4FD2E8'} onChange={(event) => onChange({ shallowColor: event.target.value })} />
      </label>
      <label className="field-row">
        <span>Deep color</span>
        <input type="color" value={water.deepColor ?? '#0A3A66'} onChange={(event) => onChange({ deepColor: event.target.value })} />
      </label>
      <label className="field-row">
        <span>Foam color</span>
        <input type="color" value={water.foamColor ?? '#EAF6FF'} onChange={(event) => onChange({ foamColor: event.target.value })} />
      </label>
      <RangeField label="Opacity" value={water.opacity ?? 0.82} min={0} max={1} onChange={(opacity) => onChange({ opacity })} />
      <RangeField label="Reflectivity" value={water.reflectivity ?? 0.6} min={0} max={1} onChange={(reflectivity) => onChange({ reflectivity })} />
      <RangeField label="Foam" value={water.foam ?? 0.5} min={0} max={1} onChange={(foam) => onChange({ foam })} />
      <RangeField label="Sparkle" value={water.sparkle ?? 0.6} min={0} max={1} onChange={(sparkle) => onChange({ sparkle })} />
      <RangeField label="Caustics" value={water.caustics ?? 0.35} min={0} max={1} onChange={(caustics) => onChange({ caustics })} />
      <RangeField label="Emissive glow" value={water.emissiveIntensity ?? 0} min={0} max={2} onChange={(emissiveIntensity) => onChange({ emissiveIntensity })} />
      <label className="field-row">
        <span>Underwater fog</span>
        <input type="checkbox" checked={water.underwaterFog ?? false} onChange={(event) => onChange({ underwaterFog: event.target.checked })} />
      </label>

      <h4 className="inspector-subhead">Waves &amp; physics</h4>
      <RangeField label="Buoyancy" value={water.buoyancy} min={0} max={3} onChange={(buoyancy) => onChange({ buoyancy })} />
      <RangeField label="Drag" value={water.drag} min={0} max={6} onChange={(drag) => onChange({ drag })} />
      <RangeField label="Surface bounce" value={water.surfaceBounce} min={0} max={2} onChange={(surfaceBounce) => onChange({ surfaceBounce })} />
      <RangeField label="Wave height" value={water.waveAmplitude} min={0} max={2} onChange={(waveAmplitude) => onChange({ waveAmplitude })} />
      <RangeField label="Wave speed" value={water.waveSpeed} min={0} max={6} onChange={(waveSpeed) => onChange({ waveSpeed })} />
      <RangeField label="Wave frequency" value={water.waveFrequency} min={0.05} max={2} onChange={(waveFrequency) => onChange({ waveFrequency })} />
      <RangeField label="Current strength" value={water.flowStrength ?? 0} min={0} max={4} onChange={(flowStrength) => onChange({ flowStrength })} />
      <RangeField label="Current angle" value={water.flowAngle ?? 0} min={0} max={360} step={1} onChange={(flowAngle) => onChange({ flowAngle })} />
      <RangeField label="Rain" value={water.rainStrength ?? 0} min={0} max={1} onChange={(rainStrength) => onChange({ rainStrength })} />
      <p className="field-hint">Current &gt; 0 makes a river: the surface flows and dynamic bodies drift along the angle. Floating bodies ride the visible crest and tilt with the waves.</p>
      <p className="field-hint">Use a box/cube scale for the volume size. Dynamic bodies inside float and bob; characters enter swimming mode.</p>
      <button className="full-button" onClick={onToggle}>Remove Water Volume</button>
    </InspectorSection>
  );
}

function FractureSection({ objectId, fracture }: { objectId: string; fracture?: import('../types').FractureComponent }) {
  const setObjectFracture = useEditorStore((state) => state.setObjectFracture);

  if (!fracture?.enabled) {
    return (
      <InspectorSection title="Destructible">
        <p className="field-hint">
          Make this object shatter into physics pieces — automatically when it takes a hard hit or is destroyed by
          damage, or from the "Fracture" Blueprint node.
        </p>
        <button className="full-button" onClick={() => setObjectFracture(objectId, { enabled: true })}>
          Make Destructible
        </button>
      </InspectorSection>
    );
  }

  const isGrid = fracture.pattern === 'uniform';
  return (
    <InspectorSection title="Destructible">
      <label className="field-row">
        <span>Pattern</span>
        <select value={fracture.pattern} onChange={(e) => setObjectFracture(objectId, { pattern: e.target.value as import('../types').FracturePattern })}>
          <option value="uniform">Uniform grid (boxes)</option>
          <option value="chunks">Chunks (big shards)</option>
          <option value="shatter">Shatter (small shards)</option>
        </select>
      </label>
      <label className="field-row">
        <span>Detail / count</span>
        <NumberInput value={fracture.pieces} min={2} max={6} step={1} onChange={(v) => setObjectFracture(objectId, { pieces: Math.round(v) })} />
      </label>
      {!isGrid && (
        <>
          <RangeField label="Irregularity" value={fracture.jitter} onChange={(jitter) => setObjectFracture(objectId, { jitter })} />
          <label className="field-row">
            <span>Seed</span>
            <NumberInput value={fracture.seed} min={1} step={1} onChange={(v) => setObjectFracture(objectId, { seed: Math.round(v) })} />
          </label>
          <label className="field-row">
            <span>Small near impact</span>
            <input type="checkbox" checked={fracture.focusImpact} onChange={(e) => setObjectFracture(objectId, { focusImpact: e.target.checked })} />
          </label>
        </>
      )}
      <label className="field-row">
        <span>Burst force</span>
        <NumberInput value={fracture.strength} min={0} step={0.5} onChange={(v) => setObjectFracture(objectId, { strength: v })} />
      </label>
      <label className="field-row">
        <span>Break on impact</span>
        <NumberInput value={fracture.impactThreshold} min={0} step={0.5} onChange={(v) => setObjectFracture(objectId, { impactThreshold: v })} />
      </label>
      <p className="field-hint">
        Break on impact = hit speed (units/sec) that auto-shatters it; 0 = only when destroyed by damage or a Fracture
        node. Needs physics enabled to be hit. {isGrid ? `${fracture.pieces ** 3} pieces.` : 'Change Seed for a different-looking break.'}
      </p>
      <button className="full-button" onClick={() => setObjectFracture(objectId, { enabled: false })}>
        Not Destructible
      </button>
    </InspectorSection>
  );
}

export function InspectorPanel() {
  // Structural subscription to the selected object: a SELECTED moving actor must not re-render the
  // whole Inspector every Play tick (its transform readout freezes during Play; edit mode is live).
  const selectedSig = useEditorStore((state) => {
    const selected = state.selectedObject();
    return selected ? `${selected.id}:${objectToken(selected, state.isPlaying)}` : '';
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const object = useMemo(() => useEditorStore.getState().selectedObject(), [selectedSig]);
  const renameObject = useEditorStore((state) => state.renameObject);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const updateRenderer = useEditorStore((state) => state.updateRenderer);
  const setObjectModel = useEditorStore((state) => state.setObjectModel);
  const setObjectMaterial = useEditorStore((state) => state.setObjectMaterial);
  const setObjectMaterialSlot = useEditorStore((state) => state.setObjectMaterialSlot);
  const updateTerrain = useEditorStore((state) => state.updateTerrain);
  const setActiveMaterial = useEditorStore((state) => state.setActiveMaterial);
  const materials = useEditorStore((state) => state.materials);
  const assets = useEditorStore((state) => state.assets);
  const updatePhysics = useEditorStore((state) => state.updatePhysics);
  const togglePhysics = useEditorStore((state) => state.togglePhysics);
  const updateWater = useEditorStore((state) => state.updateWater);
  const toggleWater = useEditorStore((state) => state.toggleWater);
  const addJoint = useEditorStore((state) => state.addJoint);
  const updateJoint = useEditorStore((state) => state.updateJoint);
  const removeJoint = useEditorStore((state) => state.removeJoint);
  const addCloth = useEditorStore((state) => state.addCloth);
  const updateCloth = useEditorStore((state) => state.updateCloth);
  const removeCloth = useEditorStore((state) => state.removeCloth);
  const addCable = useEditorStore((state) => state.addCable);
  const updateCable = useEditorStore((state) => state.updateCable);
  const removeCable = useEditorStore((state) => state.removeCable);
  // Structurally-stable list: motion during Play must not re-render the whole Inspector 60×/s.
  const sceneObjects = useStableActiveObjects();
  const toggleAnimator = useEditorStore((state) => state.toggleAnimator);
  const updateAnimator = useEditorStore((state) => state.updateAnimator);
  const toggleCharacterController = useEditorStore((state) => state.toggleCharacterController);
  const updateCharacterController = useEditorStore((state) => state.updateCharacterController);
  const setVehicleEnabled = useEditorStore((state) => state.setVehicleEnabled);
  const updateVehicle = useEditorStore((state) => state.updateVehicle);
  const setObjectLight = useEditorStore((state) => state.setObjectLight);
  const skeletalMeshes = useEditorStore((state) => state.skeletalMeshes);
  const animations = useEditorStore((state) => state.animations);
  const animatorControllers = useEditorStore((state) => state.animatorControllers);
  const setObjectAnimatorController = useEditorStore((state) => state.setObjectAnimatorController);
  const setActiveAnimatorController = useEditorStore((state) => state.setActiveAnimatorController);
  // Subscribe to the selected object's live animator STATE ID (a primitive) rather than the whole
  // runtimeAnimators record — that record is replaced every Play tick and re-rendered this panel 60×/s.
  const liveAnimStateId = useEditorStore((state) => (object ? state.runtimeAnimators[object.id]?.stateId : undefined));
  const attachScript = useEditorStore((state) => state.attachScript);
  const detachScript = useEditorStore((state) => state.detachScript);
  const blueprints = useEditorStore((state) => state.blueprints);
  const setActiveBlueprint = useEditorStore((state) => state.setActiveBlueprint);

  const modelAssets = useMemo(() => assets.filter((asset) => asset.type === 'model'), [assets]);
  const imageAssets = useMemo(() => assets.filter((asset) => asset.type === 'image'), [assets]);
  const animatorModelUrl = useAssetUrl(object?.renderer?.modelAssetId);
  // The Skeletal Mesh asset (if any) for the assigned model, and the clips compatible with its skeleton.
  const animatorMeshAsset = useMemo(
    () =>
      object?.renderer?.modelAssetId
        ? skeletalMeshes.find((mesh) => mesh.sourceAssetId === object.renderer!.modelAssetId)
        : undefined,
    [skeletalMeshes, object?.renderer?.modelAssetId],
  );
  const compatibleAnimations = useMemo(
    () => (animatorMeshAsset ? animations.filter((anim) => anim.skeletonId === animatorMeshAsset.skeletonId) : []),
    [animations, animatorMeshAsset],
  );
  // Controllers usable on this mesh: skeleton-matched, or skeleton-agnostic (no skeletonId set).
  const compatibleControllers = useMemo(
    () =>
      animatorMeshAsset
        ? animatorControllers.filter((c) => !c.skeletonId || c.skeletonId === animatorMeshAsset.skeletonId)
        : [],
    [animatorControllers, animatorMeshAsset],
  );
  // Live state name for the selected object's running controller (Play-mode readout).
  const liveStateName = useMemo(() => {
    if (!object?.animator?.controllerId) return undefined;
    const controller = animatorControllers.find((c) => c.id === object.animator!.controllerId);
    return controller?.states.find((s) => s.id === liveAnimStateId)?.name;
  }, [object, animatorControllers, liveAnimStateId]);

  const transformValues = useMemo(
    () =>
      object
        ? (Object.keys(object.transform) as Array<keyof TransformComponent>).map((field) => ({
            field,
            label: field[0].toUpperCase() + field.slice(1),
            value: object.transform[field],
          }))
        : [],
    [object],
  );

  return (
    <aside className="panel inspector-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Object</span>
          <h2>Inspector</h2>
        </div>
        <Settings2 size={18} aria-hidden />
      </div>

      {!object ? (
        <div className="inspector-content">
          <div className="empty-state">
            <MousePointer2 size={20} aria-hidden />
            <span>No object selected</span>
            <small>Click an object in the Hierarchy or viewport to edit it — or use <strong>+ Add</strong> in the toolbar to create one. Scene-wide settings are below.</small>
          </div>
          <RenderSettingsSection />
        </div>
      ) : (
        <div className="inspector-content">
          <section className="inspector-section title-section">
            <input className="name-input" value={object.name} onChange={(event) => renameObject(object.id, event.target.value)} />
            <span className="kind-label">{object.kind}</span>
          </section>

          <InspectorSection title="Transform">
            {transformValues.map(({ field, label, value }) => (
              <VectorField
                key={field}
                label={label}
                value={value}
                rotation={field === 'rotation'}
                // Scale needs fine control — some imported GLBs carry a 100× baked scale, so usable
                // values are tiny (e.g. ~0.0015). 4 decimals + a small step make those representable.
                step={field === 'scale' ? 0.001 : undefined}
                precision={field === 'scale' ? 4 : undefined}
                onChange={(nextValue) => updateTransform(object.id, field, nextValue)}
              />
            ))}
          </InspectorSection>

          {object.kind === 'light' && (
            <LightSection light={object.light} onChange={(patch) => setObjectLight(object.id, patch)} />
          )}

          {object.terrain && (
            <TerrainSection terrain={object.terrain} onChange={(patch) => updateTerrain(object.id, patch)} />
          )}

          {object.renderer && (
            <RendererSection
              renderer={object.renderer}
              defaultHideInPlay={object.physics?.isTrigger}
              modelAssets={modelAssets}
              imageAssets={imageAssets}
              materials={materials}
              onChange={(patch) => updateRenderer(object.id, patch)}
              onModelChange={(assetId) => setObjectModel(object.id, assetId)}
              onMaterialChange={(materialId) => setObjectMaterial(object.id, materialId)}
              onSlotMaterialChange={(slotIndex, materialId) => setObjectMaterialSlot(object.id, slotIndex, materialId)}
              onEditMaterial={(materialId) => {
                setActiveMaterial(materialId);
                focusWorkspacePanel('materials');
              }}
            />
          )}

          {object.renderer && (
            <AnimatorSection
              objectId={object.id}
              animator={object.animator}
              modelUrl={animatorModelUrl}
              meshAsset={animatorMeshAsset}
              compatibleAnimations={compatibleAnimations}
              controllers={compatibleControllers}
              liveStateName={liveStateName}
              onToggle={() => toggleAnimator(object.id)}
              onChange={(patch) => updateAnimator(object.id, patch)}
              onControllerChange={(controllerId) => setObjectAnimatorController(object.id, controllerId)}
              onEditController={() => {
                if (object.animator?.controllerId) setActiveAnimatorController(object.animator.controllerId);
                focusWorkspacePanel('animator');
              }}
            />
          )}

          <CharacterSection
            objectId={object.id}
            character={object.character}
            onToggle={() => toggleCharacterController(object.id)}
            onChange={(patch) => updateCharacterController(object.id, patch)}
          />

          <VehicleSection
            objectId={object.id}
            vehicle={object.vehicle}
            onToggle={() => setVehicleEnabled(object.id)}
            onChange={(patch) => updateVehicle(object.id, patch)}
          />

          <AttachmentSection objectId={object.id} />

          <UISection objectId={object.id} />

          <WaterSection
            water={object.water}
            onToggle={() => toggleWater(object.id)}
            onChange={(patch) => updateWater(object.id, patch)}
          />

          {object.physics ? (
            <PhysicsSection physics={object.physics} onChange={(patch) => updatePhysics(object.id, patch)} />
          ) : (
            <InspectorSection title="Physics">
              <p className="field-hint">Static = an immovable wall/floor with collision (doesn’t fall). Dynamic = simulated (falls, gets pushed).</p>
              <button
                className="full-button"
                onClick={() => {
                  togglePhysics(object.id);
                  updatePhysics(object.id, { bodyType: 'fixed' });
                }}
              >
                Add Static Collision
              </button>
              <button
                className="full-button"
                onClick={() => {
                  togglePhysics(object.id);
                  updatePhysics(object.id, { bodyType: 'dynamic' });
                }}
              >
                Add Dynamic Body
              </button>
            </InspectorSection>
          )}

          <JointSection
            joint={object.joint}
            objectId={object.id}
            sceneObjects={sceneObjects}
            onAdd={() => addJoint(object.id)}
            onChange={(patch) => updateJoint(object.id, patch)}
            onRemove={() => removeJoint(object.id)}
          />

          <ClothSection
            cloth={object.cloth}
            modelAssets={modelAssets}
            onAdd={() => addCloth(object.id)}
            onChange={(patch) => updateCloth(object.id, patch)}
            onRemove={() => removeCloth(object.id)}
          />

          <CableSection
            cable={object.cable}
            objectId={object.id}
            sceneObjects={sceneObjects}
            onAdd={() => addCable(object.id)}
            onChange={(patch) => updateCable(object.id, patch)}
            onRemove={() => removeCable(object.id)}
          />

          {object.renderer && object.kind !== 'terrain' && (
            <FractureSection objectId={object.id} fracture={object.fracture} />
          )}

          <ParticleSection objectId={object.id} particles={object.particles} imageAssets={imageAssets} />

          <InspectorSection title="Scripts">
            <label className="field-row">
              <span>Blueprint</span>
              <select
                value={object.script?.blueprintId ?? ''}
                onChange={(event) => {
                  if (!event.target.value) {
                    detachScript(object.id);
                    return;
                  }

                  attachScript(object.id, event.target.value);
                }}
              >
                <option value="">None</option>
                {blueprints.map((blueprint) => (
                  <option key={blueprint.id} value={blueprint.id}>
                    {blueprint.name}
                  </option>
                ))}
              </select>
            </label>
            {object.script && (
              <div className="script-card">
                <div>
                  <Link2 size={14} aria-hidden />
                  <span>{blueprints.find((blueprint) => blueprint.id === object.script?.blueprintId)?.name}</span>
                </div>
                <p>Reusable Blueprint instance attached to this object.</p>
                <div className="script-actions">
                  <button onClick={() => setActiveBlueprint(object.script!.blueprintId)}>Edit</button>
                  <button onClick={() => detachScript(object.id)}>
                    <Unlink size={13} aria-hidden />
                    Detach
                  </button>
                </div>
              </div>
            )}
          </InspectorSection>
        </div>
      )}
    </aside>
  );
}
