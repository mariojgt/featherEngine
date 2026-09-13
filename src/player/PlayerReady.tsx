import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';

/** The native launch test succeeds only after assets finish loading and the scene renders frames. */
export function PlayerReady() {
  const active = useProgress((state) => state.active), errors = useProgress((state) => state.errors);
  const frames = useRef(0), sent = useRef(false);
  useFrame(() => {
    if (sent.current) return;
    if (active || errors.length) { frames.current = 0; return; }
    if (++frames.current < 30) return;
    sent.current = true;
    (window as unknown as { __FEATHER_PLAYER_READY__: boolean }).__FEATHER_PLAYER_READY__ = true;
    if (location.protocol === 'feather:' || location.hostname === 'feather.localhost') void fetch('./__feather_ready').catch(() => {});
  });
  return null;
}
