import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import { registerCinematicCaptureRenderer } from '../runtime/cinematicCapture';

/** Request a single composed frame; the second RAF is a fence after the WebGL draw and React commit. */
export function CinematicCaptureDriver() {
  const invalidate = useThree(state => state.invalidate);
  const gl = useThree(state => state.gl);
  useEffect(() => registerCinematicCaptureRenderer(async () => {
    invalidate();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    Object.assign(window, { __featherCaptureMetrics: { textures:gl.info.memory.textures, geometries:gl.info.memory.geometries, programs:gl.info.programs?.length ?? 0, assetsLoading:useProgress.getState().active } });
  }), [invalidate, gl]);
  return null;
}
