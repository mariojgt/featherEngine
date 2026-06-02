/**
 * Built-in game HUD overlay (separate from the user-authored ScreenUILayer): the AAA-feel chrome the
 * runtime drives directly — interaction prompt, crosshair, hit markers, floating damage numbers, ammo,
 * and the hurt screen-flash. A click-through DOM layer mounted alongside ScreenUILayer in both the editor
 * viewport and the standalone player. Renders only while Play is active.
 */
import type { CSSProperties } from 'react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';

/** Turn a KeyboardEvent.code into a short label for the prompt chip ("KeyE" → "E", "Space" → "Space"). */
function keyLabel(code: string | undefined): string {
  if (!code) return 'E';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Mouse')) return ['LMB', 'RMB', 'MMB'][Number(code.slice(5))] ?? code;
  return code;
}

/** A 4-tick crosshair that tightens its center gap while aiming. */
function Crosshair({ aiming }: { aiming: boolean }) {
  const gap = aiming ? 4 : 9;
  const len = aiming ? 7 : 9;
  const tick = (style: CSSProperties) => (
    <span style={{ position: 'absolute', background: 'rgba(255,255,255,0.9)', boxShadow: '0 0 2px rgba(0,0,0,0.8)', ...style }} />
  );
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: 0,
        height: 0,
        transition: 'all 0.08s ease-out',
      }}
    >
      {tick({ left: gap, top: -1, width: len, height: 2 })}
      {tick({ right: gap, top: -1, width: len, height: 2 })}
      {tick({ top: gap, left: -1, width: 2, height: len })}
      {tick({ bottom: gap, left: -1, width: 2, height: len })}
      <span
        style={{
          position: 'absolute',
          left: -1.5,
          top: -1.5,
          width: 3,
          height: 3,
          borderRadius: '50%',
          background: aiming ? '#ff5a5a' : 'rgba(255,255,255,0.85)',
        }}
      />
    </div>
  );
}

export function GameHud() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const focusId = useEditorStore((state) => state.runtimeInteractFocusId);
  const objects = useEditorStore(selectActiveObjects);
  const runtimeKeys = useEditorStore((state) => state.runtimeKeys);
  const hitMarker = useEditorStore((state) => state.runtimeHitMarker);
  const hurt = useEditorStore((state) => state.runtimeHurt);
  const objVars = useEditorStore((state) => state.runtimeObjectVariables);

  if (!isPlaying) return null;

  const focus = focusId ? objects.find((object) => object.id === focusId) : undefined;
  const player = objects.find((object) => object.character?.enabled && object.character.cameraFollow);
  const interactKey = keyLabel(player?.character?.keyInteract);
  // Crosshair: shown while aiming, or always in first-person. Tightens when the aim key is held.
  const aiming = Boolean(player?.character?.keyAim && runtimeKeys[player.character.keyAim]);
  const firstPerson = player?.character?.cameraMode === 'firstPerson';
  const showCrosshair = aiming || firstPerson;
  // Ammo counter — shown when the player owns an `ammo` instance variable (live value, falling back to authored).
  const liveVars = player ? { ...(player.variables ?? {}), ...(objVars[player.id] ?? {}) } : {};
  const ammo = liveVars.ammo;
  const ammoMax = liveVars.ammoMax;
  const showAmmo = typeof ammo === 'number';
  const prompt = focus
    ? typeof focus.variables?.interactPrompt === 'string' && focus.variables.interactPrompt
      ? focus.variables.interactPrompt
      : `Use ${focus.name}`
    : null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', fontFamily: 'inherit' }}>
      {/* Hurt flash: a red vignette that pulses each time the player takes damage (keyed to replay). */}
      {hurt > 0 && (
        <div
          key={`hurt-${hurt}`}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, rgba(180,0,0,0) 45%, rgba(180,0,0,0.55) 100%)',
            animation: 'nf-hurt 0.5s ease-out forwards',
          }}
        />
      )}
      {showCrosshair && <Crosshair aiming={aiming} />}
      {/* Hit marker: a brief ✕ at screen center each time the player's shot lands. */}
      {hitMarker > 0 && (
        <div
          key={`hit-${hitMarker}`}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%,-50%)',
            color: '#fff',
            fontSize: '26px',
            fontWeight: 700,
            textShadow: '0 0 4px rgba(0,0,0,0.9)',
            animation: 'nf-hit 0.32s ease-out forwards',
          }}
        >
          ✕
        </div>
      )}
      {showAmmo && (
        <div
          style={{
            position: 'absolute',
            right: '28px',
            bottom: '26px',
            display: 'flex',
            alignItems: 'baseline',
            gap: '4px',
            color: Number(ammo) <= 0 ? '#ff6b6b' : '#fff',
            textShadow: '0 2px 6px rgba(0,0,0,0.7)',
          }}
        >
          <span style={{ fontSize: '34px', fontWeight: 800, lineHeight: 1 }}>{Number(ammo)}</span>
          {typeof ammoMax === 'number' && <span style={{ fontSize: '17px', opacity: 0.7, fontWeight: 600 }}>/ {Number(ammoMax)}</span>}
        </div>
      )}
      {prompt && (
        <div
          style={{
            position: 'absolute',
            bottom: '15%',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 16px 8px 8px',
            background: 'rgba(12,14,20,0.72)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '12px',
            color: '#fff',
            fontSize: '16px',
            fontWeight: 600,
            backdropFilter: 'blur(6px)',
            boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
            animation: 'nf-prompt-in 0.12s ease-out',
          }}
        >
          <kbd
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '30px',
              height: '30px',
              padding: '0 8px',
              background: 'linear-gradient(180deg,#3a4256,#2a2f3e)',
              border: '1px solid rgba(255,255,255,0.25)',
              borderBottomWidth: '3px',
              borderRadius: '7px',
              fontFamily: 'monospace',
              fontSize: '14px',
              fontWeight: 700,
              color: '#fff',
            }}
          >
            {interactKey}
          </kbd>
          <span>{prompt}</span>
        </div>
      )}
      <style>{`
        @keyframes nf-prompt-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes nf-hit { 0% { opacity: 0; transform: translate(-50%,-50%) scale(1.6); } 25% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1); } }
        @keyframes nf-hurt { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
      `}</style>
    </div>
  );
}
