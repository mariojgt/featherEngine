import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { configureCompressedTextureSupport } from './gltfDecoders';

/**
 * Mount once inside a <Canvas> (editor Viewport + player GameView). Hands the live WebGLRenderer to
 * the shared KTX2 transcoder so GPU-compressed textures decode to a format this GPU supports. Renders
 * nothing. The Canvas always mounts before the user imports/compresses any model, so KTX2 support is
 * ready by the time a compressed asset first loads.
 */
export function CompressedTextureSupport() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    configureCompressedTextureSupport(gl);
  }, [gl]);
  return null;
}
