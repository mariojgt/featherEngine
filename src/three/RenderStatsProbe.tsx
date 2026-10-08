import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { countSceneStats, recordRender, recordRenderTime, resetRenderStats, type CountableNode } from '../runtime/perfStats';

/** Shared by editor and player. Publish the previous frame, including every post-processing draw. */
export function RenderStatsProbe() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const renderAccum = useRef(0);
  const callsAccum = useRef(0);
  const trianglesAccum = useRef(0);
  useEffect(() => {
    resetRenderStats();
    renderAccum.current = callsAccum.current = trianglesAccum.current = 0;
    const original = gl.render;
    const measured: typeof gl.render = (...args) => {
      const callsBefore = gl.info.render.calls;
      const trianglesBefore = gl.info.render.triangles;
      const start = performance.now();
      original.apply(gl, args);
      renderAccum.current += performance.now() - start;
      // With automatic resets disabled, counters are cumulative rather than per render.
      callsAccum.current += gl.info.render.calls - (gl.info.autoReset ? 0 : callsBefore);
      trianglesAccum.current += gl.info.render.triangles - (gl.info.autoReset ? 0 : trianglesBefore);
    };
    gl.render = measured;
    return () => {
      if (gl.render === measured) gl.render = original;
      resetRenderStats();
    };
  }, [gl]);

  // Walking the scene is paid once a second, rather than on every frame.
  const sceneCounts = useRef(countSceneStats(undefined));
  const nextSceneSampleAt = useRef(0);
  useFrame(() => {
    recordRenderTime(renderAccum.current);
    renderAccum.current = 0;
    const now = performance.now();
    if (now >= nextSceneSampleAt.current) {
      sceneCounts.current = countSceneStats(scene as unknown as CountableNode);
      nextSceneSampleAt.current = now + 1000;
    }
    recordRender({
      calls: callsAccum.current,
      triangles: trianglesAccum.current,
      programs: gl.info.programs?.length ?? 0,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      ...sceneCounts.current,
    });
    callsAccum.current = trianglesAccum.current = 0;
  });
  return null;
}
