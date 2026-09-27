import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { delay } from './cdp.mjs';

// Check rendered joint transforms with real keyboard input. State labels alone
// cannot catch a courier sliding while its animation rig stays still.
export async function verifyCourierMotion(app, out) {
  await app.evaluate(`(async () => {
    window.ppMotionPlayer = __featherStore.activeScene().objects.find(o => o.creatorRoleId === 'player').id;
    const { _roots } = await import('/node_modules/.vite/deps/@react-three_fiber.js');
    window.ppMotionRoots = _roots;
  })()`);
  await delay(750);
  const sample = () => app.evaluate(`(() => {
    const s = __featherStore;
    const objects = s.activeScene().objects;
    const scene = [...ppMotionRoots.values()].map(r => r.store.getState().scene).find(s => s.children.length);
    const names = ['Pip · Head pivot', 'Pip · Left shoulder pivot', 'Pip · Left hip pivot', 'Pip · Left little boot'];
    return {
      state: s.runtimeObjectVariables[ppMotionPlayer].ppc_anim_state,
      carry: s.runtimeVariableValues[s.variables.find(v => v.name === 'PPCarry').id],
      position: objects.find(o => o.id === ppMotionPlayer).transform.position,
      joints: names.map(name => {
        const object = objects.find(o => o.name === name);
        let group;
        scene.traverse(node => { if (node.userData.nfObjectId === object.id) group = node; });
        if (!group) throw Error('No rendered group: ' + name);
        return { name, rotation: group.rotation.toArray().slice(0, 3), world: group.matrixWorld.elements.slice(12, 15) };
      }),
    };
  })()`);
  const screenshot = async name => writeFile(`${out}/${name}.png`, Buffer.from(
    (await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64',
  ));
  const samples = { idle: [], walk: [], stopped: [] };
  for (let i = 0; i < 7; i++) {
    samples.idle.push(await sample());
    await delay(170);
  }
  await screenshot('courier-idle');
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd' });
  try {
    for (let i = 0; i < 8; i++) {
      await delay(100);
      samples.walk.push(await sample());
      if (i === 4) await screenshot('courier-walk');
    }
  } finally {
    await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd' });
  }
  await delay(700);
  for (let i = 0; i < 4; i++) {
    samples.stopped.push(await sample());
    await delay(140);
  }
  await writeFile(`${out}/courier-motion.json`, JSON.stringify(samples, null, 2));
  const span = (frames, joint, axis) => {
    const angles = frames.map(frame => frame.joints[joint].rotation[axis]);
    return Math.max(...angles) - Math.min(...angles);
  };
  assert.ok(samples.idle.every(s => s.state === 'idle'), 'idle remains stable despite gravity');
  assert.ok(span(samples.idle, 0, 1) > .025 || span(samples.idle, 0, 2) > .025, 'rendered idle head movement');
  assert.ok(samples.walk.filter(s => s.state === 'walk').length >= 6, 'empty-handed walk animation');
  assert.ok(span(samples.walk, 1, 0) > .4, 'rendered arms swing');
  assert.ok(span(samples.walk, 2, 0) > .4, 'rendered legs stride');
  assert.ok(samples.walk.every(s => s.carry === ''), 'walk without a parcel');
  const first = samples.walk[0].position;
  const last = samples.walk.at(-1).position;
  assert.ok(Math.hypot(last[0] - first[0], last[2] - first[2]) > 1, 'keyboard input moves the courier');
  assert.ok(samples.stopped.every(s => s.state === 'idle'), 'stops and settles to idle');
  console.log('PASS: rendered courier breathes at idle, swings arms and legs while walking empty-handed, and settles after stopping.');
}
