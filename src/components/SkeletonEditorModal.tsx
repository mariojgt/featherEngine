import { Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Plus, Trash2, X } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { SkeletonBones } from './SkeletonView';

/**
 * Unreal-style Skeleton editor: opens a skeleton asset in 3D and manages reusable named sockets.
 * Click a bone in the view, then "Add socket here" to create a socket attachments can target by name.
 */
export function SkeletonEditorModal({ skeletonId, onClose }: { skeletonId: string; onClose: () => void }) {
  const skeletons = useEditorStore((state) => state.skeletons);
  const assets = useEditorStore((state) => state.assets);
  const addSkeletonSocket = useEditorStore((state) => state.addSkeletonSocket);
  const updateSkeletonSocket = useEditorStore((state) => state.updateSkeletonSocket);
  const removeSkeletonSocket = useEditorStore((state) => state.removeSkeletonSocket);
  const [selectedBone, setSelectedBone] = useState<string>();

  const skeleton = skeletons.find((s) => s.id === skeletonId);
  const url = assets.find((a) => a.id === skeleton?.sourceAssetId)?.url;
  if (!skeleton) return null;
  const sockets = skeleton.sockets ?? [];

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

  return createPortal(
    <div className="socket-backdrop" onPointerDown={onClose}>
      <div className="socket-dialog wide" onPointerDown={(event) => event.stopPropagation()}>
        <div className="socket-head">
          <strong>Skeleton · {skeleton.name}</strong>
          <button className="icon-button compact" onClick={onClose} title="Close">
            <X size={15} aria-hidden />
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
                  <SkeletonBones url={url} selected={selectedBone} onSelect={setSelectedBone} />
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
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
                <span className="field-hint">on {socket.boneName}</span>
                <div className="socket-offset">
                  {offsetField(socket.id, 0, socket.position[0])}
                  {offsetField(socket.id, 1, socket.position[1])}
                  {offsetField(socket.id, 2, socket.position[2])}
                </div>
              </div>
            ))}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
