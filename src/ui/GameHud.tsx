/**
 * Built-in game HUD overlay (separate from the user-authored ScreenUILayer): the AAA-feel chrome the
 * runtime drives directly — interaction prompt, hit markers, ammo counter, and the hurt screen-flash.
 * (The crosshair + first-person hitmarker live in DynamicCrosshair.) A click-through DOM layer mounted
 * alongside ScreenUILayer in both the editor viewport and the standalone player. Shows only while Play is on.
 */
import { selectActiveObjects, useEditorStore } from '../store/editorStore';

/** Turn a KeyboardEvent.code into a short label for the prompt chip ("KeyE" → "E", "Space" → "Space"). */
function keyLabel(code: string | undefined): string {
  if (!code) return 'E';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Mouse')) return ['LMB', 'RMB', 'MMB'][Number(code.slice(5))] ?? code;
  return code;
}

export function GameHud() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const focusId = useEditorStore((state) => state.runtimeInteractFocusId);
  const objects = useEditorStore(selectActiveObjects);
  const hitMarker = useEditorStore((state) => state.runtimeHitMarker);
  const hurt = useEditorStore((state) => state.runtimeHurt);
  const objVars = useEditorStore((state) => state.runtimeObjectVariables);
  const equipInventorySlot = useEditorStore((state) => state.equipInventorySlot);

  if (!isPlaying) return null;

  const focus = focusId ? objects.find((object) => object.id === focusId) : undefined;
  const player = objects.find((object) => object.character?.enabled && object.character.cameraFollow);
  const interactKey = keyLabel(player?.character?.keyInteract);
  // First-person gets its crosshair + hitmarker from DynamicCrosshair; show this screen-center ✕ only for
  // third-person so the player still gets hit feedback when there's no crosshair.
  const thirdPerson = player?.character?.cameraMode !== 'firstPerson';
  // Ammo counter — shown when the player owns an `ammo` instance variable (live value, falling back to authored).
  const liveVars = player ? { ...(player.variables ?? {}), ...(objVars[player.id] ?? {}) } : {};
  const ammo = liveVars.ammo;
  const ammoMax = liveVars.ammoMax;
  const showAmmo = typeof ammo === 'number';
  const inventory = player?.inventory;
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
      {/* Hit marker (third-person): a brief ✕ at screen center each time the player's shot lands. */}
      {hitMarker > 0 && thirdPerson && (
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
      {/* Inventory bar: clickable weapon slots, the equipped one highlighted; ammo shown on the ranged slot. */}
      {inventory && inventory.slots.length > 0 && player && (
        <div
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '8px',
            padding: '8px',
            background: 'rgba(12,14,20,0.6)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            backdropFilter: 'blur(6px)',
            pointerEvents: 'auto',
          }}
        >
          {inventory.slots.map((slot, i) => {
            const active = inventory.equipped === i;
            return (
              <button
                key={i}
                onClick={() => equipInventorySlot(player.id, i)}
                title={slot.label}
                style={{
                  position: 'relative',
                  width: '64px',
                  height: '64px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  cursor: 'pointer',
                  borderRadius: '9px',
                  border: active ? '2px solid #ffcf66' : '1px solid rgba(255,255,255,0.16)',
                  background: active ? 'rgba(255,207,102,0.16)' : 'rgba(255,255,255,0.05)',
                  color: active ? '#ffe6a8' : '#cfd6e6',
                  boxShadow: active ? '0 0 14px rgba(255,207,102,0.35)' : 'none',
                  transition: 'all 0.1s ease-out',
                }}
              >
                <span style={{ position: 'absolute', top: '3px', left: '6px', fontSize: '11px', fontWeight: 700, opacity: 0.65 }}>{i + 1}</span>
                <span style={{ fontSize: '13px', fontWeight: 700 }}>{slot.label}</span>
                {slot.ranged && showAmmo && (
                  <span style={{ fontSize: '11px', opacity: 0.8 }}>
                    {Number(ammo)}
                    {typeof ammoMax === 'number' ? `/${Number(ammoMax)}` : ''}
                  </span>
                )}
              </button>
            );
          })}
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
