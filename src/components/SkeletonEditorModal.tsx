import { Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Plus, Trash2, Wand2, X } from 'lucide-react';
import { useEditorStore, defaultRagdollSettings } from '../store/editorStore';
import { SkeletonBones } from './SkeletonView';
import type { RagdollBodyShape } from '../types';

/**
 * Unreal-style Skeleton editor: opens a skeleton asset in 3D and manages reusable named sockets +
 * an Unreal-PhAT-style per-bone physics ragdoll (pick a bone, set its collision shape / size / mass).
 * Click a bone in the view, then add a socket or a ragdoll body for it.
 */
export function SkeletonEditorModal({ skeletonId, onClose }: { skeletonId: string; onClose: () => void }) {
  const skeletons = useEditorStore((state) => state.skeletons);
  const assets = useEditorStore((state) => state.assets);
  const addSkeletonSocket = useEditorStore((state) => state.addSkeletonSocket);
  const updateSkeletonSocket = useEditorStore((state) => state.updateSkeletonSocket);
  const removeSkeletonSocket = useEditorStore((state) => state.removeSkeletonSocket);
  const updateSkeletonRagdoll = useEditorStore((state) => state.updateSkeletonRagdoll);
  const setRagdollBody = useEditorStore((state) => state.setRagdollBody);
  const removeRagdollBody = useEditorStore((state) => state.removeRagdollBody);
  const generateRagdollBodies = useEditorStore((state) => state.generateRagdollBodies);
  const [selectedBone, setSelectedBone] = useState<string>();

  const skeleton = skeletons.find((s) => s.id === skeletonId);
  const url = assets.find((a) => a.id === skeleton?.sourceAssetId)?.url;
  if (!skeleton) return null;
  const sockets = skeleton.sockets ?? [];
  const ragdoll = { ...defaultRagdollSettings(), ...skeleton.ragdoll };
  const bodies = ragdoll.bodies ?? [];
  const selectedBody = selectedBone ? bodies.find((b) => b.boneName === selectedBone) : undefined;

  const bodySlider = (label: string, key: 'radius' | 'length' | 'density' | 'linearDamping' | 'angularDamping', min: number, max: number, step: number, fallback: number) => {
    if (!selectedBone) return null;
    const value = selectedBody?.[key] ?? fallback;
    return (
      <label className="ragdoll-field">
        <span className="ragdoll-field-label">
          {label}
          <em>{value.toFixed(step < 0.1 ? 2 : 1)}</em>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => setRagdollBody(skeletonId, selectedBone, { [key]: Number(event.target.value) })}
        />
      </label>
    );
  };

  const ragdollSlider = (
    label: string,
    key: 'capsuleRadius' | 'density' | 'linearDamping' | 'angularDamping' | 'groundY',
    min: number,
    max: number,
    step: number,
    hint: string,
  ) => (
    <label className="ragdoll-field">
      <span className="ragdoll-field-label">
        {label}
        <em>{ragdoll[key].toFixed(step < 0.1 ? 2 : 1)}</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={ragdoll[key]}
        onChange={(event) => updateSkeletonRagdoll(skeletonId, { [key]: Number(event.target.value) })}
      />
      <span className="field-hint">{hint}</span>
    </label>
  );

  const offsetField = (socketId: string, axis: 0 | 1 | 2, value: number) => (
    <input
      type="number"
      step={0.05}
      value={value}
      onChange={(event) => {
        const socket = sockets.find((s) => s.id === socketId);
        if (!socket) return;
        const position = [...socket.position] as [number, number, number];
        position[axis] = Number(event.target.value);
        updateSkeletonSocket(skeletonId, socketId, { position });
      }}
    />
  );

  // Rotation shown/edited in DEGREES (stored as radians) — this is what aligns a weapon's grip in the hand.
  const rotationField = (socketId: string, axis: 0 | 1 | 2, radians: number) => (
    <input
      type="number"
      step={15}
      value={Math.round((radians * 180) / Math.PI)}
      onChange={(event) => {
        const socket = sockets.find((s) => s.id === socketId);
        if (!socket) return;
        const rotation = [...(socket.rotation ?? [0, 0, 0])] as [number, number, number];
        rotation[axis] = (Number(event.target.value) * Math.PI) / 180;
        updateSkeletonSocket(skeletonId, socketId, { rotation });
      }}
    />
  );

  return createPortal(
    <div className="socket-backdrop" onPointerDown={onClose}>
      <div className="socket-dialog wide" onPointerDown={(event) => event.stopPropagation()}>
        <div className="socket-head">
          <strong>Skeleton · {skeleton.name}</strong>
          <button className="icon-button compact" onClick={onClose} title="Close">
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="socket-body">
          <div className="socket-canvas">
            {url ? (
              <Canvas camera={{ position: [0, 1.3, 3], fov: 42 }}>
                <color attach="background" args={['#0F1117']} />
                <ambientLight intensity={0.85} />
                <directionalLight position={[3, 5, 2]} intensity={1} />
                <Suspense fallback={null}>
                  <SkeletonBones url={url} selected={selectedBone} onSelect={setSelectedBone} bodies={bodies} />
                </Suspense>
                <OrbitControls target={[0, 1, 0]} enableDamping dampingFactor={0.08} />
              </Canvas>
            ) : (
              <div className="empty-state wide">Skeleton model not loaded.</div>
            )}
          </div>
          <aside className="socket-side">
            <div className="animator-section-head">
              <h3>Sockets</h3>
              <button
                className="icon-button compact"
                disabled={!selectedBone}
                title="Add a socket at the selected bone"
                onClick={() => selectedBone && addSkeletonSocket(skeletonId, { boneName: selectedBone })}
              >
                <Plus size={14} aria-hidden />
              </button>
            </div>
            <p className="field-hint">Selected bone: {selectedBone ?? '— click a marker'}</p>
            {sockets.length === 0 && <p className="field-hint">No sockets yet. Click a bone, then +.</p>}
            {sockets.map((socket) => (
              <div key={socket.id} className="socket-item">
                <div className="animator-row">
                  <input className="animator-name" value={socket.name} onChange={(event) => updateSkeletonSocket(skeletonId, socket.id, { name: event.target.value })} />
                  <button className="icon-button compact danger" title="Delete socket" onClick={() => removeSkeletonSocket(skeletonId, socket.id)}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
                <span className="field-hint">on {socket.boneName}</span>
                <span className="field-hint">Offset (X Y Z)</span>
                <div className="socket-offset">
                  {offsetField(socket.id, 0, socket.position[0])}
                  {offsetField(socket.id, 1, socket.position[1])}
                  {offsetField(socket.id, 2, socket.position[2])}
                </div>
                <span className="field-hint">Rotation° (X Y Z)</span>
                <div className="socket-offset">
                  {rotationField(socket.id, 0, socket.rotation?.[0] ?? 0)}
                  {rotationField(socket.id, 1, socket.rotation?.[1] ?? 0)}
                  {rotationField(socket.id, 2, socket.rotation?.[2] ?? 0)}
                </div>
              </div>
            ))}

            <div className="animator-section-head" style={{ marginTop: 16 }}>
              <h3>Ragdoll Bodies</h3>
              <button
                className="icon-button compact"
                title="Auto-generate a capsule body for every simulated bone"
                onClick={() => generateRagdollBodies(skeletonId)}
              >
                <Wand2 size={14} aria-hidden />
              </button>
            </div>
            <p className="field-hint">
              Unreal-style per-bone physics. {bodies.length} {bodies.length === 1 ? 'body' : 'bodies'} configured.
              Click a bone, then set its collision shape + size. Wand = auto-generate for all bones.
            </p>

            {selectedBone ? (
              <div className="socket-item">
                <div className="animator-row">
                  <strong style={{ fontSize: 12 }}>{selectedBone}</strong>
                  {selectedBody ? (
                    <button className="icon-button compact danger" title="Remove this bone's body" onClick={() => removeRagdollBody(skeletonId, selectedBone)}>
                      <Trash2 size={14} aria-hidden />
                    </button>
                  ) : (
                    <button className="icon-button compact" title="Add a body for this bone" onClick={() => setRagdollBody(skeletonId, selectedBone, { shape: 'capsule', enabled: true })}>
                      <Plus size={14} aria-hidden />
                    </button>
                  )}
                </div>
                {selectedBody ? (
                  <>
                    <label className="ragdoll-field">
                      <span className="ragdoll-field-label">Simulate</span>
                      <input
                        type="checkbox"
                        checked={selectedBody.enabled !== false}
                        onChange={(event) => setRagdollBody(skeletonId, selectedBone, { enabled: event.target.checked })}
                      />
                    </label>
                    <label className="ragdoll-field">
                      <span className="ragdoll-field-label">Shape</span>
                      <select
                        value={selectedBody.shape ?? 'capsule'}
                        onChange={(event) => setRagdollBody(skeletonId, selectedBone, { shape: event.target.value as RagdollBodyShape })}
                      >
                        <option value="capsule">Capsule</option>
                        <option value="box">Box</option>
                        <option value="sphere">Sphere</option>
                      </select>
                    </label>
                    {bodySlider('Radius', 'radius', 0.02, 0.25, 0.01, ragdoll.capsuleRadius)}
                    {selectedBody.shape !== 'sphere' && bodySlider('Half-length', 'length', 0, 0.5, 0.01, 0)}
                    {bodySlider('Mass density', 'density', 0.2, 5, 0.1, ragdoll.density)}
                    {bodySlider('Linear damping', 'linearDamping', 0, 4, 0.05, ragdoll.linearDamping)}
                    {bodySlider('Joint stiffness', 'angularDamping', 0, 6, 0.05, ragdoll.angularDamping)}
                    <span className="field-hint">Half-length 0 = auto from bone. Stiffness uses angular damping (no hard cone limits in this engine).</span>
                  </>
                ) : (
                  <span className="field-hint">No body on this bone — it uses the defaults below. Click + to override it.</span>
                )}
              </div>
            ) : (
              <p className="field-hint">— click a bone marker to edit its body</p>
            )}

            <div className="animator-section-head" style={{ marginTop: 16 }}>
              <h3>Ragdoll Defaults</h3>
              <button
                className="text-button"
                title="Reset ragdoll tuning to defaults (clears per-bone bodies)"
                onClick={() => updateSkeletonRagdoll(skeletonId, { ...defaultRagdollSettings(), bodies: [] })}
              >
                Reset
              </button>
            </div>
            <p className="field-hint">
              Applied to any bone WITHOUT its own body above. Shared by every character using this skeleton.
              Press Play, trigger a ragdoll (Ragdoll key / Set Ragdoll node / Death state) and tweak live.
            </p>
            {ragdollSlider('Capsule radius', 'capsuleRadius', 0.02, 0.2, 0.01, 'Bone thickness — fatter is more stable / less floppy.')}
            {ragdollSlider('Mass density', 'density', 0.2, 5, 0.1, 'Heavier bodies swing slower and feel weightier.')}
            {ragdollSlider('Linear damping', 'linearDamping', 0, 4, 0.05, 'Higher = less sliding / drifting.')}
            {ragdollSlider('Angular damping', 'angularDamping', 0, 4, 0.05, 'Higher = joints stop spinning sooner (stiffer).')}
            {ragdollSlider('Ground height', 'groundY', -5, 5, 0.1, 'World Y the limp body piles up on.')}
            <label className="ragdoll-field">
              <span className="ragdoll-field-label">Skip bones (regex)</span>
              <input
                type="text"
                value={ragdoll.excludePattern}
                onChange={(event) => updateSkeletonRagdoll(skeletonId, { excludePattern: event.target.value })}
              />
              <span className="field-hint">Bone names matching this aren't simulated (fingers, hair, …).</span>
            </label>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
