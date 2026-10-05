import { useEditorStore } from '../store/editorStore';
import type { UIElement } from '../types';

/** Editable DOM UI with live bindings, anchored HUD, brief/pause/results and keyboard equivalents. */
export function addCinderfallUI(ownerId: string): string {
  const s = useEditorStore.getState(), folder = s.createFolder('Cinderfall · Interface');
  const doc = s.createUIDocument('Cinderfall · Expedition interface', 'screen', folder);
  s.updateUIDocument(doc, { visibleOnStart: true, renderMode: 'dom', css: CINDERFALL_CSS });
  s.attachUI(ownerId, doc);
  const root = useEditorStore.getState().uiDocuments.find(d => d.id === doc)!.root.id;
  s.updateUIElement(doc, root, { name: 'Cinderfall interface', className: 'cf-ui', anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 }, style: { width: '100%', height: '100%', padding: '0', display: 'block' } });
  const el = (parent: string, kind: UIElement['kind'], name: string, patch: Partial<UIElement> = {}, visible?: string) => {
    const id = s.addUIElement(doc, parent, kind);
    s.updateUIElement(doc, id, { name, style: {}, states: {}, ...patch });
    if (visible) s.setUIBinding(doc, id, 'visible', visible);
    return id;
  };
  const text = (parent: string, name: string, value: string, className: string, binding?: string) => {
    const id = el(parent, 'text', name, { text: value, className });
    if (binding) s.setUIBinding(doc, id, 'text', binding);
    return id;
  };
  const button = (parent: string, value: string, event: string, secondary = false) => el(parent, 'button', value, { text: value, onClickEvent: event, className: `cf-button${secondary ? ' cf-secondary' : ''}` });

  const hud = el(root, 'panel', 'Expedition HUD', { className: 'cf-hud', anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 }, style: { width: '100%', height: '100%', display: 'block' } }, 'CFStage > 0 && CFStage < 3 && !CFPaused');
  const brand = el(hud, 'panel', 'Expedition identity', { className: 'cf-brand', anchor: { h: 'left', v: 'top', offsetX: 28, offsetY: 24 } });
  text(brand, 'Sector', 'SURVEY DIVISION  /  SECTOR 07', 'cf-eyebrow');
  text(brand, 'Expedition name', 'CINDERFALL', 'cf-wordmark');
  text(brand, 'Task', 'Recover aetherite. Return alive.', 'cf-muted', "CFStage == 2 ? 'QUOTA MET — return to the amber rig' : 'Recover aetherite. Return alive.'");
  const quota = el(hud, 'panel', 'Cargo tracker', { className: 'cf-cargo', anchor: { h: 'right', v: 'top', offsetX: 28, offsetY: 24 } });
  text(quota, 'Cargo eyebrow', 'AETHERITE CARGO', 'cf-eyebrow');
  text(quota, 'Cargo units', '00 / 16', 'cf-cargo-count', "CFOre + ' / ' + CFQuota");
  const cargoBar = el(quota, 'bar', 'Cargo progress', { className: 'cf-progress' });
  s.setUIBinding(doc, cargoBar, 'fill', 'CFOre / CFQuota');
  text(quota, 'Extraction clock', 'MINING PHASE', 'cf-muted', "CFStage == 2 ? 'RIG DEPARTURE IN ' + CFTimeLeft + 's' : 'MINING PHASE'");
  const health = el(hud, 'panel', 'Suit integrity', { className: 'cf-integrity', anchor: { h: 'left', v: 'bottom', offsetX: 28, offsetY: 28 } });
  text(health, 'Integrity value', '100', 'cf-integrity-number', "Health + '%'");
  text(health, 'Integrity label', 'SUIT INTEGRITY', 'cf-eyebrow');
  const healthBar = el(health, 'bar', 'Integrity bar', { className: 'cf-progress cf-health-progress' });
  s.setUIBinding(doc, healthBar, 'fill', 'Health / 100');
  s.setUIBinding(doc, healthBar, 'color', "Health <= 30 ? '#ff7f6c' : '#81dbc2'");
  const gun = el(hud, 'panel', 'Rifle status', { className: 'cf-weapon', anchor: { h: 'right', v: 'bottom', offsetX: 28, offsetY: 28 } });
  text(gun, 'Rifle name', 'VX–24  /  SURVEY RIFLE', 'cf-eyebrow');
  text(gun, 'Magazine', '24', 'cf-ammo', "CFReload > 0 ? 'RELOADING' : CFAmmo + ' / 24'");
  text(gun, 'Lamp indicator', 'LAMP ON', 'cf-muted', "CFHeadlamp ? 'F  HEADLAMP ON' : 'F  HEADLAMP OFF'");
  const hint = el(hud, 'panel', 'Contextual task', { className: 'cf-context', anchor: { h: 'center', v: 'bottom', offsetX: 0, offsetY: 42 } });
  text(hint, 'Context prompt', '', 'cf-context-title', 'CFPrompt');
  text(hint, 'Context detail', '', 'cf-muted', 'CFHint');
  const toast = el(hud, 'panel', 'Radio notification', { className: 'cf-radio', anchor: { h: 'center', v: 'top', offsetX: 0, offsetY: 116 } }, 'CFToastTime > 0');
  text(toast, 'Radio eyebrow', 'RIG CONTROL', 'cf-eyebrow');
  text(toast, 'Radio message', '', 'cf-radio-message', 'CFToast');
  const warning = el(hud, 'panel', 'Critical integrity', { className: 'cf-warning', anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 }, style: { width: '100%', height: '100%', display: 'block' } }, 'Health > 0 && Health < 30');
  text(warning, 'Critical warning', 'CRITICAL INTEGRITY', 'cf-critical');

  const modal = (name: string, visible: string, className = '') => {
    const overlay = el(root, 'panel', name, { className: `cf-overlay ${className}`, anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 }, style: { width: '100%', height: '100%', display: 'flex' } }, visible);
    return el(overlay, 'panel', `${name} content`, { className: 'cf-modal' });
  };
  const brief = modal('Expedition briefing', 'CFStage == 0', 'cf-brief');
  text(brief, 'Brief eyebrow', 'A FEATHER ENGINE FIELD EXPEDITION', 'cf-eyebrow');
  text(brief, 'Brief title', 'CINDERFALL', 'cf-title');
  text(brief, 'Brief subheading', 'Below the surface. Beyond the quota.', 'cf-subtitle');
  text(brief, 'Brief description', 'The rig has found a seam of aetherite beneath Sector 07. Recover sixteen units from the glowing veins. When your cargo is full, make it back to the amber extraction rig. The cave is not empty.', 'cf-body');
  text(brief, 'Brief controls', 'WASD  MOVE   ·   SHIFT  SPRINT   ·   SPACE  JUMP\nMOUSE  AIM   ·   LMB  FIRE   ·   R  RELOAD\nHOLD E  MINE / EXTRACT   ·   F  HEADLAMP   ·   P  PAUSE', 'cf-controls');
  button(brief, 'Begin expedition  ↵', 'CFStart');
  text(brief, 'Brief footer', 'Single-player · one complete mission · all systems editable', 'cf-footnote');
  const pause = modal('Pause menu', 'CFPaused && CFStage > 0 && CFStage < 3');
  text(pause, 'Pause eyebrow', 'EXPEDITION ON HOLD', 'cf-eyebrow');
  text(pause, 'Pause title', 'Take a breath.', 'cf-heading');
  text(pause, 'Pause help', 'Click the viewport after resuming to capture the mouse. Escape releases it.', 'cf-body');
  button(pause, 'Resume expedition', 'CFPause');
  button(pause, 'Restart expedition', 'CFReplay', true);
  const end = modal('Expedition results', 'CFStage >= 3');
  text(end, 'Result eyebrow', 'EXPEDITION REPORT  /  SECTOR 07', 'cf-eyebrow');
  text(end, 'Result title', 'Cargo secured.', 'cf-heading', "CFStage == 3 ? 'Cargo secured.' : 'Expedition lost.'");
  text(end, 'Result explanation', '', 'cf-body', "CFStage == 3 ? 'You brought the aetherite home. The rig crew thanks you.' : CFHint");
  text(end, 'Result cargo', '', 'cf-result-stat', "CFOre + ' AETHERITE  ·  ' + CFKills + ' CREATURES CLEARED'");
  text(end, 'Result time', '', 'cf-muted', "'EXPEDITION TIME  ' + CFDisplaySeconds + 's'");
  button(end, 'Run another expedition  ↵', 'CFReplay');
  text(end, 'Editing hint', 'Stop Play to edit the cave, creatures, weapon, and mission Blueprints.', 'cf-footnote');
  return doc;
}

export const CINDERFALL_CSS = `
.cf-ui { font-family: Inter, system-ui, sans-serif; color: #eef2e9; pointer-events: none; }
.cf-ui * { box-sizing: border-box; }
.cf-hud { background: linear-gradient(#050d123d, transparent 22%, transparent 76%, #050d1259); }
.cf-brand { display: flex; flex-direction: column; gap: 8px; }
.cf-eyebrow { font: 600 10px ui-monospace, SFMono-Regular, Consolas, monospace; color: #b9c6b8; letter-spacing: 2px; }
.cf-wordmark { font-size: 24px; font-weight: 900; letter-spacing: 5px; }
.cf-muted { color: #acbebd; font-size: 11px; white-space: normal; line-height: 1.5; }
.cf-cargo { width: 216px; padding: 17px 20px; background: #071116bf; border: 1px solid #7eb1a733; border-top: 2px solid #73debd; display: flex; flex-direction: column; gap: 10px; }
.cf-cargo-count { color: #a9ecd6; font: 700 33px ui-monospace, monospace; letter-spacing: -2px; }
.cf-progress { height: 4px; width: 100%; color: #7adebf; background: #45655b4d; border: 0; border-radius: 1px; }
.cf-integrity { width: 174px; display: flex; flex-direction: column; gap: 8px; }
.cf-integrity-number { font: 700 28px ui-monospace, monospace; }
.cf-weapon { text-align: right; display: flex; flex-direction: column; gap: 10px; }
.cf-ammo { font: 600 34px ui-monospace, monospace; letter-spacing: -2px; color: #ffe1a1; }
.cf-context { display: flex; flex-direction: column; gap: 7px; align-items: center; text-align: center; max-width: 440px; padding: 10px 18px; background: #071116ac; border: 1px solid #8eae9d2b; }
.cf-context-title { font-size: 13px; font-weight: 700; letter-spacing: .5px; color: #f4dfb3; }
.cf-radio { background: #071116e3; border-left: 3px solid #d6aa55; padding: 12px 20px; max-width: 470px; text-align: center; display: flex; flex-direction: column; gap: 6px; }
.cf-radio-message { font-size: 12px; line-height: 1.5; white-space: normal; }
.cf-warning { box-shadow: inset 0 0 95px 15px #bd3a2940; }
.cf-critical { position: absolute; top: 28%; width: 100%; text-align: center; color: #ff917b; font: 600 11px ui-monospace, monospace; letter-spacing: 3px; }
.cf-overlay { align-items: center; justify-content: center; background: #030a0fcc; backdrop-filter: blur(5px); pointer-events: auto; padding: 26px; }
.cf-modal { width: min(520px, 100%); display: flex; flex-direction: column; gap: 20px; background: #0d1a20f2; border: 1px solid #8ab7a431; border-top: 3px solid #d8b567; padding: 36px; box-shadow: 0 30px 90px #0006; }
.cf-brief { justify-content: flex-start; background: linear-gradient(90deg, #031018eb 5%, #03101890 53%, #03101805); backdrop-filter: none; padding: 6vw; }
.cf-brief .cf-modal { background: transparent; border: 0; box-shadow: none; padding: 0; max-width: 490px; }
.cf-title { font-size: clamp(40px, 6vw, 68px); font-weight: 900; letter-spacing: -3px; line-height: .97; color: #f8e4b7; }
.cf-subtitle { font-size: 18px; font-weight: 650; color: #e3ede7; white-space: normal; }
.cf-body { font-size: 14px; line-height: 1.8; color: #b2c3c4; white-space: normal; }
.cf-controls { font: 10px/2.3 ui-monospace, monospace; letter-spacing: .8px; color: #8da5a5; white-space: pre-wrap; }
.cf-button { pointer-events: auto; min-height: 46px; padding: 12px 18px; background: #d3af62; color: #142028; border: 1px solid #f0d38e; border-radius: 3px; font-size: 13px; font-weight: 800; cursor: pointer; text-align: center; }
.cf-button:hover { background: #f1cc7c; }
.cf-button:focus-visible { outline: 2px solid #93f2d6; outline-offset: 4px; }
.cf-secondary { background: transparent; border-color: #88a79b59; color: #c4d6d2; }
.cf-secondary:hover { background: #8ab7a41c; }
.cf-footnote { font-size: 10px; line-height: 1.6; color: #829b9c; white-space: normal; }
.cf-heading { font-size: 34px; font-weight: 800; letter-spacing: -1px; white-space: normal; }
.cf-result-stat { font: 600 12px ui-monospace, monospace; color: #ecd396; white-space: normal; line-height: 1.8; }
@media(max-width:700px) { .cf-brief { padding: 28px; } .cf-title { font-size: 43px; } .cf-modal { padding: 24px; gap: 15px; } .cf-brand .cf-muted { max-width: 160px; } .cf-wordmark { font-size: 17px; letter-spacing: 2px; } .cf-eyebrow { font-size: 8px; letter-spacing: 1px; } .cf-cargo { width: 142px; padding: 10px; } .cf-cargo-count { font-size: 26px; } .cf-integrity { width: 110px; } .cf-ammo { font-size: 24px; } .cf-context { max-width: 220px; bottom: 95px; padding: 8px; } .cf-radio { max-width: 270px; } }
`;
