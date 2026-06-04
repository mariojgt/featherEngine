import * as THREE from 'three';

/**
 * Apply anisotropic filtering to a texture. Anisotropy keeps tiled/ground/wall textures sharp when
 * viewed at a grazing angle instead of smearing to mush — a big perceived-quality win for almost no
 * cost. The GPU clamps `value` to its hardware maximum at upload, so passing 16 on a card that only
 * supports 8 is safe. Only re-uploads (`needsUpdate`) when the value actually changes, so calling it
 * repeatedly on a shared cached texture is cheap and idempotent. No-op for a missing texture.
 */
export function applyAnisotropy(tex: THREE.Texture | null | undefined, value: number): void {
  if (!tex || tex.anisotropy === value) return;
  tex.anisotropy = value;
  tex.needsUpdate = true;
}
