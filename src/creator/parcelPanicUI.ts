import { useEditorStore } from '../store/editorStore';
import type { UIElement } from '../types';

/** A normal editable UI document; no template-specific runtime component is needed. */
export function addParcelPanicUI(worldId: string): string {
  const s = useEditorStore.getState();
  const folder = s.createFolder('Parcel Panic · Interface');
  const doc = s.createUIDocument('Parcel Panic · HUD and menus', 'screen', folder);
  s.updateUIDocument(doc, { visibleOnStart: true, renderMode: 'dom', css: PARCEL_PANIC_CSS });
  s.attachUI(worldId, doc);
  const root = useEditorStore.getState().uiDocuments.find(d => d.id === doc)!.root.id;
  s.updateUIElement(doc, root, { name: 'Parcel Panic interface', className: 'pp-ui', anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 }, style: { width: '100%', height: '100%', display: 'block', padding: '0' } });
  const element = (parent: string, kind: 'panel' | 'text' | 'button', name: string, patch: Partial<UIElement> = {}, visible?: string) => {
    const id = s.addUIElement(doc, parent, kind);
    s.updateUIElement(doc, id, { name, style: {}, states: {}, ...patch });
    if (visible) s.setUIBinding(doc, id, 'visible', visible);
    return id;
  };
  const text = (parent: string, name: string, value: string, className: string, binding?: string) => {
    const id = element(parent, 'text', name, { text: value, className });
    if (binding) s.setUIBinding(doc, id, 'text', binding);
    return id;
  };
  const button = (parent: string, name: string, value: string, event: string, secondary = false) =>
    element(parent, 'button', name, { text: value, onClickEvent: event, className: `pp-button${secondary ? ' pp-secondary' : ''}` });

  const skip = element(root, 'panel', 'Skip opening', {
    className: 'pp-skip', anchor: { h: 'right', v: 'bottom', offsetX: 24, offsetY: 24 },
  }, 'PPIntro');
  button(skip, 'Skip cinematic', 'Start delivering  ↵', 'PPSkip');

  const hud = element(root, 'panel', 'Delivery HUD', { className: 'pp-hud', anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 }, style: { width: '100%', height: '100%', display: 'block' } }, '!PPIntro && !PPDone && !PPPaused');
  const brand = element(hud, 'panel', 'Postcard Post brand', { className: 'pp-brand', anchor: { h: 'left', v: 'top', offsetX: 24, offsetY: 22 } });
  text(brand, 'Route eyebrow', 'POSTCARD POST  /  VILLAGE 1', 'pp-eyebrow', "'POSTCARD POST  /  VILLAGE ' + PPVillage");
  text(brand, 'Game title', 'Parcel Panic', 'pp-title');
  const stats = element(hud, 'panel', 'Delivery statistics', { className: 'pp-stats', anchor: { h: 'right', v: 'top', offsetX: 24, offsetY: 22 } });
  text(stats, 'Parcels delivered', '0 / 5', 'pp-count', "PPDelivered + ' / 5'");
  text(stats, 'Progress label', 'HAPPY DELIVERIES', 'pp-eyebrow');
  text(stats, 'Round score', '0 points', 'pp-small', "PPScore + ' points'");
  text(stats, 'Round timer', 'No rush. Enjoy the island.', 'pp-small', "PPTimed ? PPTimeLeft + 's remaining' : 'No rush. Enjoy the island.'");

  const objective = element(hud, 'panel', 'Current delivery', { className: 'pp-objective', anchor: { h: 'center', v: 'bottom', offsetX: 0, offsetY: 108 } });
  text(objective, 'Delivery instruction', 'Pick a parcel at the depot', 'pp-objective-title', "PPCarry != '' ? 'Deliver to ' + PPCarry : 'Pick a parcel at the depot'");
  text(objective, 'Delivery hint', 'E to pick up • match the ribbon and address dots', 'pp-small', "PPCarry != '' ? 'Walk up to the matching basket, or face it and press Q to throw' : 'E to pick up • match the ribbon and address dots'");
  const toast = element(hud, 'panel', 'Delivery celebration', { className: 'pp-toast', anchor: { h: 'center', v: 'top', offsetX: 0, offsetY: 118 } }, 'PPToastTime > 0');
  text(toast, 'Delivery feedback', '', 'pp-toast-text', 'PPToast');

  const controls = element(hud, 'panel', 'Controls and actions', { className: 'pp-controls', anchor: { h: 'center', v: 'bottom', offsetX: 0, offsetY: 20 } });
  text(controls, 'Movement controls', 'WASD move  ·  Space jump  ·  Shift hurry', 'pp-small');
  const actions = element(controls, 'panel', 'Action buttons', { className: 'pp-actions' });
  button(actions, 'Pick up a parcel', 'Pick up · E', 'PPInteract');
  button(actions, 'Throw carried parcel', 'Throw · Q', 'PPThrow');
  button(actions, 'Recall loose parcels', 'Recall · R', 'PPRecall', true);
  button(actions, 'Pause deliveries', 'Pause · P', 'PPPause', true);

  const pause = element(root, 'panel', 'Pause menu', { className: 'pp-modal', anchor: { h: 'center', v: 'middle', offsetX: 0, offsetY: 0 } }, 'PPPaused');
  text(pause, 'Pause eyebrow', 'THE POST CAN WAIT', 'pp-eyebrow');
  text(pause, 'Pause title', 'Take a breather.', 'pp-heading');
  text(pause, 'How to play', 'Carry five parcels to their matching baskets. A successful throw earns 50 extra points. Four air-mail deliveries earn three stars!', 'pp-body');
  button(pause, 'Resume deliveries', 'Back to the island', 'PPPause');
  button(pause, 'Restart relaxed round', 'Retry this village · no timer', 'PPRelaxed', true);
  button(pause, 'Start time trial', 'Try the 90-second rush', 'PPTimeTrial', true);

  button(pause, 'Generate another village', 'Explore a new village', 'PPNewVillage', true);
  text(pause, 'Village code', '', 'pp-remix', "'Village code ' + PPSeed + ' · Retry keeps this route'");

  const results = element(root, 'panel', 'Round results', { className: 'pp-modal pp-results', anchor: { h: 'center', v: 'middle', offsetX: 0, offsetY: 0 } }, 'PPDone');
  text(results, 'Results eyebrow', 'POSTCARD POST  /  SHIFT REPORT', 'pp-eyebrow');
  text(results, 'Results title', 'Kindness, delivered.', 'pp-heading', "PPDelivered >= 5 ? 'Kindness, delivered.' : 'What a busy shift!'");
  text(results, 'Star rating', '★ ☆ ☆', 'pp-stars', "PPDelivered < 5 ? 'Keep practising!' : PPScore >= 700 ? '★ ★ ★' : PPScore >= 600 ? '★ ★ ☆' : '★ ☆ ☆'");
  text(results, 'Results summary', '', 'pp-result-score', "PPScore + ' points  ·  ' + PPDelivered + '/5 parcels'");
  text(results, 'Results encouragement', '', 'pp-body', "PPDelivered >= 5 ? 'Your neighbours are smiling. Fancy another round?' : 'The clock ran out. Try again, or explore without a timer.'");
  button(results, 'Generate next village', 'Deliver in a new village', 'PPNewVillage');
  button(results, 'Play again relaxed', 'Retry this village · no timer', 'PPRelaxed', true);
  button(results, 'Replay time trial', 'Race the clock · 90 seconds', 'PPTimeTrial', true);
  text(results, 'Remix invitation', 'Make it yours: stop Play, change a roof colour, or edit a shot in Cinematic.', 'pp-remix');
  return doc;
}

export const PARCEL_PANIC_CSS = `
.pp-ui { font-family: 'Trebuchet MS', system-ui, sans-serif; color: #193f4b; pointer-events: none; }
.pp-brand, .pp-stats { display: flex; flex-direction: column; gap: 3px; }
.pp-brand { padding: 12px 18px; border-left: 5px solid #f77f7f; border-radius: 4px 18px 18px 4px; background: #fff4ddee; }
.pp-eyebrow { font-size: 10px; font-weight: 900; letter-spacing: 1.7px; color: #42766e; }
.pp-title { font-size: 29px; font-weight: 900; letter-spacing: -1px; line-height: 1.1; }
.pp-stats { text-align: center; padding: 13px 20px; background: #fff4ddee; border-radius: 20px; box-shadow: 0 5px 0 #193f4b1a; }
.pp-count { font-size: 31px; line-height: 1; font-weight: 900; }
.pp-small { font-size: 12px; color: #345f61; white-space: normal; }
.pp-objective { display: flex; flex-direction: column; gap: 5px; width: min(510px, 88vw); text-align: center; background: #fff4ddef; padding: 12px 22px; border-radius: 18px; }
.pp-objective-title { font-size: 19px; font-weight: 900; }
.pp-controls { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 14px; background: #fff4dde8; border-radius: 18px; }
.pp-actions { display: flex; flex-direction: row; gap: 7px; }
.pp-button { border: 2px solid #fff6dd; background: #f8c860; color: #193f4b; font-family: inherit; font-weight: 900; font-size: 13px; padding: 10px 15px; border-radius: 12px; box-shadow: 0 3px 0 #193f4b22; cursor: pointer; pointer-events: auto; transition: transform .15s, background .15s; }
.pp-button:hover { transform: translateY(-2px); background: #ffd887; }
.pp-button:focus-visible { outline: 3px solid #193f4b; outline-offset: 3px; }
.pp-secondary { background: #d7eee1; }
.pp-toast { padding: 12px 23px; border-radius: 28px; background: #193f4bed; max-width: 76%; text-align: center; }
.pp-toast-text { color: #fff4dd; font-size: 16px; font-weight: 800; white-space: normal; }
.pp-modal { display: flex; flex-direction: column; gap: 15px; width: 420px; max-width: 90vw; max-height: 90%; overflow: auto; padding: 30px; text-align: center; border-radius: 28px; border: 3px solid #ffffffb8; background: #fff4ddf7; box-shadow: 0 25px 100px #193f4b66; pointer-events: auto; }
.pp-heading { font-size: 34px; line-height: 1.08; font-weight: 900; letter-spacing: -1px; white-space: normal; }
.pp-body { font-size: 14px; line-height: 1.6; white-space: normal; color: #456666; }
.pp-stars { color: #c17c1a; font-size: 40px; letter-spacing: 6px; }
.pp-result-score { font-size: 20px; font-weight: 900; }
.pp-remix { font-size: 11px; line-height: 1.5; color: #668078; white-space: normal; }
@media(max-width:640px) { .pp-brand { padding: 8px 10px; } .pp-title { font-size: 21px; } .pp-eyebrow { font-size: 8px; letter-spacing: 1px; } .pp-stats { padding: 9px 12px; } .pp-count { font-size: 23px; } .pp-button { padding: 8px; font-size: 11px; } .pp-controls { width: 92%; } .pp-modal { padding: 20px; gap: 10px; } .pp-heading { font-size: 28px; } }
@media(prefers-reduced-motion:reduce) { .pp-button { transition: none; } }
`;
