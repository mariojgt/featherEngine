import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { TerrainComponent } from '../types';
import { useEditorStore, selectActiveSceneEnvironment } from '../store/editorStore';
import { defaultStylizedGrass, type TerrainChunkKey } from '../terrain/terrain';
import { chunkWithinGrassRange, limitVegetation, VegetationChunkCache, vegetationRegionLimit, vegetationBudget, vegetationChunkSignature, vegetationSignatures, type VegetationChunkData, type VegetationBudget } from '../terrain/vegetationCache';
import type { VegetationGenerationOptions } from '../terrain/vegetation';
import { useAssetUrl } from './ModelAsset';
import { DRACO_DECODER_PATH, extendGLTFLoader } from './gltfDecoders';
import { BLADE_GEOMETRY, GRASS_CROSS_GEOMETRY, TREE_BILLBOARD_GEOMETRY, WindFoliage, WindFoliageImage } from './foliageWind';
import { StylizedGrass } from './stylizedGrass';
import { NaturalGrass } from './NaturalGrass';
import { ScatteredTrees } from './TreeMesh';
import { AuthoredTrees } from './AuthoredTrees';
import { WoodlandGroundCover } from './WoodlandGroundCover';
import { emptyGroundCover, GROUND_COVER_KINDS } from '../terrain/woodland';

const noRaycast = () => null;
function InstancedMatrices({
  matrices,
  children,
}: {
  matrices: THREE.Matrix4[];
  children: ReactNode;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);

  if (matrices.length === 0) return null;
  // Bounding sphere is computed above, so the instanced foliage can frustum-cull when off-screen
  // instead of submitting all (up to thousands of) instances to the vertex shader every frame.
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, matrices.length]} castShadow receiveShadow raycast={noRaycast} userData={{ nfGround: true }}>
      {children}
    </instancedMesh>
  );
}

function FoliageModelInstances({
  assetId,
  matrices,
  limit,
  windVec = [0, 0, 0],
  turbulence = 0,
  windStrength = 0,
}: {
  assetId?: string;
  matrices: THREE.Matrix4[];
  limit: number;
  windVec?: [number, number, number];
  turbulence?: number;
  windStrength?: number;
}) {
  const url = useAssetUrl(assetId);
  const [requestedUrl, setRequestedUrl] = useState<string>();
  useEffect(() => {
    if (!url) return;
    // Start LoadingManager notifications after commit, before the suspending child renders.
    useGLTF.preload(url, DRACO_DECODER_PATH, true, extendGLTFLoader);
    setRequestedUrl(url);
  }, [url]);
  if (!url || requestedUrl !== url || matrices.length === 0) return null;
  return <LoadedFoliageModel url={url} matrices={matrices} limit={limit} windVec={windVec} turbulence={turbulence} windStrength={windStrength} />;
}

// One InstancedMesh per source-mesh of a custom foliage model. The old implementation rendered a
// separate <Clone> (a full scene-graph clone) per placement — up to `limit` clones, each its own
// draw call(s) and cloned materials. Instancing collapses every placement of a given source mesh
// into a single draw call, the same way the built-in foliage path works.
function FoliageInstancedPart({
  geometry,
  material,
  local,
  placements,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  local: THREE.Matrix4;
  placements: THREE.Matrix4[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const composed = new THREE.Matrix4();
    placements.forEach((placement, index) => {
      // placement positions/orients the model; `local` is the mesh's transform within the model.
      composed.multiplyMatrices(placement, local);
      mesh.setMatrixAt(index, composed);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // lets the instanced foliage frustum-cull when off-screen
  }, [placements, local]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, placements.length]}
      castShadow
      receiveShadow
      raycast={noRaycast}
      userData={{ nfGround: true }}
    />
  );
}

function LoadedFoliageModel({
  url,
  matrices,
  limit,
  windVec,
  turbulence,
  windStrength,
}: {
  url: string;
  matrices: THREE.Matrix4[];
  limit: number;
  windVec: [number, number, number];
  turbulence: number;
  windStrength: number;
}) {
  const { scene } = useGLTF(url, DRACO_DECODER_PATH, true, extendGLTFLoader);
  // Flatten the model into (geometry, material, in-model transform) parts to instance.
  const parts = useMemo(() => {
    const collected: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4 }[] = [];
    scene.updateWorldMatrix(true, true);
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      collected.push({ geometry: mesh.geometry, material: mesh.material, matrix: mesh.matrixWorld.clone() });
    });
    return collected;
  }, [scene]);
  const placements = useMemo(() => matrices.slice(0, limit), [matrices, limit]);
  if (scene.userData.featherTreeLibrary === true) {
    return <AuthoredTrees scene={scene} matrices={matrices} limit={limit} windVec={windVec} turbulence={turbulence} windStrength={windStrength} />;
  }
  if (placements.length === 0 || parts.length === 0) return null;
  return (
    <>
      {parts.map((part, index) => (
        <FoliageInstancedPart key={index} geometry={part.geometry} material={part.material} local={part.matrix} placements={placements} />
      ))}
    </>
  );
}

// Built-in 3D tree crown geometries (shared singletons). Matched to the legacy inline-JSX args so
// placement is unchanged; now rendered through the rigid wind-canopy material so they sway with the
// wind and lean away from a passing player (built-in trunks stay planted below them).
const TREE_CROWN_SPHERE = new THREE.SphereGeometry(0.86, 10, 8);
const TREE_CROWN_CONE = new THREE.ConeGeometry(0.9, 1.45, 7);

/**
 * A stylized layered CONIFER / fir crown: stacked cone tiers (widest "skirt" at the base up to a point)
 * merged into ONE geometry, so the whole fir is a single instanced draw. Base at y=0, ~1.12 units tall,
 * ~0.58 base radius. Per-tier uv.y drives the shader's base-dark→tip-bright gradient (each tier's tips
 * catch light like real fir layers), and the rigid wind mode sways the whole crown as one soft mass.
 * This is the tree shape the stylized-nature / BOTW reference look is built around.
 */
function buildFirCrownGeometry(): THREE.BufferGeometry {
  // Five overlapping tiers (widest skirt at the base, narrowing to a point) for a full, soft conifer
  // silhouette. Generous overlap + 12 radial segments keep it round and smooth rather than a facet blob.
  const tiers = [
    { r: 0.62, h: 0.5, y: 0.0 },
    { r: 0.52, h: 0.46, y: 0.22 },
    { r: 0.42, h: 0.44, y: 0.42 },
    { r: 0.3, h: 0.42, y: 0.62 },
    { r: 0.17, h: 0.4, y: 0.82 },
  ];
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  let offset = 0;
  for (const t of tiers) {
    const cone = new THREE.ConeGeometry(t.r, t.h, 12, 1);
    cone.translate(0, t.y + t.h / 2, 0); // ConeGeometry is centered on its own origin → move base to t.y
    const p = cone.getAttribute('position');
    const n = cone.getAttribute('normal');
    const u = cone.getAttribute('uv');
    const idx = cone.getIndex()!;
    for (let i = 0; i < p.count; i += 1) {
      position.push(p.getX(i), p.getY(i), p.getZ(i));
      normal.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    for (let i = 0; i < idx.count; i += 1) index.push(idx.getX(i) + offset);
    offset += p.count;
    cone.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}
const TREE_CROWN_FIR = buildFirCrownGeometry();

const treeCrownGeometry = (style: TerrainComponent['foliage']['treeMesh']) =>
  style === 'fir' ? TREE_CROWN_FIR : style === 'round' ? TREE_CROWN_SPHERE : TREE_CROWN_CONE;

const TerrainFoliageBatch = memo(function TerrainFoliageBatch({ terrain, matrices }: { terrain: TerrainComponent; matrices: VegetationChunkData }) {
  const foliage = terrain.foliage;
  // The global scene wind drives the grass/leaf sway (see foliageWind.tsx) — the same wind that moves
  // cloth and wind-affected bodies. Read it once here and feed every foliage draw call.
  const env = useEditorStore(selectActiveSceneEnvironment);
  const windVec = env?.wind ?? [0, 0, 0];
  const turbulence = env?.windTurbulence ?? 0;
  const windStrength = foliage.windStrength ?? 1;
  // BOTW-style player parting (Tier "interactive vegetation") + soft turf/canopy normals (Tier 7.3).
  const interactStrength = foliage.interactStrength ?? 1;
  const grassLook = foliage.stylizedGrass ?? defaultStylizedGrass();
  const grassFade = grassLook.fadeMode === 'off' ? undefined : { start: grassLook.fadeStart, end: grassLook.fadeEnd };
  const grassSource = foliage.grassSource ?? (foliage.grassModelAssetId ? 'model' : 'builtin');
  const treeSource = foliage.treeSource ?? (foliage.treeModelAssetId ? 'model' : 'builtin');
  // Scattered parametric trees resolve their spec from the project library by id, so the forest and the
  // Tree Builder stay in lockstep with no per-chunk copies to invalidate.
  const treeSpecs = useEditorStore((state) => state.treeSpecs);
  const treeSpec = treeSource === 'builtin' && foliage.treeSpecId
    ? treeSpecs.find((entry) => entry.id === foliage.treeSpecId)
    : undefined;
  const treeGroups = useMemo(() => {
    if (treeSource !== 'builtin') return [];
    const groups = new Map<string, THREE.Matrix4[]>();
    matrices.treeModels.forEach((matrix, i) => {
      const id = matrices.treeSpecies[i] || treeSpec?.id;
      if (!id) return;
      const group = groups.get(id) ?? [];
      group.push(matrix);
      groups.set(id, group);
    });
    return [...groups].flatMap(([id, placements]) => {
      const spec = treeSpecs.find((entry) => entry.id === id);
      return spec ? [{ spec, placements }] : [];
    });
  }, [matrices, treeSpec, treeSpecs, treeSource]);

  return (
    <>
      {grassSource === 'model' ? (
        <FoliageModelInstances assetId={foliage.grassModelAssetId} matrices={matrices.grass} limit={320} />
      ) : grassSource === 'image' && foliage.grassImageAssetId ? (
        <WindFoliageImage
          assetId={foliage.grassImageAssetId}
          geometry={GRASS_CROSS_GEOMETRY}
          fade={grassFade}
          color={foliage.grassColor}
          matrices={matrices.grass}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength}
          normalLift={0.5}
          interactStrength={interactStrength}
        />
      ) : foliage.grassMesh === 'natural' ? (
        <NaturalGrass color={foliage.grassColor} settings={grassLook} matrices={matrices.grass}
          windVec={windVec} turbulence={turbulence} windStrength={windStrength} interactStrength={interactStrength} />
      ) : foliage.grassMesh === 'clump' ? (
        // Built-in default: stylized painted-clump cards (gradient + colour variation + interaction).
        <StylizedGrass
          color={foliage.grassColor}
          settings={foliage.stylizedGrass ?? defaultStylizedGrass()}
          matrices={matrices.grass}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength}
          interactStrength={interactStrength}
        />
      ) : (
        // Simple shapes: a single wind-animated blade (or a cross billboard for the 'cross' style). Color is
        // WHITE because each blade carries its own ground-borrowed per-instance color (so the field melts
        // into the turf); see generateFoliage.
        <WindFoliage
          geometry={foliage.grassMesh === 'cross' ? GRASS_CROSS_GEOMETRY : BLADE_GEOMETRY}
          fade={grassFade}
          color="#ffffff"
          matrices={matrices.grass}
          colors={matrices.grassColors}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength}
          normalLift={0.88}
          interactStrength={interactStrength}
          shadow={false}
          emit={0.62}
        />
      )}

      {/* Wildflowers: small brightly-colored blooms (per-instance colors) scattered through the grass;
          they wind-sway and part around the player exactly like the blades. */}
      {matrices.flowers.length > 0 && (
        <WindFoliage
          geometry={GRASS_CROSS_GEOMETRY}
          fade={grassFade}
          color="#ffffff"
          matrices={matrices.flowers}
          colors={matrices.flowerColors}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength}
          normalLift={0.35}
          interactStrength={interactStrength}
          shadow={false}
        />
      )}

      {treeGroups.length ? (
        <>{treeGroups.map(({ spec, placements }) => <ScatteredTrees key={spec.id} spec={spec} matrices={placements} windStrength={windStrength} interactStrength={interactStrength} turbulence={turbulence} />)}</>
      ) : treeSource === 'model' ? null : treeSource === 'image' && foliage.treeImageAssetId ? (
        // Tree billboards sway gently (mostly the canopy) — softer wind + slower idle flutter than grass.
        <WindFoliageImage
          assetId={foliage.treeImageAssetId}
          geometry={TREE_BILLBOARD_GEOMETRY}
          color={foliage.treeColor}
          matrices={matrices.treeModels}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength * 0.4}
          swaySpeed={1.1}
          baseSway={0.015}
          normalLift={0.35}
          interactStrength={interactStrength * 0.5}
          interactMode={1}
        />
      ) : (
        <>
          <InstancedMatrices matrices={matrices.trunks}>
            <cylinderGeometry args={[0.5, 0.65, 1, 6]} />
            <meshStandardMaterial color={foliage.trunkColor} roughness={0.86} />
          </InstancedMatrices>
          {/* Rigid wind canopy: the whole crown sways as one soft blob and leans away from the player. */}
          <WindFoliage
            geometry={treeCrownGeometry(foliage.treeMesh)}
            color={foliage.treeColor}
            matrices={matrices.crowns}
            windVec={windVec}
            turbulence={turbulence}
            windStrength={windStrength * 0.5}
            swaySpeed={1.0}
            baseSway={0.01}
            normalLift={0.35}
            interactStrength={interactStrength * 0.5}
            interactMode={1}
            rigid
          />
        </>
      )}
    </>
  );
});

interface Region {
  chunk: TerrainChunkKey;
  signature: string;
  options: VegetationGenerationOptions;
  data?: VegetationChunkData;
}

/** Reuse unchanged cells and amortize newly streamed cells across frames. */
export function TerrainFoliage({ terrain, chunks }: { terrain: TerrainComponent; chunks: TerrainChunkKey[] }) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const quality = useEditorStore((state) => state.renderSettings.quality);
  const environment = useEditorStore(selectActiveSceneEnvironment);
  const cache = useRef(new VegetationChunkCache());
  const pending = useRef<{ regions: Region[]; cursor: number; remaining: VegetationBudget }>();
  const [regions, setRegions] = useState<Region[]>([]);
  const signatures = useMemo(() => vegetationSignatures(terrain), [terrain]);
  const budget = useMemo(() => {
    const next = vegetationBudget(quality);
    // Imported models retain conservative limits until prepared model LODs can be used here.
    if (terrain.foliage.grassSource === 'model') next.grass = Math.min(next.grass, 320);
    if (terrain.foliage.treeSource === 'model') next.trees = Math.min(next.trees, 180);
    return next;
  }, [quality, terrain.foliage.grassSource, terrain.foliage.treeSource]);

  useLayoutEffect(() => {
    const localCamera = camera.getWorldPosition(new THREE.Vector3());
    const scale = new THREE.Vector3(1, 1, 1);
    if (group.current) {
      group.current.updateWorldMatrix(true, false);
      group.current.worldToLocal(localCamera);
      group.current.getWorldScale(scale);
    }
    const look = terrain.foliage.stylizedGrass ?? defaultStylizedGrass();
    // One chunk of padding covers camera travel until useVisibleTerrainChunks publishes a new set.
    const grassRange = look.fadeMode === 'off' ? Infinity
      : look.fadeEnd / Math.max(0.001, Math.min(Math.abs(scale.x), Math.abs(scale.z))) + terrain.chunkSize * Math.SQRT2;
    const next = chunks.slice(0, vegetationRegionLimit(quality)).map((chunk) => {
      const near = chunkWithinGrassRange(terrain, chunk, localCamera.x, localCamera.z, grassRange);
      const coverRange = 75 / Math.max(.001, Math.min(Math.abs(scale.x), Math.abs(scale.z))) + terrain.chunkSize * Math.SQRT2;
      const options = { grass: near, flowers: near, trees: true, groundCover: chunkWithinGrassRange(terrain, chunk, localCamera.x, localCamera.z, coverRange) };
      const signature = vegetationChunkSignature(signatures, chunk, options);
      return { chunk, options, signature, data: cache.current.get(chunk.id, signature) };
    });
    pending.current = { regions: next, cursor: 0, remaining: { ...budget } };
    setRegions(next);
  }, [terrain, chunks, signatures, camera, budget, quality]);

  useEffect(() => () => { cache.current.clear(); pending.current = undefined; }, []);

  useFrame(() => {
    const work = pending.current;
    if (!work || work.cursor >= work.regions.length) return;
    const started = performance.now();
    let generated = 0;
    let changed = false;
    while (work.cursor < work.regions.length && generated < 2) {
      const region = work.regions[work.cursor++];
      const options = {
        grass: region.options.grass !== false && work.remaining.grass > 0,
        flowers: region.options.flowers !== false && work.remaining.flowers > 0,
        trees: work.remaining.trees > 0,
        groundCover: region.options.groundCover !== false && (work.remaining.groundCover ?? 0) > 0,
      };
      if (!options.grass && !options.trees && !options.flowers && !options.groundCover) {
        if (region.data) { region.data = undefined; changed = true; }
        continue;
      }
      if (!region.data) {
        const signature = vegetationChunkSignature(signatures, region.chunk, options);
        region.data = cache.current.generate(terrain, region.chunk, signature, options);
        generated++;
        changed = true;
      }
      const limited = limitVegetation(region.data, work.remaining);
      if (limited !== region.data) { region.data = limited; changed = true; }
      if (performance.now() - started >= 4) break;
    }
    if (changed) setRegions([...work.regions]);
  });

  const batches = useMemo(() => {
    const remaining = { ...budget };
    return regions.flatMap(({ chunk, data }) => {
      if (!data) return [];
      const limited = limitVegetation(data, remaining);
      if (!limited.grass.length && !limited.treeModels.length && !limited.flowers.length && GROUND_COVER_KINDS.every(kind => !limited.groundCover[kind].length)) return [];
      return [{ id: chunk.id, data: limited }];
    });
  }, [regions, budget]);

  // One forest-wide model batch shares the library's 18 material/detail draws across all regions.
  // Generation and instance budgets remain regional; ordinary procedural trees retain cell culling.
  const modelTrees = useMemo(() => terrain.foliage.treeSource === 'model'
    ? batches.flatMap(({ data }) => data.treeModels) : [], [batches, terrain.foliage.treeSource]);

  const groundCover = useMemo(() => {
    const combined = emptyGroundCover();
    for (const { data } of batches) for (const kind of GROUND_COVER_KINDS) combined[kind].push(...data.groundCover[kind]);
    return combined;
  }, [batches]);
  return <group ref={group} userData={{ nfVegetation: true }}>
    {terrain.foliage.understoryAssetId && (terrain.foliage.understoryDensity ?? 0) > 0 && <WoodlandGroundCover
      assetId={terrain.foliage.understoryAssetId} matrices={groundCover} windVec={environment?.wind ?? [0, 0, 0]}
      turbulence={environment?.windTurbulence ?? 0} windStrength={terrain.foliage.windStrength ?? 1} />}
    {modelTrees.length > 0 && <FoliageModelInstances assetId={terrain.foliage.treeModelAssetId}
      matrices={modelTrees} limit={180} windVec={environment?.wind ?? [0, 0, 0]}
      turbulence={environment?.windTurbulence ?? 0} windStrength={terrain.foliage.windStrength ?? 1} />}
    {batches.map(({ id, data }) => <TerrainFoliageBatch key={id} terrain={terrain} matrices={data} />)}
  </group>;
}
