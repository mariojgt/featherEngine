/**
 * Built-in game HUD overlay (separate from the user-authored ScreenUILayer): the AAA-feel chrome the
 * runtime drives directly — interaction prompt, hit markers, ammo counter, and the hurt screen-flash.
 * (The crosshair + first-person hitmarker live in DynamicCrosshair.) A click-through DOM layer mounted
 * alongside ScreenUILayer in both the editor viewport and the standalone player. Shows only while Play is on.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { audioEngine } from '../runtime/audioEngine';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';

/** Turn a KeyboardEvent.code into a short label for the prompt chip ("KeyE" → "E", "Space" → "Space"). */
function keyLabel(code: string | undefined): string {
  if (!code) return 'E';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Mouse')) return ['LMB', 'RMB', 'MMB'][Number(code.slice(5))] ?? code;
  return code;
}

function hudSceneSignature(state: ReturnType<typeof useEditorStore.getState>) {
  const objects = selectActiveObjects(state);
  const player = objects.find((object) => object.character?.enabled && object.character.cameraFollow);
  const drivingCar = objects.find((object) => object.vehicle?.enabled && object.vehicle.cameraFollow);
  const focus = state.runtimeInteractFocusId ? objects.find((object) => object.id === state.runtimeInteractFocusId) : undefined;
  const inventory = player?.inventory;
  const activeSlot = inventory?.slots[inventory.equipped];
  return [
    state.isPlaying ? '1' : '0',
    state.runtimeInteractFocusId ?? '',
    player?.id ?? '',
    player?.name ?? '',
    player?.character?.keyInteract ?? '',
    player?.character?.cameraMode ?? '',
    inventory?.equipped ?? '',
    inventory?.slots.length ?? 0,
    activeSlot?.label ?? '',
    activeSlot?.ranged ? 'ranged' : '',
    drivingCar?.id ?? '',
    drivingCar?.variables?.exitPrompt ?? '',
    focus?.id ?? '',
    focus?.name ?? '',
    focus?.variables?.interactPrompt ?? '',
  ].join('|');
}

export function GameHud() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const focusId = useEditorStore((state) => state.runtimeInteractFocusId);
  const sceneSignature = useEditorStore(hudSceneSignature);
  const hitMarker = useEditorStore((state) => state.runtimeHitMarker);
  const killMarker = useEditorStore((state) => state.runtimeKillMarker);
  const hurt = useEditorStore((state) => state.runtimeHurt);
  const flash = useEditorStore((state) => state.runtimeFlash);
  const flashColor = useEditorStore((state) => state.runtimeFlashColor);
  const objVars = useEditorStore((state) => state.runtimeObjectVariables);
  const runtimeAnimators = useEditorStore((state) => state.runtimeAnimators);
  const animatorControllers = useEditorStore((state) => state.animatorControllers);
  const equipInventorySlot = useEditorStore((state) => state.equipInventorySlot);
  const occupants = useEditorStore((state) => state.runtimeVehicleOccupants);
  const objects = useMemo(() => selectActiveObjects(useEditorStore.getState()), [sceneSignature]);

  // Kill-confirm: when player damage KILLS a target, hold a longer red marker window + play the
  // synthesized confirm blip. The blip lives here (not DynamicCrosshair) so it fires exactly once
  // and covers third-person too — both components are mounted together in every Play surface.
  const [kill, setKill] = useState(false);
  useEffect(() => {
    if (!killMarker) return;
    setKill(true);
    audioEngine.playKillConfirm();
    const t = setTimeout(() => setKill(false), 380);
    return () => clearTimeout(t);
  }, [killMarker]);

  // Radial weapon wheel: hold Tab to show, release to hide (GTA-style). Tab's default focus-cycling is
  // suppressed while playing so it never steals focus from the canvas.
  const [wheelOpen, setWheelOpen] = useState(false);
  useEffect(() => {
    if (!isPlaying) {
      setWheelOpen(false);
      return;
    }
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setWheelOpen(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setWheelOpen(false);
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [isPlaying]);

  if (!isPlaying) return null;

  // GTA-style driving: while the player occupies a car (Enter Vehicle), the follow-camera is on the car and
  // no character is camera-follow — so suppress the on-foot weapon chrome and show an "exit" prompt instead.
  const drivingCar = objects.find((object) => object.vehicle?.enabled && object.vehicle.cameraFollow);
  const occupantId = drivingCar ? occupants[drivingCar.id] : undefined;
  const driving = Boolean(drivingCar && occupantId);
  const exitPrompt = driving
    ? (typeof drivingCar?.variables?.exitPrompt === 'string' && drivingCar.variables.exitPrompt) || 'Exit vehicle'
    : null;

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
  const activeSlot = inventory?.slots[inventory.equipped];
  const controller = animatorControllers.find((item) => item.id === player?.animator?.controllerId);
  const rangedParam = controller?.parameters.find((param) => param.name === 'RangedMode');
  const rangedLive = player && rangedParam ? runtimeAnimators[player.id]?.params[rangedParam.id] : undefined;
  const showThirdPersonReticle = Boolean(!driving && thirdPerson && (activeSlot?.ranged || rangedLive === true));
  const focusVars = focus ? { ...(focus.variables ?? {}), ...(objVars[focus.id] ?? {}) } : {};
  const prompt = focus
    ? typeof focusVars.interactPrompt === 'string' && focusVars.interactPrompt
      ? focusVars.interactPrompt
      : `Use ${focus.name}`
    : null;

  const reticleTick = (style: CSSProperties): CSSProperties => ({
    position: 'absolute',
    background: 'rgba(236,246,255,0.94)',
    borderRadius: '2px',
    boxShadow: '0 0 2px rgba(0,0,0,0.9), 0 0 12px rgba(96,165,250,0.25)',
    ...style,
  });

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', fontFamily: 'inherit' }}>
      {/* Screen flash: a full-screen tinted pop driven by runtimeFlash (decays in the tick). Explosions add
          a hot-orange bloom automatically; the Screen Flash node fires custom-colored blinks. */}
      {flash > 0.01 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: flashColor,
            opacity: Math.min(0.92, flash),
          }}
        />
      )}
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
      {showThirdPersonReticle && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '52px',
            height: '52px',
            transform: 'translate(-50%,-50%)',
            opacity: 0.94,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '13px',
              border: '1px solid rgba(125,211,252,0.26)',
              borderRadius: '50%',
              boxShadow: 'inset 0 0 16px rgba(15,23,42,0.35)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: '4px',
              height: '4px',
              marginLeft: '-2px',
              marginTop: '-2px',
              borderRadius: '50%',
              background: '#ecfeff',
              boxShadow: '0 0 3px rgba(0,0,0,0.95), 0 0 10px rgba(125,211,252,0.34)',
            }}
          />
          <div style={reticleTick({ left: '50%', top: '3px', width: '2px', height: '13px', marginLeft: '-1px' })} />
          <div style={reticleTick({ left: '50%', bottom: '3px', width: '2px', height: '13px', marginLeft: '-1px' })} />
          <div style={reticleTick({ left: '3px', top: '50%', width: '13px', height: '2px', marginTop: '-1px' })} />
          <div style={reticleTick({ right: '3px', top: '50%', width: '13px', height: '2px', marginTop: '-1px' })} />
        </div>
      )}
      {/* Hit marker (third-person): a brief center mark each time the player's shot lands — drawn red,
          bigger and longer when the hit was a KILL. */}
      {hitMarker > 0 && thirdPerson && (
        <div
          key={kill ? `kill-${killMarker}` : `hit-${hitMarker}`}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%,-50%)',
            width: kill ? '34px' : '26px',
            height: kill ? '34px' : '26px',
            animation: `nf-hit ${kill ? '0.42s' : '0.32s'} ease-out forwards`,
          }}
        >
          {[45, -45].map((deg) => (
            <div
              key={deg}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: kill ? '25px' : '19px',
                height: '3px',
                marginLeft: kill ? '-12.5px' : '-9.5px',
                marginTop: '-1.5px',
                background: kill ? '#ff3b30' : '#ffffff',
                borderRadius: '3px',
                boxShadow: kill ? '0 0 3px rgba(0,0,0,0.95), 0 0 12px rgba(255,59,48,0.6)' : '0 0 3px rgba(0,0,0,0.95), 0 0 12px rgba(125,211,252,0.38)',
                transform: `rotate(${deg}deg)`,
              }}
            />
          ))}
        </div>
      )}
      {showAmmo && !driving && (
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
      {inventory && inventory.slots.length > 0 && player && !driving && (
        <div
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '8px',
            padding: '8px',
            background: 'rgba(9,12,18,0.72)',
            border: '1px solid rgba(148,163,184,0.18)',
            borderRadius: '8px',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 12px 36px rgba(0,0,0,0.34)',
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
                  borderRadius: '7px',
                  border: active ? '1px solid rgba(125,211,252,0.85)' : '1px solid rgba(148,163,184,0.18)',
                  background: active ? 'rgba(14,165,233,0.18)' : 'rgba(15,23,42,0.68)',
                  color: active ? '#e0f7ff' : '#cfd6e6',
                  boxShadow: active ? 'inset 0 0 0 1px rgba(236,246,255,0.12), 0 0 18px rgba(14,165,233,0.22)' : 'none',
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
      {exitPrompt && (
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
            F
          </kbd>
          <span>{exitPrompt}</span>
        </div>
      )}
      {/* Radial weapon wheel (hold Tab): the inventory slots arranged around a ring; click to equip. */}
      {wheelOpen && !driving && inventory && inventory.slots.length > 0 && player && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at center, rgba(8,11,18,0.55) 0%, rgba(8,11,18,0.78) 60%)',
            animation: 'nf-prompt-in 0.1s ease-out',
          }}
        >
          <div style={{ position: 'relative', width: '320px', height: '320px', pointerEvents: 'auto' }}>
            <div
              style={{
                position: 'absolute',
                inset: '92px',
                borderRadius: '50%',
                border: '1px solid rgba(125,211,252,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9fb2cc',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Weapons
            </div>
            {inventory.slots.map((slot, i) => {
              const angle = -Math.PI / 2 + (i / inventory.slots.length) * Math.PI * 2;
              const left = 160 + Math.cos(angle) * 118;
              const top = 160 + Math.sin(angle) * 118;
              const active = inventory.equipped === i;
              return (
                <button
                  key={i}
                  onClick={() => {
                    equipInventorySlot(player.id, i);
                    setWheelOpen(false);
                  }}
                  style={{
                    position: 'absolute',
                    left: `${left}px`,
                    top: `${top}px`,
                    transform: 'translate(-50%,-50%)',
                    width: '84px',
                    height: '84px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '3px',
                    cursor: 'pointer',
                    borderRadius: '50%',
                    border: active ? '2px solid rgba(125,211,252,0.95)' : '1px solid rgba(148,163,184,0.3)',
                    background: active ? 'rgba(14,165,233,0.28)' : 'rgba(15,23,42,0.82)',
                    color: active ? '#e0f7ff' : '#cfd6e6',
                    boxShadow: active ? '0 0 24px rgba(14,165,233,0.4)' : '0 8px 24px rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(6px)',
                    transition: 'all 0.1s ease-out',
                  }}
                >
                  <span style={{ fontSize: '11px', fontWeight: 700, opacity: 0.6 }}>{i + 1}</span>
                  <span style={{ fontSize: '14px', fontWeight: 700 }}>{slot.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <style>{`
        @keyframes nf-prompt-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes nf-hit { 0% { opacity: 0; transform: translate(-50%,-50%) scale(1.8); } 25% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%,-50%) scale(0.9); } }
        @keyframes nf-hurt { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
      `}</style>
    </div>
  );
}
