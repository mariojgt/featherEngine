import { Html } from '@react-three/drei';
import type { EffectComponent } from '../types';

/**
 * A floating combat damage number, anchored at a hit point in 3D and drawn as crisp DOM text via drei's
 * <Html> (no web-font fetch, so it works offline / under the desktop CSP). It rises and fades via a CSS
 * animation timed to the effect's lifetime; the runtime despawns the owning object when its life runs out.
 */
export function DamageNumber({ effect }: { effect: EffectComponent }) {
  const seconds = effect.maxLife.toFixed(2);
  return (
    <Html center pointerEvents="none" zIndexRange={[20, 0]}>
      <div
        style={{
          color: effect.color,
          fontWeight: 800,
          fontSize: '22px',
          textShadow: '0 2px 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          animation: `nf-dmg ${seconds}s ease-out forwards`,
        }}
      >
        -{Math.round(effect.value ?? 0)}
        <style>{`@keyframes nf-dmg { 0% { opacity: 0; transform: translateY(4px) scale(0.7); } 18% { opacity: 1; transform: translateY(-6px) scale(1.15); } 100% { opacity: 0; transform: translateY(-42px) scale(1); } }`}</style>
      </div>
    </Html>
  );
}
