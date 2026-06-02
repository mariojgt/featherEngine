import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { useEditorStore } from '../store/editorStore';

/**
 * Project post-processing pass (bloom + vignette), driven by `renderSettings`. Bloom makes emissive
 * surfaces (neon accents) and the additive tracers/muzzle flashes actually glow. Mounted inside the
 * Canvas in the player (always) and the editor viewport (during Play). Renders nothing when all FX off.
 */
export function PostFx() {
  const rs = useEditorStore((state) => state.renderSettings);
  const children = [];
  if (rs?.bloomEnabled) {
    children.push(
      <Bloom
        key="bloom"
        intensity={rs.bloomIntensity}
        luminanceThreshold={rs.bloomThreshold}
        luminanceSmoothing={rs.bloomRadius}
        mipmapBlur
      />,
    );
  }
  if (rs?.vignetteEnabled) {
    children.push(<Vignette key="vignette" offset={0.32} darkness={0.72} eskil={false} />);
  }
  if (!children.length) return null;
  return (
    <EffectComposer multisampling={4}>
      {children}
    </EffectComposer>
  );
}
