import { Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { X } from 'lucide-react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { SkeletonBones } from './SkeletonView';

/**
 * A modal that opens a character's skeleton in 3D so you can click a bone to use as an attachment
 * socket. Shows bone lines (SkeletonHelper) + a clickable marker per bone; pick confirms the bone.
 */
export function SocketPickerModal({
  targetObjectId,
  value,
  onPick,
  onClose,
}: {
  targetObjectId: string;
  value?: string;
  onPick: (boneName: string) => void;
  onClose: () => void;
}) {
  const assets = useEditorStore((state) => state.assets);
  const objects = useEditorStore(selectActiveObjects);
  const modelAssetId = objects.find((o) => o.id === targetObjectId)?.renderer?.modelAssetId;
  const url = assets.find((a) => a.id === modelAssetId)?.url;
  const [selected, setSelected] = useState(value);

  return createPortal(
    <div className="socket-backdrop" onPointerDown={onClose}>
      <div className="socket-dialog" onPointerDown={(event) => event.stopPropagation()}>
        <div className="socket-head">
          <strong>Pick a bone socket</strong>
          <button className="icon-button compact" onClick={onClose} title="Close">
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="socket-canvas">
          {url ? (
            <Canvas camera={{ position: [0, 1.3, 3], fov: 42 }}>
              <color attach="background" args={['#0F1117']} />
              <ambientLight intensity={0.85} />
              <directionalLight position={[3, 5, 2]} intensity={1} />
              <Suspense fallback={null}>
                <SkeletonBones url={url} selected={selected} onSelect={setSelected} />
              </Suspense>
              <OrbitControls target={[0, 1, 0]} enableDamping dampingFactor={0.08} />
            </Canvas>
          ) : (
            <div className="empty-state wide">This object has no loaded skinned model.</div>
          )}
        </div>
        <div className="socket-foot">
          <span className="socket-selected">{selected ?? 'Click a bone marker…'}</span>
          <button className="full-button" disabled={!selected} onClick={() => selected && onPick(selected)}>
            Use this bone
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
