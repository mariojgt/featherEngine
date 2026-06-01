import { Link2, Palette, Settings2, Unlink } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { defaultCharacter, useEditorStore } from '../store/editorStore';
import { useAssetUrl } from '../three/ModelAsset';
import { focusWorkspacePanel } from './workspacePanels';
import type { AnimationAsset, AnimatorComponent, AnimatorController, AssetItem, CharacterControllerComponent, MaterialDefinition, MeshRendererComponent, PhysicsComponent, SkeletalMeshAsset, TransformComponent, Vector3Tuple } from '../types';

const axes = ['X', 'Y', 'Z'] as const;

const toDegrees = (value: number) => Math.round((value * 180) / Math.PI);
const toRadians = (value: number) => (value * Math.PI) / 180;

function NumberInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isInteger(value) ? value : Number(value.toFixed(2))}
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
}: {
  label: string;
  value: Vector3Tuple;
  onChange: (value: Vector3Tuple) => void;
  rotation?: boolean;
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
              step={rotation ? 1 : 0.1}
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

function RendererSection({
  renderer,
  modelAssets,
  imageAssets,
  materials,
  onChange,
  onModelChange,
  onMaterialChange,
  onEditMaterial,
}: {
  renderer: MeshRendererComponent;
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
    </>
  );

  return (
    <section className="inspector-section">
      <h3>Renderer</h3>
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
  const { animations } = useGLTF(url);
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

/** Click, then press a key to rebind. Stores the KeyboardEvent.code (e.g. "KeyW", "Space"). */
function KeyBinding({ label, value, onChange }: { label: string; value: string; onChange: (code: string) => void }) {
  const [listening, setListening] = useState(false);
  return (
    <label className="field-row">
      <span>{label}</span>
      <button
        type="button"
        className={listening ? 'key-capture listening' : 'key-capture'}
        onClick={() => setListening(true)}
        onKeyDown={(event) => {
          if (!listening) return;
          event.preventDefault();
          if (event.code !== 'Escape') onChange(event.code);
          setListening(false);
        }}
        onBlur={() => setListening(false)}
      >
        {listening ? 'Press a key…' : value}
      </button>
    </label>
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
  const num = (label: string, key: keyof CharacterControllerComponent, step = 0.1) => (
    <label className="field-row">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Number(cc?.[key] ?? 0)}
        onChange={(event) => onChange({ [key]: Number(event.target.value) } as Partial<CharacterControllerComponent>)}
      />
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
          <p className="field-hint">Feeds the animator’s Speed / VerticalSpeed. Click the view in Play to capture the mouse.</p>
          {num('Move Speed', 'moveSpeed')}
          {num('Sprint ×', 'sprintMultiplier')}
          {num('Crouch ×', 'crouchMultiplier')}
          {num('Jump', 'jumpStrength')}
          {num('Gravity', 'gravity')}
          {num('Turn Speed', 'turnSpeed')}
          {num('Ground Y', 'groundLevel')}
          <label className="field-row">
            <span>Flip Facing 180°</span>
            <input
              type="checkbox"
              checked={Math.abs(cc.modelYawOffset) > 0.01}
              onChange={(event) => onChange({ modelYawOffset: event.target.checked ? Math.PI : 0 })}
            />
          </label>

          <h4 className="inspector-subhead">Controls</h4>
          <KeyBinding label="Forward" value={cc.keyForward} onChange={(keyForward) => onChange({ keyForward })} />
          <KeyBinding label="Back" value={cc.keyBackward} onChange={(keyBackward) => onChange({ keyBackward })} />
          <KeyBinding label="Left" value={cc.keyLeft} onChange={(keyLeft) => onChange({ keyLeft })} />
          <KeyBinding label="Right" value={cc.keyRight} onChange={(keyRight) => onChange({ keyRight })} />
          <KeyBinding label="Jump" value={cc.keyJump} onChange={(keyJump) => onChange({ keyJump })} />
          <KeyBinding label="Sprint" value={cc.keySprint} onChange={(keySprint) => onChange({ keySprint })} />
          <KeyBinding label="Crouch" value={cc.keyCrouch} onChange={(keyCrouch) => onChange({ keyCrouch })} />

          <h4 className="inspector-subhead">Camera</h4>
          <label className="field-row">
            <span>Follow Camera</span>
            <input type="checkbox" checked={cc.cameraFollow} onChange={(event) => onChange({ cameraFollow: event.target.checked })} />
          </label>
          {cc.cameraFollow && (
            <>
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
        </select>
      </label>
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

export function InspectorPanel() {
  const object = useEditorStore((state) => state.selectedObject());
  const renameObject = useEditorStore((state) => state.renameObject);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const updateRenderer = useEditorStore((state) => state.updateRenderer);
  const setObjectModel = useEditorStore((state) => state.setObjectModel);
  const setObjectMaterial = useEditorStore((state) => state.setObjectMaterial);
  const setActiveMaterial = useEditorStore((state) => state.setActiveMaterial);
  const materials = useEditorStore((state) => state.materials);
  const assets = useEditorStore((state) => state.assets);
  const updatePhysics = useEditorStore((state) => state.updatePhysics);
  const togglePhysics = useEditorStore((state) => state.togglePhysics);
  const toggleAnimator = useEditorStore((state) => state.toggleAnimator);
  const updateAnimator = useEditorStore((state) => state.updateAnimator);
  const toggleCharacterController = useEditorStore((state) => state.toggleCharacterController);
  const updateCharacterController = useEditorStore((state) => state.updateCharacterController);
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
        <div className="empty-state">No object selected</div>
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
                onChange={(nextValue) => updateTransform(object.id, field, nextValue)}
              />
            ))}
          </section>

          {object.renderer && (
            <RendererSection
              renderer={object.renderer}
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
