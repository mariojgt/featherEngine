import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { audioEngine } from '../runtime/audioEngine';

/**
 * Drives the spatial audio listener (the player's "ears") from the active camera every frame, and resumes the
 * AudioContext on the first user gesture (browsers start it suspended). Renders nothing — mount it inside the
 * r3f Canvas so it has access to the live camera.
 */
export function AudioListenerSync() {
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    audioEngine.updateListener(camera);
  });

  useEffect(() => {
    const resume = () => audioEngine.resume();
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, []);

  return null;
}
