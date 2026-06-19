import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
  type ToneMapping as ThreeToneMapping,
} from 'three';
import { useEditorStore, selectActiveSceneEnvironment } from '../store/editorStore';
import type { ToneMappingMode } from '../types';

/**
 * Drives the renderer's film tonemapping from the active scene's environment. r3f sets ACESFilmic +
 * exposure 1 on the Canvas by default; this lets each scene pick its operator (AgX/Neutral/etc.) and
 * dial exposure. Mounted inside both the editor Canvas and the player Canvas. Imperatively setting
 * `gl.toneMapping`/`gl.toneMappingExposure` is the same path r3f's own `flat`/`gl` props take — three
 * recompiles affected materials on the next render, so we `invalidate()` to repaint a paused editor.
 */
const TONE_MAPPING: Record<ToneMappingMode, ThreeToneMapping> = {
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
  reinhard: ReinhardToneMapping,
  cineon: CineonToneMapping,
  linear: LinearToneMapping,
  none: NoToneMapping,
};

export function ToneMapping() {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const mode = useEditorStore((state) => selectActiveSceneEnvironment(state)?.toneMapping);
  const exposure = useEditorStore((state) => selectActiveSceneEnvironment(state)?.toneMappingExposure);

  useEffect(() => {
    gl.toneMapping = TONE_MAPPING[mode ?? 'aces'] ?? ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure ?? 1;
    invalidate();
  }, [gl, invalidate, mode, exposure]);

  return null;
}
