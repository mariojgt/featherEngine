import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Bug } from 'lucide-react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { AssetItem, Prefab, ProjectGraph, ScriptBlueprint, SceneObject, UIDocument, ProjectVariable } from '../types';

export interface Problem {
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** Click target: select this object… */
  objectId?: string;
  /** …or open this blueprint. */
  blueprintId?: string;
}

const SPAWN_KINDS = new Set(['action.spawnObject', 'action.spawnPrefab', 'action.spawnProjectile', 'action.spawnParticleSystem']);
const GATE_KINDS = new Set(['logic.cooldown', 'logic.doOnce', 'logic.branch', 'logic.delay', 'logic.forLoop', 'logic.forEachActor']);
const EXPR_KEYWORDS = new Set(['self', 'vars', 'true', 'false']);

/** Pull candidate variable names out of a UI binding expression (bare identifiers + vars['…']). */
function expressionIdentifiers(expression: string): string[] {
  const names: string[] = [];
  // vars['Display Name'] style references.
  for (const m of expression.matchAll(/vars\[\s*'([^']+)'\s*\]/g)) names.push(m[1]);
  // Strip quoted strings + self.* paths, then collect bare identifiers.
  const stripped = expression.replace(/'[^']*'/g, '').replace(/self\.[A-Za-z_][A-Za-z0-9_]*/g, '').replace(/vars\[[^\]]*\]/g, '');
  for (const m of stripped.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    if (!EXPR_KEYWORDS.has(m[0])) names.push(m[0]);
  }
  return names;
}

/** One full diagnostics sweep — pure function of the project structures (never runs per-frame). */
export function scanProblems(
  objects: SceneObject[],
  graphs: ProjectGraph[],
  blueprints: ScriptBlueprint[],
  assets: AssetItem[],
  variables: ProjectVariable[],
  uiDocuments: UIDocument[],
  prefabs: Prefab[] = [],
): Problem[] {
  const problems: Problem[] = [];
  const assetIds = new Set(assets.map((a) => a.id));
  const prefabById = new Map(prefabs.map((p) => [p.id, p]));
  const blueprintById = new Map(blueprints.map((b) => [b.id, b]));
  const graphIds = new Set(graphs.map((g) => g.id));
  const variableNames = new Set(variables.map((v) => v.name));
  const usedBlueprintIds = new Set<string>();

  for (const object of objects) {
    if (object.renderer?.modelAssetId && !assetIds.has(object.renderer.modelAssetId)) {
      problems.push({ severity: 'error', message: `"${object.name}" uses a model asset that no longer exists.`, objectId: object.id });
    }
    if (object.script?.blueprintId) {
      usedBlueprintIds.add(object.script.blueprintId);
      const blueprint = blueprintById.get(object.script.blueprintId);
      if (!blueprint) {
        problems.push({ severity: 'error', message: `"${object.name}" is scripted with a blueprint that no longer exists.`, objectId: object.id });
      } else if (!graphIds.has(blueprint.graphId)) {
        problems.push({ severity: 'error', message: `Blueprint "${blueprint.name}" lost its node graph.`, blueprintId: blueprint.id });
      }
    }
    if (object.physics?.isTrigger && !object.script?.blueprintId) {
      problems.push({
        severity: 'info',
        message: `Trigger "${object.name}" has no blueprint — nothing happens when something enters it.`,
        objectId: object.id,
      });
    }
    if (object.prefabSourceId && prefabs.length > 0 && !prefabById.has(object.prefabSourceId)) {
      problems.push({
        severity: 'warning',
        message: `"${object.name}" links to a prefab that no longer exists — Apply/Revert will do nothing.`,
        objectId: object.id,
      });
    }
    if (object.vehicle?.enabled && object.vehicle.physicsModel === 'raycast') {
      const wheels = object.vehicle.wheels?.length ?? object.vehicle.wheelObjectIds?.length ?? 0;
      if (wheels === 0) {
        problems.push({ severity: 'warning', message: `Sim car "${object.name}" has no wheels in its Wheel Rig.`, objectId: object.id });
      }
      for (const bodyId of object.vehicle.garageBodyIds ?? []) {
        if (!assetIds.has(bodyId)) {
          problems.push({ severity: 'warning', message: `"${object.name}" garage lists a body model that no longer exists.`, objectId: object.id });
          break;
        }
      }
    }
  }

  // Blueprint-level checks.
  const uiLogicIds = new Set(uiDocuments.map((d) => d.logicBlueprintId).filter(Boolean));
  for (const blueprint of blueprints) {
    if (!usedBlueprintIds.has(blueprint.id) && !uiLogicIds.has(blueprint.id)) {
      problems.push({ severity: 'info', message: `Blueprint "${blueprint.name}" isn't attached to any object, so it never runs.`, blueprintId: blueprint.id });
    }
    const graph = graphs.find((g) => g.id === blueprint.graphId);
    if (!graph) continue;
    // Update → Spawn with no gate: spawns a new object EVERY FRAME (the classic runaway-scene footgun).
    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
    const execTargets = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (edge.targetHandle && edge.targetHandle !== 'exec-in') continue; // value wire
      const list = execTargets.get(edge.source);
      if (list) list.push(edge.target);
      else execTargets.set(edge.source, [edge.target]);
    }
    for (const node of graph.nodes) {
      if (node.data.nodeKind !== 'event.update' || Number(node.data.numberValue ?? 0) > 0) continue;
      const visited = new Set<string>();
      const queue = [...(execTargets.get(node.id) ?? [])];
      while (queue.length) {
        const id = queue.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const kind = nodesById.get(id)?.data.nodeKind ?? '';
        if (GATE_KINDS.has(kind)) continue; // a gate bounds the rate — fine past here
        if (SPAWN_KINDS.has(kind)) {
          problems.push({
            severity: 'warning',
            message: `Blueprint "${blueprint.name}": Update spawns every frame with no gate — add a Cooldown/Timer or the scene floods.`,
            blueprintId: blueprint.id,
          });
          queue.length = 0;
          break;
        }
        queue.push(...(execTargets.get(id) ?? []));
      }
    }
    // Play Sound nodes pointing at deleted audio assets.
    for (const node of graph.nodes) {
      if (node.data.nodeKind === 'action.playSound' && node.data.assetId && !assetIds.has(node.data.assetId)) {
        problems.push({ severity: 'warning', message: `Blueprint "${blueprint.name}": a Play Sound node references a deleted audio asset.`, blueprintId: blueprint.id });
        break;
      }
    }
    // Spawn Prefab nodes pointing at deleted prefabs (the runtime also prints, but catch it at edit time).
    if (prefabs.length > 0) {
      for (const node of graph.nodes) {
        if (node.data.nodeKind === 'action.spawnPrefab' && node.data.prefabId && !prefabById.has(node.data.prefabId)) {
          problems.push({ severity: 'error', message: `Blueprint "${blueprint.name}": a Spawn Prefab node references a deleted prefab — it will spawn nothing.`, blueprintId: blueprint.id });
          break;
        }
      }
    }
  }

  // Prefab template health: refs captured INSIDE a prefab go stale silently and ship into every stamp.
  for (const prefab of prefabs) {
    for (const object of prefab.objects) {
      if (object.script?.blueprintId && !blueprintById.has(object.script.blueprintId)) {
        problems.push({ severity: 'warning', message: `Prefab "${prefab.name}": "${object.name}" is scripted with a blueprint that no longer exists.` });
        break;
      }
    }
    for (const object of prefab.objects) {
      if (object.renderer?.modelAssetId && !assetIds.has(object.renderer.modelAssetId)) {
        problems.push({ severity: 'warning', message: `Prefab "${prefab.name}": "${object.name}" uses a model asset that no longer exists.` });
        break;
      }
    }
    // Containment cycle (A nests B nests A) — corrupts restamp/merge; the editor guard blocks new ones,
    // but flag any that snuck in via older saves or imported packages.
    const visited = new Set<string>();
    const queue = prefab.objects.map((o) => o.prefabSourceId).filter((id): id is string => Boolean(id));
    let cyclic = false;
    while (queue.length && !cyclic) {
      const id = queue.pop()!;
      if (id === prefab.id) cyclic = true;
      else if (!visited.has(id)) {
        visited.add(id);
        for (const o of prefabById.get(id)?.objects ?? []) if (o.prefabSourceId) queue.push(o.prefabSourceId);
      }
    }
    if (cyclic) {
      problems.push({ severity: 'error', message: `Prefab "${prefab.name}" contains an instance of itself (a nesting cycle) — un-nest it or edits will misbehave.` });
    }
  }

  // UI bindings referencing variables that don't exist (typos are silent at runtime).
  for (const doc of uiDocuments) {
    const walk = (el: UIDocument['root']) => {
      for (const binding of el.bindings) {
        for (const name of expressionIdentifiers(binding.expression)) {
          if (!variableNames.has(name)) {
            problems.push({
              severity: 'warning',
              message: `UI "${doc.name}" / "${el.name}": binding references unknown variable "${name}".`,
            });
          }
        }
      }
      el.children.forEach(walk);
    };
    walk(doc.root);
  }

  // Errors first, then warnings, then info.
  const order = { error: 0, warning: 1, info: 2 } as const;
  return problems.sort((a, b) => order[a.severity] - order[b.severity]);
}

const DOT_COLOR = { error: '#ff5d5d', warning: '#ffd34d', info: '#7d8aa5' } as const;

/**
 * Live project diagnostics: a toolbar chip with a problem count, opening a list of everything that's
 * silently broken or inert — missing assets, dead blueprint refs, do-nothing triggers, Update-spawn
 * floods, UI bindings to unknown variables. Click an entry to jump to the offender. The scan reruns
 * only when project STRUCTURES change (and freezes during Play — the tick churns scene identity).
 */
export function ProblemsButton() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  // Gate the volatile subscription during Play so the scan never reruns per-frame.
  const objects = useEditorStore((state) => (state.isPlaying ? null : selectActiveObjects(state)));
  const graphs = useEditorStore((state) => state.graphs);
  const blueprints = useEditorStore((state) => state.blueprints);
  const assets = useEditorStore((state) => state.assets);
  const variables = useEditorStore((state) => state.variables);
  const uiDocuments = useEditorStore((state) => state.uiDocuments);
  const prefabs = useEditorStore((state) => state.prefabs);
  const selectObject = useEditorStore((state) => state.selectObject);
  const setActiveBlueprint = useEditorStore((state) => state.setActiveBlueprint);
  const [open, setOpen] = useState(false);
  const frozen = useRef<Problem[]>([]);

  const computed = useMemo(
    () => (objects ? scanProblems(objects, graphs, blueprints, assets, variables, uiDocuments, prefabs) : null),
    [objects, graphs, blueprints, assets, variables, uiDocuments, prefabs],
  );
  if (computed) frozen.current = computed;
  const problems = frozen.current;
  const errorCount = problems.filter((p) => p.severity === 'error').length;
  const warnCount = problems.filter((p) => p.severity === 'warning').length;

  return (
    <div className="problems-anchor">
      <button
        className="icon-button compact"
        title={problems.length ? `${errorCount} errors · ${warnCount} warnings — click for details` : 'No problems found'}
        style={problems.length ? { color: errorCount ? DOT_COLOR.error : DOT_COLOR.warning } : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        {problems.length ? <AlertTriangle size={15} aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
        {problems.length > 0 && <span className="problems-badge">{problems.length}</span>}
      </button>
      {open && (
        <div className="problems-pop">
          <div className="problems-head">
            <strong>Problems</strong>
            <span>{isPlaying ? 'paused during Play' : problems.length ? `${problems.length} found` : 'all clear'}</span>
          </div>
          {problems.length === 0 && <div className="problems-empty">Nothing broken or inert — nice. ✓</div>}
          <div className="problems-rows">
            {problems.map((problem, index) => (
              <button
                key={index}
                className="problems-row"
                onClick={() => {
                  if (problem.objectId) selectObject(problem.objectId);
                  if (problem.blueprintId) setActiveBlueprint(problem.blueprintId);
                  setOpen(false);
                }}
              >
                <span className="problems-dot" style={{ background: DOT_COLOR[problem.severity] }} />
                <span>{problem.message}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Play-only sibling of {@link ProblemsButton}. The static Problems scan is frozen during Play,
 * so a blueprint node that throws at runtime (null ref, bad cast, divide-by-zero in user logic)
 * is otherwise only visible in the in-game console. `tickRuntime` pushes a deduped
 * `⚠️ Script error in "<obj>": <msg>` line into `runtimeLog` for each one; this badge surfaces
 * that count next to the run button and lists the distinct errors in a popover so the user gets
 * an immediate signal that their scripts misbehaved.
 */
export function RuntimeErrorBadge() {
  const clearRuntimeLog = useEditorStore((state) => state.clearRuntimeLog);
  // Number selector → this only re-renders when the error count actually changes, not every
  // frame Play mutates the store. The ⚠️ prefix is written exclusively by the script-error guard.
  const errorCount = useEditorStore((state) => {
    if (!state.isPlaying) return 0;
    let n = 0;
    for (const line of state.runtimeLog) if (line.startsWith('⚠️')) n++;
    return n;
  });
  const [open, setOpen] = useState(false);

  if (errorCount === 0) {
    if (open) setOpen(false);
    return null;
  }

  // Read full lines on demand (cheap, only while the popover is open). De-dupe identical messages.
  const lines = open
    ? Array.from(new Set(useEditorStore.getState().runtimeLog.filter((l) => l.startsWith('⚠️'))))
    : [];

  return (
    <div className="problems-anchor">
      <button
        className="icon-button compact"
        title={`${errorCount} script error${errorCount === 1 ? '' : 's'} during Play — click for details`}
        style={{ color: DOT_COLOR.error }}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Bug size={15} aria-hidden />
        <span className="problems-badge">{errorCount}</span>
      </button>
      {open && (
        <div className="problems-pop">
          <div className="problems-head">
            <strong>Script errors</strong>
            <button className="problems-clear" onClick={() => clearRuntimeLog()}>
              Clear
            </button>
          </div>
          <div className="problems-rows">
            {lines.map((line, index) => (
              <div key={index} className="problems-row" style={{ cursor: 'default' }}>
                <span className="problems-dot" style={{ background: DOT_COLOR.error }} />
                <span>{line.replace(/^⚠️\s*/, '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
