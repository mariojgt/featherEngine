import { useEffect, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useAssetUrl } from './ModelAsset';
import { DRACO_DECODER_PATH, extendGLTFLoader } from './gltfDecoders';
import { AuthoredTrees } from './AuthoredTrees';
import { GROUND_COVER_KINDS, type GroundCoverKind, type GroundCoverMatrices } from '../terrain/woodland';

const LODS: Record<GroundCoverKind, readonly [number, number]> = { fern: [9, 22], rock: [14, 32], wood: [18, 38] };
const FADE: Record<GroundCoverKind, readonly [number, number]> = { fern: [30, 48], rock: [50, 75], wood: [50, 75] };
interface Props { assetId?: string; matrices: GroundCoverMatrices; windVec: [number,number,number]; turbulence: number; windStrength: number }
export function WoodlandGroundCover(props: Props) {
  const url = useAssetUrl(props.assetId), [requested, setRequested] = useState<string>();
  useEffect(() => { if (url) { useGLTF.preload(url, DRACO_DECODER_PATH, true, extendGLTFLoader); setRequested(url); } }, [url]);
  return url && requested === url ? <LoadedGroundCover {...props} url={url} /> : null;
}
function LoadedGroundCover({ url, matrices, windVec, turbulence, windStrength }: Props & { url: string }) {
  const { scene } = useGLTF(url, DRACO_DECODER_PATH, true, extendGLTFLoader);
  const groups = useMemo(() => {
    const result = { fern: new THREE.Group(), rock: new THREE.Group(), wood: new THREE.Group() };
    for (const kind of GROUND_COVER_KINDS) result[kind].userData.featherTreeLibrary = true;
    // Clone nodes only: loader-owned geometry/textures stay shared, materials are owned by AuthoredTrees.
    for (const node of scene.children) {
      const kind = node.userData.featherGroundCoverKind as GroundCoverKind;
      if (GROUND_COVER_KINDS.includes(kind)) result[kind].add(node.clone(true));
    }
    return result;
  }, [scene]);
  return <>{GROUND_COVER_KINDS.map(kind => <group key={kind} userData={{ nfGroundCover: kind }}>
    <AuthoredTrees scene={groups[kind]} matrices={matrices[kind]} limit={1400} lodDistances={LODS[kind]} fadeDistance={FADE[kind]}
      windVec={windVec} turbulence={turbulence} windStrength={kind === 'fern' ? windStrength*.35 : 0} />
  </group>)}</>;
}
