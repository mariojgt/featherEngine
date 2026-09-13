import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { openEditor } from './harness.mjs';
const app = await openEditor({ baseUrl: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420', query: '?demo=store', width: 1440, height: 1000 });
const mark = async (text, id) => app.evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)}); if (!el) throw new Error('Missing button: ' + ${JSON.stringify(text)}); el.dataset.e2e = ${JSON.stringify(id)}; el.scrollIntoView({block:'center'}); })()`);
const choose = async (label, value) => app.evaluate(`(() => { const el = document.querySelector('select[aria-label="${label}"]'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const errors = [];
app.page.socket.on('message', data => { const message = JSON.parse(data.toString()); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text); });
try {
  const ids = await app.evaluate(`(async () => {
    const { blankProject } = await import('/src/project/serialize.ts');
    const s = window.__featherStore; s.loadProject(blankProject('Button actions browser check')); s.updateRenderSettings({quality:'Low', bloomEnabled:false});
    const menu=s.createUIDocument('Main menu','screen'), settings=s.createUIDocument('Settings','screen');
    s.updateUIDocument(settings,{visibleOnStart:false});
    const start=s.addUIElement(menu,undefined,'button'), resume=s.addUIElement(settings,undefined,'button');
    s.updateUIElement(menu,start,{name:'Open settings',text:'Open settings',style:{width:220,height:60}});
    s.updateUIElement(settings,resume,{name:'Back',text:'Back to menu',style:{width:220,height:60}});
    s.setUIButtonAction(settings,resume,{kind:'showUI',documentId:menu,hideCurrent:true});
    s.setActiveUIDocument(menu); s.selectUIElement(start); s.setUIEditorMode('design');
    const panels=await import('/src/components/workspacePanels.ts'); panels.focusWorkspacePanel('ui'); panels.toggleWorkspacePanelMaximized('ui');
    return {menu,settings,start,resume};
  })()`);
  await app.waitFor('document.querySelector(\'select[aria-label="Button action"]\')');
  await choose('Button action', 'showUI');
  assert.equal(await app.evaluate(`[...document.querySelectorAll('.ui-button-action button')].find(b=>b.textContent==='Apply action').disabled`), true);
  await choose('Action screen', ids.settings);
  await app.realClick('.ui-action-check input');
  await mark('Apply action', 'apply'); await app.realClick('[data-e2e="apply"]');
  assert.equal(await app.evaluate(`window.__featherStore.uiDocuments.find(d=>d.id===${JSON.stringify(ids.menu)}).root.children[0].clickAction.action.kind`), 'showUI');
  let shot = await app.page.call('Page.captureScreenshot', {format:'png'}); writeFileSync('/tmp/feather-button-action-designer.png', Buffer.from(shot.data,'base64'));
  await mark('Show logic', 'logic'); await app.realClick('[data-e2e="logic"]');
  await app.waitFor('document.querySelector(".ui-panel .react-flow") && window.__featherStore.selectedGraphNodeId');
  assert.equal(await app.evaluate('window.__featherStore.uiEditorMode'), 'logic');
  const nodeId = await app.evaluate('window.__featherStore.selectedGraphNodeId');
  await app.waitFor(`document.querySelector('.ui-panel .react-flow__node[data-id="${nodeId}"]')?.classList.contains('selected')`);
  shot = await app.page.call('Page.captureScreenshot', {format:'png'}); writeFileSync('/tmp/feather-button-action-logic.png', Buffer.from(shot.data,'base64'));
  // Break this click's execution wire and verify the visible repair entry focuses its exact event.
  await app.evaluate(`(() => { const s=window.__featherStore, g=s.activeGraph(); s.onEdgesChange([{type:'remove',id:g.edges.find(e=>e.source===${JSON.stringify(nodeId)}).id}]); })()`);
  await app.waitFor('document.querySelector(\'[aria-label="Logic guidance"]\')?.textContent.includes("stops here")');
  await app.evaluate(`(() => { const el=[...document.querySelectorAll('[aria-label="Logic guidance"] button')].find(b=>b.textContent.includes('stops here')); el.dataset.e2e='repair'; })()`);
  await app.realClick('[data-e2e="repair"]'); assert.equal(await app.evaluate('window.__featherStore.selectedGraphNodeId'), nodeId);
  // Restore through the public action API, then exercise actual rendered game buttons.
  await app.evaluate(`window.__featherStore.setUIButtonAction(${JSON.stringify(ids.menu)},${JSON.stringify(ids.start)},{kind:'showUI',documentId:${JSON.stringify(ids.settings)},hideCurrent:true})`);
  await app.evaluate(`(async () => { const panels=await import('/src/components/workspacePanels.ts'); if(panels.isWorkspacePanelMaximized('ui')) panels.toggleWorkspacePanelMaximized('ui'); window.scrollTo(0,0); })()`);
  console.log('Designer, graph selection and repair navigation passed; starting Play');
  await app.realClick('[data-creator-mode="play"]');
  await app.waitFor('window.__featherStore.isPlaying && window.__featherStore.runtimeTime > 0.1');
  await mark('Open settings', 'open-settings'); await app.realClick('[data-e2e="open-settings"]');
  await app.waitFor(`window.__featherStore.runtimeVisibleUI[${JSON.stringify(ids.settings)}] && !window.__featherStore.runtimeVisibleUI[${JSON.stringify(ids.menu)}]`);
  await mark('Back to menu', 'back'); await app.realClick('[data-e2e="back"]');
  await app.waitFor(`window.__featherStore.runtimeVisibleUI[${JSON.stringify(ids.menu)}] && !window.__featherStore.runtimeVisibleUI[${JSON.stringify(ids.settings)}]`);
  await app.realClick('[data-creator-mode="build"]');
  assert.equal(await app.evaluate('window.__featherStore.isPlaying'), false);
  assert.deepEqual(errors, []);
  const bundle = await app.evaluate(`(async () => (await import('/src/project/exportGame.ts')).buildGameBundle(window.__featherStore.exportProject()))()`);
  writeFileSync('/tmp/feather-ui-actions-game.json', JSON.stringify(bundle));
  console.log(JSON.stringify({result:'passed',checks:['action picker','Show logic selection','repair navigation','real game buttons','clean Stop'],screenshots:['/tmp/feather-button-action-designer.png','/tmp/feather-button-action-logic.png'],bundle:'/tmp/feather-ui-actions-game.json'}));
} catch (error) {
  const shot=await app.page.call('Page.captureScreenshot',{format:'png'}); writeFileSync('/tmp/feather-ui-actions-failure.png',Buffer.from(shot.data,'base64'));
  throw error;
} finally { await app.dispose(); }
