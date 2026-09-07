import { useEditorStore } from '../store/editorStore';

/** Ordinary UI + Blueprint content: menus are editable and travel through the same export path. */
export function addPlatformerGameMenu(hudId: string, parentId: string, winPanelId: string, sceneId: string) {
  const store = useEditorStore.getState();
  for (const name of ['GameStarted', 'MenuOpen']) {
    const id = store.createVariable(name, 'boolean', false);
    store.updateVariable(id, { defaultValue: false });
  }
  const menuRoot = store.createObjectWithProps('empty', { name: 'Cloudstep Game Flow — Start, Pause, Restart', parentId });
  const { blueprintId } = store.createBlueprintNamed('Cloudstep Game Flow', 'Start and pause use Time.scale; Restart restores the authored scene and resets this run.');
  const source = [
    'blueprint Cloudstep_Game_Flow',
    'on start:',
    '    if Game.GameStarted == false:',
    '        Game.MenuOpen = true',
    '        Time.scale = 0',
    'on event CloudstepResume(payload):',
    '    Game.GameStarted = true',
    '    Game.MenuOpen = false',
    '    Time.scale = 1',
    'on event CloudstepPause(payload):',
    '    Game.MenuOpen = true',
    '    Time.scale = 0',
    'on key_pressed("KeyP"):',
    '    if Game.MenuOpen:',
    '        Game.GameStarted = true',
    '        Game.MenuOpen = false',
    '        Time.scale = 1',
    '    else:',
    '        Game.MenuOpen = true',
    '        Time.scale = 0',
    'on event CloudstepRestart(payload):',
    '    Game.Score = 0',
    '    Game.Checkpoint = 0',
    '    Game.LevelComplete = false',
    '    Game.PipHearts = 3',
    '    Game.FallOut = false',
    '    Game.PipBoost = false',
    '    Game.GameStarted = true',
    '    Game.MenuOpen = false',
    '    Time.scale = 1',
    `    Scene.load(${JSON.stringify(sceneId)})`,
  ].join('\n');
  const result = store.applyBlueprintFeatherSource(blueprintId, source);
  if (!result.ok) throw new Error(`Game menu could not compile: ${result.diagnostics.map((item) => item.message).join('; ')}`);
  store.attachScript(menuRoot, blueprintId);
  const root = useEditorStore.getState().uiDocuments.find((doc) => doc.id === hudId)!.root.id;
  const pause = store.addUIElement(hudId, root, 'button');
  store.updateUIElement(hudId, pause, { name: 'Pause game', text: 'Pause · P', onClickEvent: 'CloudstepPause', className: 'cloudstep-menu-button', anchor: { h: 'right', v: 'bottom', offsetX: 24, offsetY: 24 } });
  store.setUIBinding(hudId, pause, 'visible', 'MenuOpen == false');
  const panel = store.addUIElement(hudId, root, 'panel');
  store.updateUIElement(hudId, panel, { name: 'Start and Pause Menu', className: 'cloudstep-game-menu', anchor: { h: 'center', v: 'middle', offsetX: 0, offsetY: 0 }, style: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '28px', width: '360px', maxWidth: '90vw', textAlign: 'center', alignItems: 'stretch' } });
  store.setUIBinding(hudId, panel, 'visible', 'MenuOpen');
  const title = store.addUIElement(hudId, panel, 'text');
  store.updateUIElement(hudId, title, { name: 'Menu title', text: 'CLOUDSTEP GARDEN', style: { fontSize: '28px', fontWeight: '900', color: '#183D50' } });
  store.setUIBinding(hudId, title, 'text', "GameStarted ? 'Take a breather' : 'CLOUDSTEP GARDEN'");
  const description = store.addUIElement(hudId, panel, 'text');
  store.updateUIElement(hudId, description, { name: 'How to play', text: 'Collect sun seeds, follow the clouds, and find Sunny. The pinwheel saves your checkpoint. WASD move · Space jump · Shift dash · Left click bop · P pause or resume', style: { color: '#31566A', fontSize: '13px', whiteSpace: 'normal' } });
  const resume = store.addUIElement(hudId, panel, 'button');
  store.updateUIElement(hudId, resume, { name: 'Start or resume game', text: 'Let’s play', onClickEvent: 'CloudstepResume', className: 'cloudstep-menu-button' });
  store.setUIBinding(hudId, resume, 'text', "GameStarted ? 'Resume game' : 'Let’s play'");
  for (const parent of [panel, winPanelId]) {
    const restart = store.addUIElement(hudId, parent, 'button');
    store.updateUIElement(hudId, restart, { name: parent === panel ? 'Restart from pause' : 'Play again', text: parent === panel ? 'Restart course' : 'Play again', onClickEvent: 'CloudstepRestart', className: 'cloudstep-menu-button secondary' });
    if (parent === panel) store.setUIBinding(hudId, restart, 'visible', 'GameStarted');
  }
}

export const PLATFORMER_MENU_CSS = [
  '.cloudstep-game-menu { border: 2px solid rgba(255,255,255,.85); background: linear-gradient(150deg,#fff9e9,#d3f8ed); border-radius: 24px; box-shadow: 0 24px 80px rgba(18,54,76,.28); pointer-events: auto; z-index: 20; }',
  '.cloudstep-menu-button { padding: 11px 17px; border: 2px solid rgba(255,255,255,.8); border-radius: 14px; color: #153C4B; background: #FFD765; font-weight: 800; cursor: pointer; box-shadow: 0 4px 0 rgba(31,85,91,.16); pointer-events: auto; }',
  '.cloudstep-menu-button.secondary { background: #DAF6EF; }',
  '.cloudstep-menu-button:hover { filter: brightness(1.06); }',
  '.cloudstep-menu-button:focus-visible { outline: 3px solid #234F77; outline-offset: 3px; }',
].join('\n');
