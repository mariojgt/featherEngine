import { buildGraphRuntime, type GraphRuntime } from '../store/editor/graphRuntime';
import type {
  GraphNodeKind,
  GraphValue,
  GraphValueType,
  NodeForgeNode,
  ProjectGraph,
  ProjectVariable,
  ScriptBlueprint,
  Vector3Tuple,
} from '../types';
import { encodeTimelineCurve } from '../runtime/timelineCurve';

export interface FeatherScriptPrintOptions {
  blueprint: ScriptBlueprint;
  graph: ProjectGraph;
  variables?: ProjectVariable[];
  blueprints?: ScriptBlueprint[];
}

const SYSTEM_DATA_KEYS = new Set([
  'label',
  'nodeKind',
  'category',
  'description',
  'tone',
  'hasInput',
  'hasOutput',
  'liveValue',
]);

const DEFAULT_EXEC_HANDLE = 'exec-out';
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Instance-var keys that would read as transform pseudo-values — printed as get_var/set_var instead. */
const AMBIGUOUS_SELF_KEYS = new Set(['position', 'rotation', 'scale', 'forward']);

/** Block boundary marker for structured if/else printing: nodes in `set` are NOT printed inside the
 *  current block — they're recorded in `hits` so the block's owner prints them after it. */
interface BlockStop {
  set: Set<string>;
  hits: string[];
}

interface RawExpression {
  raw: string;
}

const raw = (value: string): RawExpression => ({ raw: value });
const isRawExpression = (value: GraphValue | RawExpression | undefined): value is RawExpression =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && 'raw' in value;

const sortByCanvas = (a: NodeForgeNode, b: NodeForgeNode) =>
  a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id);

const sanitizeIdentifier = (value: string | undefined, fallback: string): string => {
  const cleaned = (value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const candidate = cleaned || fallback;
  return /^[A-Za-z_]/.test(candidate) ? candidate : `_${candidate}`;
};

const propertyAccess = (owner: string, name: string | undefined, fallback: string): string => {
  const safe = sanitizeIdentifier(name, fallback);
  return safe === name ? `${owner}.${safe}` : `${owner}[${quote(name || fallback)}]`;
};

const quote = (value: string): string => JSON.stringify(value);

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  if (Object.is(value, -0)) return '0';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(5)));
};

const formatLiteral = (value: GraphValue | undefined): string => {
  if (value === undefined) return 'none';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return formatVector(value as Vector3Tuple);
  return quote(String(value));
};

const formatVector = (value: Vector3Tuple | readonly number[]): string => {
  const [x = 0, y = 0, z = 0] = value;
  return `vec3(${formatNumber(Number(x) || 0)}, ${formatNumber(Number(y) || 0)}, ${formatNumber(Number(z) || 0)})`;
};

const formatDataObject = (value: unknown): string => {
  if (value === undefined) return 'none';
  if (value === null) return 'none';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    if (value.length === 3 && value.every((item) => typeof item === 'number')) return formatVector(value as Vector3Tuple);
    return `[${value.map(formatDataObject).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    return `{ ${entries.map(([key, item]) => `${sanitizeIdentifier(key, key)}: ${formatDataObject(item)}`).join(', ')} }`;
  }
  return quote(String(value));
};

const typeName = (type: GraphValueType | undefined) => type ?? 'any';

const blueprintName = (blueprints: ScriptBlueprint[] | undefined, id: string | undefined): string | undefined =>
  id ? blueprints?.find((blueprint) => blueprint.id === id)?.name ?? id : undefined;

class FeatherScriptPrinter {
  private readonly runtime: GraphRuntime;
  private readonly variableById: Map<string, ProjectVariable>;
  private readonly blueprint: ScriptBlueprint;
  private readonly blueprints: ScriptBlueprint[] | undefined;
  private readonly emitted = new Set<string>();

  constructor(options: FeatherScriptPrintOptions) {
    this.runtime = buildGraphRuntime(options.graph);
    this.variableById = new Map((options.variables ?? []).map((variable) => [variable.id, variable]));
    this.blueprint = options.blueprint;
    this.blueprints = options.blueprints;
  }

  print(): string {
    const lines: string[] = [`blueprint ${sanitizeIdentifier(this.blueprint.name, 'Blueprint')}`];
    if (this.blueprint.description.trim()) lines.push('', `# ${this.blueprint.description.trim()}`);

    const vars = this.blueprint.variables ?? [];
    if (vars.length) {
      lines.push('');
      for (const variable of vars) {
        lines.push(
          `var ${sanitizeIdentifier(variable.name, 'value')}: ${typeName(variable.type)} = ${formatLiteral(
            variable.defaultValue,
          )}`,
        );
      }
    }

    const roots = [...this.runtime.eventRoots].sort(sortByCanvas);
    if (!roots.length) {
      lines.push('', '# No event roots yet.');
    }

    for (const root of roots) {
      lines.push('', ...this.printRoot(root));
    }

    const detached = [...this.runtime.graph.nodes]
      .filter((node) => !this.emitted.has(node.id))
      .filter((node) => node.data.nodeKind !== 'comment.note')
      .filter((node) => !node.data.nodeKind.startsWith('value.'))
      .filter((node) => !node.data.nodeKind.startsWith('math.'))
      .filter((node) => !node.data.nodeKind.startsWith('material.'))
      .filter((node) => this.runtime.eventRoots.every((root) => root.id !== node.id))
      .sort(sortByCanvas);
    if (detached.length) {
      lines.push('', 'detached:');
      for (const node of detached) this.printNode(node.id, 1, new Set(), lines);
    }

    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
  }

  private printRoot(root: NodeForgeNode): string[] {
    this.emitted.add(root.id);
    const lines: string[] = [this.rootHeader(root)];
    const targets = this.targets(root.id);
    if (!targets.length) lines.push(`${this.indent(1)}pass`);
    for (const targetId of targets) this.printNode(targetId, 1, new Set([root.id]), lines);
    return lines;
  }

  private rootHeader(root: NodeForgeNode): string {
    switch (root.data.nodeKind) {
      case 'event.start':
        return 'on start:';
      case 'event.update': {
        const interval = Number(root.data.numberValue ?? 0);
        return interval > 0 ? `on update every ${formatNumber(interval)}s:` : 'on update(dt):';
      }
      case 'event.keyDown':
        return `on key_down(${quote(root.data.keyCode ?? 'KeyW')}):`;
      case 'event.keyUp':
        return `on key_up(${quote(root.data.keyCode ?? 'KeyW')}):`;
      case 'event.custom':
        return `on event ${sanitizeIdentifier(root.data.eventName || 'CustomEvent', 'CustomEvent')}(payload):`;
      case 'event.collisionEnter':
        return root.data.otherObjectId
          ? `on collision_enter(other: ${quote(root.data.otherObjectId)}):`
          : 'on collision_enter(other):';
      case 'event.collisionExit':
        return root.data.otherObjectId
          ? `on collision_exit(other: ${quote(root.data.otherObjectId)}):`
          : 'on collision_exit(other):';
      case 'event.triggerEnter':
        return root.data.otherObjectId
          ? `on trigger_enter(other: ${quote(root.data.otherObjectId)}):`
          : 'on trigger_enter(other):';
      case 'event.triggerExit':
        return root.data.otherObjectId
          ? `on trigger_exit(other: ${quote(root.data.otherObjectId)}):`
          : 'on trigger_exit(other):';
      case 'event.interact':
        return 'on interact(player):';
      case 'event.receiveDamage':
        return 'on receive_damage(amount):';
      case 'event.timer':
        return `on timer(${formatNumber(Number(root.data.numberValue ?? 1))}):`;
      case 'event.land':
        return 'on land:';
      case 'event.functionEntry':
        return `function ${sanitizeIdentifier(root.data.functionName || 'MyFunction', 'MyFunction')}(a, b, c):`;
      default:
        return `on ${root.data.nodeKind}:`;
    }
  }

  private printNode(nodeId: string, depth: number, stack: Set<string>, lines: string[], stop?: BlockStop) {
    if (stop?.set.has(nodeId)) {
      // This node is the join after an if/else (or an outer block boundary): the caller prints it
      // at the right indentation instead.
      if (!stop.hits.includes(nodeId)) stop.hits.push(nodeId);
      return;
    }
    if (stack.has(nodeId)) {
      lines.push(`${this.indent(depth)}# cycle to ${this.nodeName(nodeId)}`);
      return;
    }
    const compiled = this.runtime.compiledNodesById.get(nodeId);
    if (!compiled) return;
    const node = compiled.node;
    this.emitted.add(nodeId);
    stack.add(nodeId);

    switch (node.data.nodeKind) {
      case 'comment.note':
        this.printComment(node, depth, lines);
        break;
      case 'logic.branch':
        this.printIf(node, depth, stack, lines, stop);
        break;
      case 'logic.cast':
        this.printCast(node, depth, stack, lines, stop);
        break;
      case 'logic.cooldown':
        this.printGate(node, depth, stack, lines, `cooldown(${this.valueInput(node, 'seconds', Number(node.data.numberValue ?? 1))})`, stop);
        break;
      case 'logic.doOnce':
        this.printGate(node, depth, stack, lines, 'do_once()', stop);
        break;
      case 'logic.delay':
        lines.push(`${this.indent(depth)}wait(${this.valueInput(node, 'seconds', Number(node.data.numberValue ?? 1))})`);
        this.printTargets(node.id, depth, stack, lines, DEFAULT_EXEC_HANDLE, stop);
        break;
      case 'logic.switch':
        this.printSwitch(node, depth, stack, lines);
        break;
      case 'logic.sequence':
        this.printSequence(node, depth, stack, lines);
        break;
      case 'logic.flipFlop':
        this.printFlipFlop(node, depth, stack, lines);
        break;
      case 'logic.forLoop':
        this.printForLoop(node, depth, stack, lines, stop);
        break;
      case 'logic.forEachActor':
        this.printForEachActor(node, depth, stack, lines, stop);
        break;
      case 'logic.functionReturn': {
        const returned = this.linkedValueInput(node, 'value');
        lines.push(`${this.indent(depth)}${returned ? `return ${returned}` : 'return'}`);
        break;
      }
      case 'logic.callFunction':
        lines.push(`${this.indent(depth)}${this.callFunctionExpression(node)}`);
        this.printTargets(node.id, depth, stack, lines, DEFAULT_EXEC_HANDLE, stop);
        break;
      case 'action.tweenProperty':
        this.printStatement(node, depth, lines);
        this.printTargets(node.id, depth, stack, lines, DEFAULT_EXEC_HANDLE, stop);
        this.printHandleBlock(node.id, 'exec-done', 'done', depth, stack, lines);
        break;
      default:
        this.printStatement(node, depth, lines);
        this.printTargets(node.id, depth, stack, lines, DEFAULT_EXEC_HANDLE, stop);
        break;
    }

    stack.delete(nodeId);
  }

  /** Every node reachable from `roots` along execution edges (any exec pin). */
  private execReachable(roots: string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...roots];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const compiled = this.runtime.compiledNodesById.get(id);
      if (!compiled) continue;
      for (const targets of compiled.outgoingByHandle.values()) queue.push(...targets);
      queue.push(...compiled.outgoing);
    }
    return seen;
  }

  private printIf(node: NodeForgeNode, depth: number, stack: Set<string>, lines: string[], stop?: BlockStop) {
    const trueTargets = this.targets(node.id);
    const falseTargets = this.targets(node.id, 'exec-false');
    // The join = nodes both paths eventually reach (the code AFTER the if/else). Each block stops
    // there; the join then prints once at this depth — reconstructing structured control flow.
    const join =
      falseTargets.length > 0
        ? new Set([...this.execReachable(trueTargets)].filter((id) => this.execReachable(falseTargets).has(id)))
        : new Set<string>();
    const blockStop: BlockStop = { set: new Set([...join, ...(stop?.set ?? [])]), hits: [] };

    lines.push(`${this.indent(depth)}if ${this.valueInput(node, 'condition', node.data.booleanValue ?? true)}:`);
    for (const targetId of trueTargets) this.printNode(targetId, depth + 1, stack, lines, blockStop);
    this.ensureBlockBody(depth + 1, lines);

    const elseTargets = falseTargets.filter((id) => !join.has(id));
    if (elseTargets.length) {
      lines.push(`${this.indent(depth)}else:`);
      for (const targetId of elseTargets) this.printNode(targetId, depth + 1, stack, lines, blockStop);
      this.ensureBlockBody(depth + 1, lines);
    } else {
      for (const targetId of falseTargets) if (join.has(targetId) && !blockStop.hits.includes(targetId)) blockStop.hits.push(targetId);
    }

    // Continue after the block: join nodes print here; anything belonging to an OUTER join is
    // handed back up to that caller.
    for (const hit of blockStop.hits) {
      if (stop?.set.has(hit)) {
        if (!stop.hits.includes(hit)) stop.hits.push(hit);
      } else {
        this.printNode(hit, depth, stack, lines, stop);
      }
    }
  }

  private printCast(node: NodeForgeNode, depth: number, stack: Set<string>, lines: string[], stop?: BlockStop) {
    const target = this.valueInput(node, 'object', raw(this.targetLiteral(node.data.targetObjectId)));
    const bp = blueprintName(this.blueprints, node.data.castBlueprintId) ?? 'Blueprint';
    lines.push(`${this.indent(depth)}if cast(${target}, ${quote(bp)}):`);
    this.printTargets(node.id, depth + 1, stack, lines, DEFAULT_EXEC_HANDLE, stop);
    this.ensureBlockBody(depth + 1, lines);
  }

  private printGate(node: NodeForgeNode, depth: number, stack: Set<string>, lines: string[], condition: string, stop?: BlockStop) {
    lines.push(`${this.indent(depth)}if ${condition}:`);
    this.printTargets(node.id, depth + 1, stack, lines, DEFAULT_EXEC_HANDLE, stop);
    this.ensureBlockBody(depth + 1, lines);
  }

  private printSwitch(node: NodeForgeNode, depth: number, stack: Set<string>, lines: string[]) {
    lines.push(`${this.indent(depth)}match ${this.valueInput(node, 'value', node.data.numberValue ?? '')}:`);
    const cases = node.data.switchCases ?? [];
    cases.forEach((label, index) => {
      lines.push(`${this.indent(depth + 1)}case ${quote(label)}:`);
      this.printTargets(node.id, depth + 2, stack, lines, `case-${index}`);
      this.ensureBlockBody(depth + 2, lines);
    });
    lines.push(`${this.indent(depth + 1)}default:`);
    this.printTargets(node.id, depth + 2, stack, lines);
    this.ensureBlockBody(depth + 2, lines);
  }

  private printSequence(node: NodeForgeNode, depth: number, stack: Set<string>, lines: string[]) {
    lines.push(`${this.indent(depth)}sequence:`);
    for (const handle of ['then-0', 'then-1', 'then-2']) {
      const targets = this.targets(node.id, handle);
      if (!targets.length) continue;
      lines.push(`${this.indent(depth + 1)}${handle.replace('-', ' ')}:`);
      for (const targetId of targets) this.printNode(targetId, depth + 2, stack, lines);
    }
    this.ensureBlockBody(depth + 1, lines);
  }

  private printFlipFlop(node: NodeForgeNode, depth: number, stack: Set<string>, lines: string[]) {
    lines.push(`${this.indent(depth)}flip_flop ${quote(node.data.label ?? node.id)}:`);
    this.printHandleBlock(node.id, 'flip-a', 'a', depth, stack, lines);
    this.printHandleBlock(node.id, 'flip-b', 'b', depth, stack, lines);
    this.ensureBlockBody(depth + 1, lines);
  }

  private printForLoop(node: NodeForgeNode, depth: number, stack: Set<string>, lines: string[], stop?: BlockStop) {
    lines.push(`${this.indent(depth)}for index in range(${this.valueInput(node, 'count', Number(node.data.loopCount ?? 4))}):`);
    this.printTargets(node.id, depth + 1, stack, lines, 'exec-body');
    this.ensureBlockBody(depth + 1, lines);
    this.printTargets(node.id, depth, stack, lines, DEFAULT_EXEC_HANDLE, stop);
  }

  private printForEachActor(node: NodeForgeNode, depth: number, stack: Set<string>, lines: string[], stop?: BlockStop) {
    const source = node.data.castBlueprintId
      ? `blueprint: ${quote(blueprintName(this.blueprints, node.data.castBlueprintId) ?? node.data.castBlueprintId)}`
      : `tag: ${quote(node.data.stringValue ?? '')}`;
    const mode = node.data.findMode ? `, mode: ${quote(node.data.findMode)}` : '';
    lines.push(`${this.indent(depth)}for actor in find_actors(${source}${mode}):`);
    this.printTargets(node.id, depth + 1, stack, lines, 'exec-body');
    this.ensureBlockBody(depth + 1, lines);
    this.printTargets(node.id, depth, stack, lines, DEFAULT_EXEC_HANDLE, stop);
  }

  private printHandleBlock(
    nodeId: string,
    handle: string,
    label: string,
    depth: number,
    stack: Set<string>,
    lines: string[],
  ) {
    const targets = this.targets(nodeId, handle);
    if (!targets.length) return;
    lines.push(`${this.indent(depth + 1)}${label}:`);
    for (const targetId of targets) this.printNode(targetId, depth + 2, stack, lines);
    this.ensureBlockBody(depth + 2, lines);
  }

  private printTargets(nodeId: string, depth: number, stack: Set<string>, lines: string[], handle = DEFAULT_EXEC_HANDLE, stop?: BlockStop) {
    for (const targetId of this.targets(nodeId, handle)) this.printNode(targetId, depth, stack, lines, stop);
  }

  private printStatement(node: NodeForgeNode, depth: number, lines: string[]) {
    const statement = this.statementFor(node);
    if (statement) lines.push(`${this.indent(depth)}${statement}`);
  }

  private statementFor(node: NodeForgeNode): string {
    switch (node.data.nodeKind) {
      case 'action.print':
        return `print(${this.valueInput(node, 'message', node.data.message ?? '')})`;
      case 'action.translate': {
        const vector = this.linkedValueInput(node, 'vector');
        return vector
          ? `self.translate(${vector})`
          : `self.translate(axis: ${quote(node.data.axis ?? 'z')}, amount: ${this.valueInput(node, 'amount', Number(node.data.amount ?? -3.6))})`;
      }
      case 'action.rotate':
        return `self.rotate(axis: ${quote(node.data.axis ?? 'y')}, amount: ${this.valueInput(node, 'amount', Number(node.data.amount ?? 90))})`;
      case 'action.move':
        return `self.move(${this.valueInput(node, 'vector', [0, 0, 1])}, speed: ${this.valueInput(node, 'speed', Number(node.data.amount ?? 4))})`;
      case 'action.jump':
        return 'self.jump()';
      case 'action.moveTo': {
        const args = [this.valueInput(node, 'target', raw('Player.location')), `speed: ${this.valueInput(node, 'speed', Number(node.data.amount ?? 3.4))}`];
        if (node.data.numberValue !== undefined) args.push(`arrival: ${formatNumber(Number(node.data.numberValue))}`);
        return `self.move_to(${args.join(', ')})`;
      }
      case 'action.drive':
        return `self.drive(${this.valueInput(node, 'vector', raw('Input.drive()'))})`;
      case 'action.setPosition':
        return `set_position(${this.targetArgument(node)}, ${this.valueInput(node, 'position', [0, 0, 0])})`;
      case 'action.setRotation':
        return `set_rotation(${this.targetArgument(node)}, ${this.valueInput(node, 'rotation', [0, 0, 0])})`;
      case 'action.setScale':
        return `set_scale(${this.targetArgument(node)}, ${this.valueInput(node, 'scale', [1, 1, 1])})`;
      case 'action.lookAt':
        return `look_at(${this.targetArgument(node)}, ${this.valueInput(node, 'point', raw('Player.location'))})`;
      case 'action.facePlayer':
        return 'self.face_player()';
      case 'action.applyForce':
        return `apply_force(${this.targetArgument(node)}, vector: ${this.valueInput(node, 'vector', raw(this.axisVector(node)))}, amount: ${this.valueInput(node, 'amount', Number(node.data.amount ?? 8))})`;
      case 'action.applyImpulse':
        return `apply_impulse(${this.targetArgument(node)}, vector: ${this.valueInput(node, 'vector', raw(this.axisVector(node)))}, amount: ${this.valueInput(node, 'amount', Number(node.data.amount ?? 8))})`;
      case 'action.applyForceAtPoint':
        return `apply_force_at_point(${this.targetArgument(node)}, vector: ${this.valueInput(node, 'vector', raw(this.axisVector(node)))}, point: ${this.valueInput(node, 'point', node.data.localPoint ?? [0, 0, 0])}, amount: ${this.valueInput(node, 'amount', Number(node.data.amount ?? 8))})`;
      case 'action.applyTorque':
        return `apply_torque(${this.targetArgument(node)}, vector: ${this.valueInput(node, 'vector', raw(this.axisVector(node, 'y')))}, amount: ${this.valueInput(node, 'amount', Number(node.data.amount ?? 4))})`;
      case 'action.setVelocity':
        return `set_velocity(${this.targetArgument(node)}, ${this.valueInput(node, 'vector', [0, 0, 0])})`;
      case 'action.setPhysics':
        return `set_physics(${this.targetArgument(node)}, ${this.compactArgs(node, [
          ['enabled', this.valueInput(node, 'enabled', node.data.physicsEnabled ?? true)],
          ['body', quote(node.data.physicsBodyType ?? 'dynamic')],
          ['collider', quote(node.data.physicsCollider ?? 'box')],
          ['mass', this.valueInput(node, 'mass', Number(node.data.physicsMass ?? 1))],
        ])})`;
      case 'action.setRagdoll':
        return `set_ragdoll(${this.targetArgument(node)}, ${this.valueInput(node, 'on', node.data.booleanValue ?? true)})`;
      case 'action.tweenProperty': {
        const args = [
          this.targetArgument(node),
          `property: ${quote(node.data.tweenProperty ?? 'position')}`,
          `to: ${this.valueInput(node, 'to', node.data.vectorValue ?? [0, 0, 0])}`,
          `duration: ${this.valueInput(node, 'duration', Number(node.data.numberValue ?? 1))}`,
        ];
        const easing = node.data.easing ?? 'easeInOut';
        if (easing !== 'easeInOut') args.push(`easing: ${quote(easing)}`);
        const isTimeline = Boolean(node.data.tweenCurve?.length);
        if (isTimeline) {
          args.push(`id: ${quote(node.data.timelineId || node.id)}`);
          if (node.data.timelineName && node.data.timelineName !== 'Timeline') args.push(`name: ${quote(node.data.timelineName)}`);
          args.push(`curve: ${quote(encodeTimelineCurve(node.data.tweenCurve))}`);
        }
        if ((node.data.tweenSpace ?? 'local') !== 'local') args.push(`space: ${quote(node.data.tweenSpace!)}`);
        if (node.data.tweenValueMode === 'relative') args.push('relative: true');
        if (node.data.tweenLoop) args.push('loop: true');
        if (node.data.tweenPingPong) args.push('ping_pong: true');
        return `${isTimeline ? 'timeline' : 'tween'}(${args.join(', ')})`;
      }
      case 'action.timelineControl':
        return `timeline_control(${quote(node.data.timelineRefId ?? '')}, command: ${quote(node.data.timelineCommand ?? 'play')})`;
      case 'action.fractureObject':
        return `fracture(${this.targetArgument(node)})`;
      case 'action.burstParticles':
        return `burst_particles(${this.targetArgument(node)}, ${this.valueInput(node, 'count', Number(node.data.numberValue ?? 16))})`;
      case 'action.setParticlesEmitting':
        return `set_particles(${this.targetArgument(node)}, ${this.valueInput(node, 'on', node.data.booleanValue ?? true)})`;
      case 'action.spawnParticleSystem': {
        const args = [quote(node.data.particleSystemId ?? 'particles')];
        args.push(`location: ${this.valueInput(node, 'location', raw('self.position'))}`);
        if (node.data.particleAttach) args.push('attach: true');
        return `spawn_particles(${args.join(', ')})`;
      }
      case 'action.playAnimation': {
        const args = [quote(node.data.animationId ?? 'animation')];
        const target = this.targetArgument(node);
        if (target !== 'self') args.push(`target: ${target}`);
        const speed = this.valueInput(node, 'speed', Number(node.data.animationSpeed ?? 1));
        if (speed !== '1') args.push(`speed: ${speed}`);
        return `play_animation(${args.join(', ')})`;
      }
      case 'action.setMovementMode':
        return `set_movement_mode(${this.targetArgument(node)}, ${quote(node.data.movementMode ?? 'walking')})`;
      case 'action.enterVehicle':
        return `enter_vehicle(${this.targetArgument(node)})`;
      case 'action.exitVehicle': {
        const args = [this.targetArgument(node)];
        const offset = this.linkedValueInput(node, 'offset');
        if (offset) args.push(`offset: ${offset}`);
        else if (node.data.vectorValue) args.push(`offset: ${formatVector(node.data.vectorValue)}`);
        return `exit_vehicle(${args.join(', ')})`;
      }
      case 'action.spawnProjectile': {
        const args = [
          `speed: ${this.valueInput(node, 'speed', Number(node.data.projectileSpeed ?? 20))}`,
          `damage: ${this.valueInput(node, 'damage', Number(node.data.projectileDamage ?? 25))}`,
        ];
        return `spawn_projectile(${args.join(', ')})`;
      }
      case 'action.spawnAttached': {
        const args = [quote(node.data.assetId ?? 'asset')];
        if (node.data.attachBoneName) args.push(`bone: ${quote(node.data.attachBoneName)}`);
        if (node.data.attachSocketName) args.push(`socket: ${quote(node.data.attachSocketName)}`);
        const target = this.targetArgument(node);
        if (target !== 'self') args.push(`target: ${target}`);
        return `spawn_attached(${args.join(', ')})`;
      }
      case 'action.cutCable':
        return `cut_cable(${this.targetArgument(node)})`;
      case 'action.setCableLength':
        return `set_cable_length(${this.targetArgument(node)}, ${this.valueInput(node, 'length', Number(node.data.numberValue ?? 2))})`;
      case 'action.setCamera':
        return `Camera.set(distance: ${this.valueInput(node, 'distance', 6)}, height: ${this.valueInput(node, 'height', 2.6)})`;
      case 'action.screenFade': {
        const args = [`${this.valueInput(node, 'to', Number(node.data.fadeTo ?? 1))}`];
        args.push(`duration: ${this.valueInput(node, 'duration', Number(node.data.numberValue ?? 0.5))}`);
        if (node.data.fadeColor) args.push(`color: ${quote(node.data.fadeColor)}`);
        return `Screen.fade(${args.join(', ')})`;
      }
      case 'action.startReplay':
        return `Replay.start(${this.valueInput(node, 'seconds', Number(node.data.numberValue ?? 8))})`;
      case 'action.setTimeOfDay':
        return `Time.of_day = ${this.valueInput(node, 'time', Number(node.data.timeOfDay ?? node.data.numberValue ?? 0.35))}`;
      case 'variable.set':
        return `${this.variableTarget(node)} = ${this.valueInput(node, 'value', this.literalForType(node.data.valueType as GraphValueType | undefined, node))}`;
      case 'variable.setObject': {
        const key = node.data.objectKey || 'value';
        const wiredTarget = this.linkedValueInput(node, 'target');
        const value = this.valueInput(node, 'value', this.literalForType(node.data.valueType as GraphValueType | undefined, node));
        if (!wiredTarget && (!node.data.targetObjectId || node.data.targetObjectId === '$self') && IDENTIFIER.test(key) && !AMBIGUOUS_SELF_KEYS.has(key)) {
          return `self.${key} = ${value}`;
        }
        return `set_var(${wiredTarget ?? this.targetLiteral(node.data.targetObjectId)}, ${quote(key)}, ${value})`;
      }
      case 'ui.show':
        return `UI.show(${quote(node.data.documentId ?? 'document')})`;
      case 'ui.hide':
        return `UI.hide(${quote(node.data.documentId ?? 'document')})`;
      case 'ui.toggle':
        return `UI.toggle(${quote(node.data.documentId ?? 'document')})`;
      case 'ui.setText':
        return `UI.set_text(${quote(node.data.documentId ?? 'document')}, ${quote(node.data.elementId ?? 'element')}, ${this.valueInput(node, 'text', node.data.stringValue ?? '')})`;
      case 'ui.setVisible':
        return `UI.set_visible(${quote(node.data.documentId ?? 'document')}, ${quote(node.data.elementId ?? 'element')}, ${this.valueInput(node, 'visible', node.data.visible ?? true)})`;
      case 'save.write':
        return `Save.write(${quote(node.data.saveSlot ?? 'slot1')})`;
      case 'save.load':
        return `Save.load(${quote(node.data.saveSlot ?? 'slot1')})`;
      case 'save.clear':
        return `Save.clear(${quote(node.data.saveSlot ?? 'slot1')})`;
      case 'action.fireEvent': {
        const args = [`${quote(node.data.eventName ?? 'CustomEvent')}`];
        const target = this.linkedValueInput(node, 'target') ?? this.targetLiteral(node.data.targetObjectId);
        const payload = this.linkedValueInput(node, 'payload');
        if (target !== 'self') args.push(`target: ${target}`);
        if (payload) args.push(`payload: ${payload}`);
        return `fire_event(${args.join(', ')})`;
      }
      case 'action.playSound':
        return `Audio.play(${quote(node.data.assetId ?? 'sound')})`;
      case 'action.playCinematic':
        return `Cinematic.play(${quote(node.data.cinematicId ?? 'cinematic')})`;
      case 'action.loadScene':
        return `Scene.load(${quote(node.data.targetSceneId ?? 'scene')})`;
      case 'action.destroyObject':
        return `destroy(${this.targetLiteral(node.data.targetObjectId)})`;
      case 'action.spawnObject':
        return `spawn_object(${quote(node.data.spawnKind ?? 'cube')})`;
      case 'action.spawnPrefab':
        return `spawn_prefab(${quote(node.data.prefabId ?? 'prefab')}, location: ${this.valueInput(node, 'location', raw('self.position'))})`;
      case 'action.applyDamage':
        return `apply_damage(${this.targetArgument(node)}, ${this.valueInput(node, 'amount', Number(node.data.damageAmount ?? 10))})`;
      case 'action.explode':
        return `explode(location: ${this.valueInput(node, 'location', raw('self.position'))}, radius: ${this.valueInput(node, 'radius', Number(node.data.explodeRadius ?? 5))}, damage: ${this.valueInput(node, 'damage', Number(node.data.explodeDamage ?? 50))})`;
      case 'action.cameraShake':
        return `Camera.shake(${this.valueInput(node, 'amount', Number(node.data.shakeAmount ?? 0.6))})`;
      case 'action.screenFlash':
        return `Screen.flash(${this.valueInput(node, 'amount', Number(node.data.flashAmount ?? 0.7))}, color: ${quote(node.data.flashColor ?? '#ffffff')})`;
      case 'action.spawnDecal': {
        const decalArgs = [`location: ${this.valueInput(node, 'location', raw('self.position'))}`];
        const decalNormal = this.linkedValueInput(node, 'normal');
        if (decalNormal) decalArgs.push(`normal: ${decalNormal}`);
        decalArgs.push(`kind: ${quote(node.data.decalKind ?? 'bullet')}`);
        decalArgs.push(`size: ${this.valueInput(node, 'size', Number(node.data.decalSize ?? 0.4))}`);
        return `spawn_decal(${decalArgs.join(', ')})`;
      }
      case 'action.setVisible':
        return `set_visible(${this.targetArgument(node)}, ${this.valueInput(node, 'visible', node.data.visible ?? true)})`;
      case 'action.setJointMotor': {
        const args = [this.targetArgument(node)];
        const servo = this.linkedValueInput(node, 'position');
        if (servo) args.push(`position: ${servo}`);
        const velocity = this.valueInput(node, 'velocity', node.data.numberValue);
        if (!servo || velocity !== 'none') args.push(`velocity: ${velocity === 'none' ? 0 : velocity}`);
        return `set_joint_motor(${args.join(', ')})`;
      }
      case 'action.setActive':
        return `set_active(${this.targetArgument(node)}, ${this.valueInput(node, 'on', node.data.booleanValue ?? true)})`;
      case 'action.setTimeScale':
        return `Time.scale = ${this.valueInput(node, 'scale', Number(node.data.numberValue ?? 1))}`;
      case 'action.setQuality':
        return `Quality.set(${quote(node.data.qualityLevel ?? 'High')})`;
      case 'animator.setFloat':
        return `Animator.set_float(${quote(node.data.paramName ?? 'param')}, ${this.valueInput(node, 'value', Number(node.data.numberValue ?? 0))})`;
      case 'animator.setBool':
        return `Animator.set_bool(${quote(node.data.paramName ?? 'param')}, ${this.valueInput(node, 'value', node.data.booleanValue ?? false)})`;
      case 'animator.setTrigger':
        return `Animator.trigger(${quote(node.data.paramName ?? 'param')})`;
      case 'action.setMaterialColor':
        return `Material.set_color(${quote(node.data.materialColorTarget ?? 'base')}, ${this.valueInput(node, 'color', node.data.materialColor ?? '#ffffff')})`;
      case 'action.setMaterialProperty':
        return `Material.set(${quote(node.data.materialProperty ?? 'metalness')}, ${this.valueInput(node, 'value', Number(node.data.numberValue ?? 0))})`;
      case 'action.setEnvironment':
        return `Environment.set(${formatDataObject(node.data.envPatch ?? {})})`;
      default:
        return this.genericNodeCall(node);
    }
  }

  private expressionFor(nodeId: string, sourceHandle = 'value-out', stack = new Set<string>()): string {
    if (stack.has(nodeId)) return `cycle(${quote(nodeId)})`;
    const compiled = this.runtime.compiledNodesById.get(nodeId);
    if (!compiled) return 'none';
    const node = compiled.node;
    stack.add(nodeId);
    this.emitted.add(nodeId);

    const binary = (op: string, aFallback: GraphValue | string = 0, bFallback: GraphValue | string = 0) =>
      `(${this.valueInput(node, 'a', aFallback, stack)} ${op} ${this.valueInput(node, 'b', bFallback, stack)})`;

    const call = (name: string, args: Array<string | undefined>) => `${name}(${args.filter(Boolean).join(', ')})`;

    let result: string;
    switch (node.data.nodeKind) {
      case 'value.number':
        result = formatNumber(Number(node.data.numberValue ?? 0));
        break;
      case 'value.string':
        result = quote(node.data.stringValue ?? '');
        break;
      case 'value.boolean':
        result = node.data.booleanValue ? 'true' : 'false';
        break;
      case 'value.vector3':
        result = formatVector(node.data.vectorValue ?? [0, 0, 0]);
        break;
      case 'value.random':
        result = `${node.data.randomInteger ? 'random_int' : 'random'}(${this.valueInput(node, 'min', Number(node.data.randomMin ?? 0), stack)}, ${this.valueInput(node, 'max', Number(node.data.randomMax ?? 1), stack)})`;
        break;
      case 'variable.get':
        result = this.variableTarget(node);
        break;
      case 'variable.getObject': {
        const key = node.data.objectKey || 'value';
        const wiredTarget = this.linkedValueInput(node, 'target', stack);
        result =
          !wiredTarget && (!node.data.targetObjectId || node.data.targetObjectId === '$self') && IDENTIFIER.test(key) && !AMBIGUOUS_SELF_KEYS.has(key)
            ? `self.${key}`
            : `get_var(${wiredTarget ?? this.targetLiteral(node.data.targetObjectId)}, ${quote(key)})`;
        break;
      }
      case 'data.tableGet':
        result = `Data.get(${quote(node.data.tableId ?? 'table')}, ${this.valueInput(node, 'rowKey', node.data.rowKey ?? '', stack)}, ${quote(node.data.columnId ?? 'column')})`;
        break;
      case 'logic.compare':
        result = binary(node.data.compareOp ?? '==', 0, Number(node.data.numberValue ?? 0));
        break;
      case 'logic.and':
        result = binary('and', false, false);
        break;
      case 'logic.or':
        result = binary('or', false, false);
        break;
      case 'logic.not':
        result = `(not ${this.valueInput(node, 'value', false, stack)})`;
        break;
      case 'logic.select':
        result = `(${this.valueInput(node, 'a', undefined, stack)} if ${this.valueInput(node, 'condition', false, stack)} else ${this.valueInput(node, 'b', undefined, stack)})`;
        break;
      case 'logic.forLoop':
        result = 'index';
        break;
      case 'logic.forEachActor':
        result = 'actor';
        break;
      case 'logic.callFunction':
        result = this.callFunctionExpression(node, stack);
        break;
      case 'event.functionEntry':
        result = sourceHandle === 'arg-b' ? 'b' : sourceHandle === 'arg-c' ? 'c' : 'a';
        break;
      case 'event.custom':
        result = 'payload';
        break;
      case 'event.receiveDamage':
        result = 'amount';
        break;
      case 'event.land':
        result = 'speed';
        break;
      case 'logic.cast':
        result = `cast(${this.valueInput(node, 'object', raw(this.targetLiteral(node.data.targetObjectId)), stack)}, ${quote(blueprintName(this.blueprints, node.data.castBlueprintId) ?? 'Blueprint')})`;
        break;
      case 'math.add':
        result = binary('+', Number(node.data.numberValue ?? 0), Number(node.data.amount ?? 0));
        break;
      case 'math.subtract':
        result = binary('-');
        break;
      case 'math.multiply':
        result = binary('*');
        break;
      case 'math.divide':
        result = binary('/');
        break;
      case 'math.modulo':
        result = binary('%');
        break;
      case 'math.min':
        result = call('min', [this.valueInput(node, 'a', 0, stack), this.valueInput(node, 'b', 0, stack)]);
        break;
      case 'math.max':
        result = call('max', [this.valueInput(node, 'a', 0, stack), this.valueInput(node, 'b', 0, stack)]);
        break;
      case 'math.clamp':
        result = call('clamp', [
          this.valueInput(node, 'value', Number(node.data.numberValue ?? 0), stack),
          this.valueInput(node, 'min', 0, stack),
          this.valueInput(node, 'max', Number(node.data.amount ?? 1), stack),
        ]);
        break;
      case 'math.lerp':
        result = call('lerp', [
          this.valueInput(node, 'a', 0, stack),
          this.valueInput(node, 'b', Number(node.data.amount ?? 1), stack),
          this.valueInput(node, 't', Number(node.data.numberValue ?? 0.5), stack),
        ]);
        break;
      case 'math.distance':
        result = call('distance', [this.valueInput(node, 'a', [0, 0, 0], stack), this.valueInput(node, 'b', [0, 0, 0], stack)]);
        break;
      case 'math.vectorAdd':
        result = call('vec_add', [this.valueInput(node, 'a', [0, 0, 0], stack), this.valueInput(node, 'b', [0, 0, 0], stack)]);
        break;
      case 'math.vectorSubtract':
        result = call('vec_sub', [this.valueInput(node, 'a', [0, 0, 0], stack), this.valueInput(node, 'b', [0, 0, 0], stack)]);
        break;
      case 'math.vectorScale':
        result = call('vec_scale', [this.valueInput(node, 'vector', [0, 0, 0], stack), this.valueInput(node, 'scale', 1, stack)]);
        break;
      case 'math.makeVector':
        result = `vec3(${this.valueInput(node, 'x', 0, stack)}, ${this.valueInput(node, 'y', 0, stack)}, ${this.valueInput(node, 'z', 0, stack)})`;
        break;
      case 'math.normalize':
        result = call('normalize', [this.valueInput(node, 'value', [0, 0, 0], stack)]);
        break;
      case 'math.vectorLength':
        result = call('length', [this.valueInput(node, 'vector', [0, 0, 0], stack)]);
        break;
      case 'math.dot':
        result = call('dot', [this.valueInput(node, 'a', [0, 0, 0], stack), this.valueInput(node, 'b', [0, 0, 0], stack)]);
        break;
      case 'math.mapRange':
        result = call('map_range', [
          this.valueInput(node, 'value', Number(node.data.numberValue ?? 0), stack),
          this.valueInput(node, 'inMin', 0, stack),
          this.valueInput(node, 'inMax', 1, stack),
          this.valueInput(node, 'outMin', 0, stack),
          this.valueInput(node, 'outMax', 1, stack),
        ]);
        break;
      case 'math.abs':
      case 'math.round':
      case 'math.floor':
      case 'math.sin':
      case 'math.cos':
        result = call(node.data.nodeKind.split('.')[1], [this.valueInput(node, 'value', 0, stack)]);
        break;
      case 'math.power':
        result = call('pow', [this.valueInput(node, 'a', 0, stack), this.valueInput(node, 'b', 2, stack)]);
        break;
      case 'string.append':
        result = call('append', [this.valueInput(node, 'a', node.data.stringValue ?? '', stack), this.valueInput(node, 'b', '', stack)]);
        break;
      case 'input.move':
        result = 'Input.move()';
        break;
      case 'input.driveInput':
        result = 'Input.drive()';
        break;
      case 'query.vehicleSpeed':
        result = 'self.vehicle_speed()';
        break;
      case 'query.grounded':
        result = 'self.is_grounded()';
        break;
      case 'query.findActorByBlueprint':
        result = `find_actor(blueprint: ${quote(blueprintName(this.blueprints, node.data.castBlueprintId) ?? node.data.castBlueprintId ?? 'Blueprint')}${
          node.data.findMode ? `, mode: ${quote(node.data.findMode)}` : ''
        })`;
        break;
      case 'query.findActorByTag':
        result = `find_actor(tag: ${quote(node.data.stringValue ?? '')}${node.data.findMode ? `, mode: ${quote(node.data.findMode)}` : ''})`;
        break;
      case 'query.raycast': {
        const suffix = sourceHandle === 'actor' || sourceHandle === 'point' || sourceHandle === 'distance' ? sourceHandle : 'hit';
        result = `raycast(direction: ${this.valueInput(node, 'direction', raw('self.forward'), stack)}, distance: ${this.valueInput(node, 'distance', Number(node.data.numberValue ?? 20), stack)}).${suffix}`;
        break;
      }
      case 'query.overlapSphere': {
        const suffix = sourceHandle === 'actor' || sourceHandle === 'count' ? sourceHandle : 'hit';
        result = `overlap_sphere(location: ${this.valueInput(node, 'location', raw('self.position'), stack)}, radius: ${this.valueInput(node, 'radius', Number(node.data.numberValue ?? 5), stack)}).${suffix}`;
        break;
      }
      case 'query.sphereCast': {
        const suffix = sourceHandle === 'actor' || sourceHandle === 'point' || sourceHandle === 'distance' || sourceHandle === 'normal' ? sourceHandle : 'hit';
        result = `sphere_cast(direction: ${this.valueInput(node, 'direction', raw('self.forward'), stack)}, distance: ${this.valueInput(node, 'distance', Number(node.data.numberValue ?? 20), stack)}, radius: ${this.valueInput(node, 'radius', Number(node.data.amount ?? 0.5), stack)}).${suffix}`;
        break;
      }
      case 'event.collisionEnter':
        result = sourceHandle === 'normal' ? 'contact_normal()' : sourceHandle === 'point' ? 'contact_point()' : sourceHandle === 'speed' ? 'impact_speed()' : 'other';
        break;
      case 'query.velocity':
        result = `velocity(${this.targetArgument(node, stack)})`;
        break;
      case 'query.getSpeed':
        result = `speed(${this.targetArgument(node, stack)})`;
        break;
      case 'query.cableTension':
        result = `cable_tension(${this.targetLiteral(node.data.targetObjectId)})`;
        break;
      case 'action.getPosition':
        result = `position(${this.targetArgument(node, stack)})`;
        break;
      case 'action.getRotation':
        result = `rotation(${this.targetArgument(node, stack)})`;
        break;
      case 'action.getScale':
        result = `scale(${this.targetArgument(node, stack)})`;
        break;
      case 'action.getMaterialColor':
        result = 'Material.color()';
        break;
      case 'action.getMaterialProperty':
        result = `Material.get(${quote(node.data.materialProperty ?? 'metalness')})`;
        break;
      case 'ai.distanceToPlayer':
        result = 'AI.distance_to_player()';
        break;
      case 'ai.directionToPlayer':
        result = 'AI.direction_to_player()';
        break;
      case 'ai.playerLocation':
        result = 'Player.location';
        break;
      case 'query.getTimeOfDay':
        result = 'Time.of_day';
        break;
      case 'ai.hasLineOfSight':
        result = 'AI.has_line_of_sight()';
        break;
      case 'save.has':
        result = `Save.has(${quote(node.data.saveSlot ?? 'slot1')})`;
        break;
      case 'animator.getParam':
        result = `Animator.get(${quote(node.data.paramName ?? 'param')})`;
        break;
      case 'animator.getState':
        result = 'Animator.state()';
        break;
      case 'action.spawnPrefab':
        result = `last_spawned(${quote(node.id)})`;
        break;
      default:
        result = `node_value(${quote(node.data.nodeKind)}, ${quote(node.id)})`;
        break;
    }

    stack.delete(nodeId);
    return result;
  }

  private valueInput(node: NodeForgeNode, handle: string, fallback?: GraphValue | RawExpression, stack = new Set<string>()): string {
    const linked = this.linkedValueInput(node, handle, stack);
    if (linked) return linked;
    return isRawExpression(fallback) ? fallback.raw : formatLiteral(fallback);
  }

  private linkedValueInput(node: NodeForgeNode, handle: string, stack = new Set<string>()): string | undefined {
    const link = this.runtime.compiledNodesById.get(node.id)?.valueInputs.get(handle);
    if (!link) return undefined;
    return this.expressionFor(link.source, link.sourceHandle, stack);
  }

  private targets(nodeId: string, handle = DEFAULT_EXEC_HANDLE): string[] {
    const compiled = this.runtime.compiledNodesById.get(nodeId);
    if (!compiled) return [];
    if (handle === DEFAULT_EXEC_HANDLE) return compiled.outgoing;
    return compiled.outgoingByHandle.get(handle) ?? [];
  }

  private ensureBlockBody(depth: number, lines: string[]) {
    const prefix = this.indent(depth);
    const previous = lines[lines.length - 1] ?? '';
    if (!previous.startsWith(prefix) || previous.trim().endsWith(':')) lines.push(`${prefix}pass`);
  }

  private printComment(node: NodeForgeNode, depth: number, lines: string[]) {
    const text = String(node.data.message ?? node.data.label ?? 'Comment').trim();
    if (!text) return;
    for (const line of text.split(/\r?\n/)) lines.push(`${this.indent(depth)}# ${line}`);
  }

  private genericNodeCall(node: NodeForgeNode): string {
    const data = Object.entries(node.data)
      .filter(([key, value]) => !SYSTEM_DATA_KEYS.has(key) && value !== undefined)
      .reduce<Record<string, unknown>>((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
    const inputs = [...(this.runtime.compiledNodesById.get(node.id)?.valueInputs.keys() ?? [])].reduce<Record<string, string>>(
      (acc, handle) => {
        acc[handle] = this.valueInput(node, handle);
        return acc;
      },
      {},
    );
    const payload = {
      id: node.id,
      label: node.data.label,
      ...(Object.keys(data).length ? { data } : {}),
      ...(Object.keys(inputs).length ? { inputs } : {}),
    };
    return `node(${quote(node.data.nodeKind)}, ${formatDataObject(payload)})`;
  }

  private variableTarget(node: NodeForgeNode): string {
    if (node.data.variableId) {
      const variable = this.variableById.get(node.data.variableId);
      return propertyAccess('Game', variable?.name ?? node.data.variableId, 'value');
    }
    return propertyAccess('self', node.data.objectKey, 'value');
  }

  private literalForType(type: GraphValueType | undefined, node: NodeForgeNode): GraphValue {
    if (type === 'string') return node.data.stringValue ?? '';
    if (type === 'boolean') return Boolean(node.data.booleanValue);
    if (type === 'vector3') return node.data.vectorValue ?? [0, 0, 0];
    return Number(node.data.numberValue ?? 0);
  }

  private callFunctionExpression(node: NodeForgeNode, stack = new Set<string>()): string {
    const args = [
      this.linkedValueInput(node, 'a', stack),
      this.linkedValueInput(node, 'b', stack),
      this.linkedValueInput(node, 'c', stack),
    ].filter(Boolean);
    return `${sanitizeIdentifier(node.data.functionName || 'MyFunction', 'MyFunction')}(${args.join(', ')})`;
  }

  private compactArgs(_node: NodeForgeNode, args: Array<[string, string]>): string {
    return `{ ${args.map(([key, value]) => `${key}: ${value}`).join(', ')} }`;
  }

  private targetArgument(node: NodeForgeNode, stack = new Set<string>()): string {
    return this.linkedValueInput(node, 'target', stack) ?? this.targetLiteral(node.data.targetObjectId);
  }

  private targetLiteral(raw: string | undefined): string {
    if (!raw || raw === '$self') return 'self';
    if (raw === '$player') return 'Player';
    if (raw === '$trigger') return 'other';
    if (raw === '$cast') return 'cast_actor';
    return quote(raw);
  }

  private axisVector(node: NodeForgeNode, fallbackAxis: 'x' | 'y' | 'z' = 'z'): string {
    const axis = node.data.axis ?? fallbackAxis;
    const amount = Number(node.data.amount ?? 1);
    const tuple: Vector3Tuple = [0, 0, 0];
    tuple[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] = amount;
    return formatVector(tuple);
  }

  private nodeName(nodeId: string): string {
    const node = this.runtime.compiledNodesById.get(nodeId)?.node;
    return node?.data.label ?? nodeId;
  }

  private indent(depth: number): string {
    return '    '.repeat(depth);
  }
}

export const graphToFeatherScript = (options: FeatherScriptPrintOptions): string =>
  new FeatherScriptPrinter(options).print();
