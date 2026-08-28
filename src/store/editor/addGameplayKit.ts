import type { EditorState } from '../editorStore';
import type { AnimatorCondition, AnimatorController, AnimatorParameter } from '../../types';
import { selectActiveObjects } from './storeHelpers';
import { makeId } from './ids';

export interface AddGameplayKitResult {
  next: Partial<EditorState> | EditorState;
  summary: string;
}

/** Add an animator "gameplay kit" (ranged / health / interactions / emotes) to an object's controller. */
export const applyAddGameplayKit = (
  draft: EditorState,
  objectId: string,
  kit: string,
): AddGameplayKitResult => {
  let summary = '';

      const object = selectActiveObjects(draft).find((o) => o.id === objectId);
      const controller = draft.animatorControllers.find((c) => c.id === object?.animator?.controllerId);
      if (!object || !controller) return { next: draft, summary };
      const clips = draft.animations.filter((a) => a.skeletonId === controller.skeletonId);
      const pick = (...patterns: RegExp[]) => {
        for (const p of patterns) {
          const f = clips.find((c) => p.test(c.name));
          if (f) return f.id;
        }
        return undefined;
      };
      const params = [...controller.parameters];
      const states = [...controller.states];
      const transitions = [...controller.transitions];
      let nextVariables = draft.variables;
      const C = (parameterId: string, op: AnimatorCondition['op'], value: number | boolean): AnimatorCondition => ({ parameterId, op, value });
      const ensureParam = (name: string, type: AnimatorParameter['type'], source: AnimatorParameter['source'], defaultValue: number | boolean, variableId?: string) => {
        let p = params.find((x) => x.name === name);
        if (!p) {
          p = { id: makeId('param'), name, type, source, defaultValue, ...(variableId ? { variableId } : {}) };
          params.push(p);
        }
        return p.id;
      };
      // "Home" = the locomotion idle we return action states to.
      const homeId = (
        states.find((s) => /^idle$/i.test(s.name)) ??
        states.find((s) => /idle/i.test(s.name) && !/pistol|crouch/i.test(s.name)) ??
        states.find((s) => s.id === controller.defaultStateId) ??
        states[0]
      ).id;
      let placeX = 60;
      let placeY = 760;
      const addState = (name: string, animationId: string | undefined, loop: boolean) => {
        if (!animationId) return undefined;
        const existing = states.find((s) => s.name === name);
        if (existing) return existing.id;
        const id = makeId('state');
        states.push({ id, name, animationId, speed: 1, loop, position: { x: placeX, y: placeY } });
        placeX += 240;
        if (placeX > 820) {
          placeX = 60;
          placeY += 160;
        }
        return id;
      };
      const link = (from: string, to: string, conds: AnimatorCondition[], duration = 0.12) =>
        transitions.push({ id: makeId('xition'), from, to, conditions: conds, duration });
      const linkAny = (to: string, conds: AnimatorCondition[], duration = 0.12) =>
        transitions.push({ id: makeId('xition'), from: 'any', to, conditions: conds, duration });
      const linkExit = (from: string, to: string, conds: AnimatorCondition[] = [], exitTime = 0.9) =>
        transitions.push({ id: makeId('xition'), from, to, conditions: conds, duration: 0.12, hasExitTime: true, exitTime });

      if (kit === 'ranged') {
        const aiming = ensureParam('Aiming', 'bool', 'aiming', false);
        const reloading = ensureParam('Reloading', 'bool', 'reloading', false);
        const attacking = ensureParam('Attacking', 'bool', 'attacking', false);
        const ranged = ensureParam('RangedMode', 'bool', 'manual', false);
        const pistolIdle = addState('Pistol Idle', pick(/pistol.*idle/i), true);
        const aim = addState('Aim', pick(/pistol.*aim.*neutral/i, /pistol.*aim/i), true);
        const shoot = addState('Shoot', pick(/pistol.*shoot/i), false);
        const reload = addState('Reload', pick(/pistol.*reload/i), false);
        if (pistolIdle) {
          const meleeStateIds = new Set(
            states.filter((state) => /sword attack|punch|kick/i.test(state.name)).map((state) => state.id),
          );
          transitions.forEach((transition) => {
            if (!meleeStateIds.has(transition.to)) return;
            if (transition.conditions.some((condition) => condition.parameterId === ranged)) return;
            transition.conditions = [...transition.conditions, C(ranged, '==', false)];
          });
          const linkFirst = (from: string, to: string, conds: AnimatorCondition[], duration = 0.08) =>
            transitions.unshift({ id: makeId('xition'), from, to, conditions: conds, duration });
          link(homeId, pistolIdle, [C(ranged, '==', true)]);
          link(pistolIdle, homeId, [C(ranged, '==', false)]);
          if (aim) {
            link(pistolIdle, aim, [C(aiming, '==', true)]);
            link(aim, pistolIdle, [C(aiming, '==', false)]);
          }
          if (shoot) {
            linkFirst(homeId, shoot, [C(ranged, '==', true), C(attacking, '==', true)]);
            link(pistolIdle, shoot, [C(attacking, '==', true)]);
            if (aim) link(aim, shoot, [C(attacking, '==', true)]);
            linkExit(shoot, aim ?? pistolIdle);
          }
          if (reload) {
            link(pistolIdle, reload, [C(reloading, '==', true)]);
            if (aim) link(aim, reload, [C(reloading, '==', true)]);
            linkExit(reload, pistolIdle);
          }
          summary = 'ranged pistol (aim/shoot/reload)';
        }
      } else if (kit === 'health') {
        let healthVar = draft.variables.find((v) => v.name === 'Health');
        if (!healthVar) {
          healthVar = { id: makeId('var'), name: 'Health', type: 'number', defaultValue: 100, persistent: false, createdAt: Date.now() };
          nextVariables = [...draft.variables, healthVar];
        }
        const health = ensureParam('Health', 'float', 'variable', 100, healthVar.id);
        const hit = ensureParam('Hit', 'trigger', 'manual', false);
        const hitState = addState('Hit React', pick(/hit.*chest/i, /hit.*head/i, /hit/i), false);
        const deathState = addState('Death', pick(/death/i, /\bdie\b/i), false);
        if (hitState) {
          linkAny(hitState, [C(hit, '==', true)]);
          linkExit(hitState, homeId);
        }
        // Entering a "Death" state auto-triggers the ragdoll (see tickRuntime).
        if (deathState) linkAny(deathState, [C(health, '<=', 0)]);
        summary = 'health + hit reactions + death→ragdoll';
      } else if (kit === 'interactions') {
        const interacting = ensureParam('Interacting', 'bool', 'interacting', false);
        const interact = addState('Interact', pick(/^interact$/i, /pick.?up/i, /interact/i, /fixing/i), false);
        if (interact) {
          link(homeId, interact, [C(interacting, '==', true)]);
          linkExit(interact, homeId);
          summary = 'interactions (use / pick up)';
        }
      } else if (kit === 'emotes') {
        const emoting = ensureParam('Emoting', 'bool', 'emoting', false);
        const dance = addState('Emote', pick(/dance/i, /talk/i), true);
        if (dance) {
          link(homeId, dance, [C(emoting, '==', true)]);
          link(dance, homeId, [C(emoting, '==', false)]);
          summary = 'emote (dance/wave)';
        }
      }

      if (!summary) return { next: draft, summary };
      const nextController: AnimatorController = { ...controller, parameters: params, states, transitions };
      return { next: {
        variables: nextVariables,
        animatorControllers: draft.animatorControllers.map((c) => (c.id === controller.id ? nextController : c)),
        isDirty: true,
      }, summary };
};