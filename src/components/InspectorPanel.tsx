import { Link2, Palette, Settings2, Unlink } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { defaultCharacter, defaultLight, defaultVehicle, selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useAssetUrl } from '../three/ModelAsset';
import { DRACO_DECODER_PATH, extendGLTFLoader } from '../three/gltfDecoders';
import { focusWorkspacePanel } from './workspacePanels';
import { SocketPickerModal } from './SocketPickerModal';
import type { AnimationAsset, AnimatorComponent, AnimatorController, AssetItem, CharacterControllerComponent, LightComponent, MaterialDefinition, MeshRendererComponent, ParticleEmitterShape, ParticleSystemComponent, PhysicsComponent, SkeletalMeshAsset, TerrainComponent, TransformComponent, Vector3Tuple, VehicleComponent } from '../types';
import { particlePresetIds } from '../runtime/particlePresets';
import { withTerrainDefaults } from '../terrain/terrain';

const axes = ['X', 'Y', 'Z'] as const;

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
  onEditMaterial: (materialId: string) => void;
}) {
  const usingModel = Boolean(renderer.modelAssetId);
  const usingMaterial = Boolean(renderer.materialId && materials.some((m) => m.id === renderer.materialId));
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
    <section className="inspector-section">
      <h3>Renderer</h3>
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
    </section>
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
    <section className="inspector-section">
      <h3>Animation</h3>
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
    </section>
  );
}

/** Attach this object to a bone "socket" of a skinned character — its Transform becomes the offset. */
function AttachmentSection({ objectId }: { objectId: string }) {
  // Structural-signature subscription (like HierarchyPanel): this section reads only object
  // identity/name/model/attachment — never per-frame transforms — so it must NOT re-render 60×/s
  // during Play off the raw objects array. Re-derive the list only when that structure changes.
  const objectsSig = useEditorStore((state) =>
    selectActiveObjects(state)
      .map((o) => `${o.id}~${o.name}~${o.renderer?.modelAssetId ?? ''}~${o.attachment?.targetObjectId ?? ''}~${o.attachment?.boneName ?? ''}`)
      .join('|'),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sceneObjects = useMemo(() => selectActiveObjects(useEditorStore.getState()), [objectsSig]);
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
    <section className="inspector-section">
      <h3>Attachment (bone socket)</h3>
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
    </section>
  );
}

/** World-space UI (a widget anchored over this object) + per-instance variables for `self.*` bindings. */
function UISection({ objectId }: { objectId: string }) {
  const object = useEditorStore((state) => selectActiveObjects(state).find((o) => o.id === objectId));
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
    <section className="inspector-section">
      <h3>UI (world widget)</h3>
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
    </section>
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
  vehicle,
  onToggle,
  onChange,
}: {
  vehicle: VehicleComponent | undefined;
  onToggle: () => void;
  onChange: (patch: Partial<VehicleComponent>) => void;
}) {
  const v = vehicle ? { ...defaultVehicle(), ...vehicle } : undefined;
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
    <section className="inspector-section">
      <h3>Vehicle Controller</h3>
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={v?.enabled ?? false} onChange={onToggle} />
      </label>
      {v && v.enabled && (
        <>
          <p className="field-hint">W accelerate · S brake/reverse · A/D steer · Space handbrake (drift) · H horn · Mouse look. The body should be a dynamic, convex-collider Rapier body.</p>

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
    </section>
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
    <section className="inspector-section">
      <h3>Character Controller</h3>
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
          <p className="field-hint">
            Higher Accel/Decel = snappier starts &amp; stops. Fall Multiplier &gt;1 makes the jump less floaty; Jump Cut
            shortens a tapped jump; Coyote Time lets you jump just after leaving a ledge.
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

          <h4 className="inspector-subhead">Roll / Dodge</h4>
          {num('Roll Speed', 'rollSpeed')}
          {num('Roll Duration', 'rollDuration', 0.05)}
          <p className="field-hint">Roll distance ≈ {(cc.rollSpeed * cc.rollDuration).toFixed(1)} units (speed × duration).</p>

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
    </section>
  );
}

/** Light tuning for a `kind: 'light'` object — point / spot / directional. */
function LightSection({ light, onChange }: { light: LightComponent | undefined; onChange: (patch: Partial<LightComponent>) => void }) {
  const l = { ...defaultLight(), ...light };
  return (
    <section className="inspector-section">
      <h3>Light</h3>
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
    </section>
  );
}

/** Project-wide post-processing (bloom + vignette). Shown when nothing is selected (a "world" setting). */
function RenderSettingsSection() {
  const rs = useEditorStore((state) => state.renderSettings);
  const update = useEditorStore((state) => state.updateRenderSettings);
  return (
    <section className="inspector-section">
      <h3>Post-Processing</h3>
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
    </section>
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
      <section className="inspector-section">
        <h3>Particles</h3>
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
      </section>
    );
  }

  const onChange = (patch: Partial<ParticleSystemComponent>) => updateParticles(objectId, patch);

  // Referencing a reusable asset — the asset's config wins, so edit it in the Particle System panel.
  if (particles.systemId) {
    const asset = particleSystems.find((p) => p.id === particles.systemId);
    return (
      <section className="inspector-section">
        <h3>Particles</h3>
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
      </section>
    );
  }

  return (
    <section className="inspector-section">
      <h3>Particles</h3>
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
    </section>
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
    <section className="inspector-section">
      <h3>Terrain</h3>
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
    </section>
  );
}

function PhysicsSection({
  physics,
  onChange,
}: {
  physics: PhysicsComponent;
  onChange: (patch: Partial<PhysicsComponent>) => void;
}) {
  return (
    <section className="inspector-section">
      <h3>Physics</h3>
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
      <RangeField label="Friction" value={physics.friction} onChange={(friction) => onChange({ friction })} />
    </section>
  );
}

function FractureSection({ objectId, fracture }: { objectId: string; fracture?: import('../types').FractureComponent }) {
  const setObjectFracture = useEditorStore((state) => state.setObjectFracture);

  if (!fracture?.enabled) {
    return (
      <section className="inspector-section">
        <h3>Destructible</h3>
        <p className="field-hint">
          Make this object shatter into physics pieces — automatically when it takes a hard hit or is destroyed by
          damage, or from the "Fracture" Blueprint node.
        </p>
        <button className="full-button" onClick={() => setObjectFracture(objectId, { enabled: true })}>
          Make Destructible
        </button>
      </section>
    );
  }

  const isGrid = fracture.pattern === 'uniform';
  return (
    <section className="inspector-section">
      <h3>Destructible</h3>
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
    </section>
  );
}

export function InspectorPanel() {
  const object = useEditorStore((state) => state.selectedObject());
  const renameObject = useEditorStore((state) => state.renameObject);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const updateRenderer = useEditorStore((state) => state.updateRenderer);
  const setObjectModel = useEditorStore((state) => state.setObjectModel);
  const setObjectMaterial = useEditorStore((state) => state.setObjectMaterial);
  const updateTerrain = useEditorStore((state) => state.updateTerrain);
  const setActiveMaterial = useEditorStore((state) => state.setActiveMaterial);
  const materials = useEditorStore((state) => state.materials);
  const assets = useEditorStore((state) => state.assets);
  const updatePhysics = useEditorStore((state) => state.updatePhysics);
  const togglePhysics = useEditorStore((state) => state.togglePhysics);
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
  const runtimeAnimators = useEditorStore((state) => state.runtimeAnimators);
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
    const stateId = runtimeAnimators[object.id]?.stateId;
    return controller?.states.find((s) => s.id === stateId)?.name;
  }, [object, animatorControllers, runtimeAnimators]);

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
          <div className="empty-state">No object selected</div>
          <RenderSettingsSection />
        </div>
      ) : (
        <div className="inspector-content">
          <section className="inspector-section title-section">
            <input className="name-input" value={object.name} onChange={(event) => renameObject(object.id, event.target.value)} />
            <span className="kind-label">{object.kind}</span>
          </section>

          <section className="inspector-section">
            <h3>Transform</h3>
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
          </section>

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
            vehicle={object.vehicle}
            onToggle={() => setVehicleEnabled(object.id)}
            onChange={(patch) => updateVehicle(object.id, patch)}
          />

          <AttachmentSection objectId={object.id} />

          <UISection objectId={object.id} />

          {object.physics ? (
            <PhysicsSection physics={object.physics} onChange={(patch) => updatePhysics(object.id, patch)} />
          ) : (
            <section className="inspector-section">
              <h3>Physics</h3>
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
            </section>
          )}

          {object.renderer && object.kind !== 'terrain' && (
            <FractureSection objectId={object.id} fracture={object.fracture} />
          )}

          <ParticleSection objectId={object.id} particles={object.particles} imageAssets={imageAssets} />

          <section className="inspector-section">
            <h3>Scripts</h3>
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
          </section>
        </div>
      )}
    </aside>
  );
}
