import type { Edge } from '@xyflow/react';
import { categoryByKind, makeNodeData } from '../store/editor/graph';
import { layoutGraphNodes } from '../store/editor/graphRuntime';
import { makeId } from '../store/editor/ids';
import type {
  BlueprintVariable,
  GraphNodeKind,
  GraphValue,
  GraphValueType,
  NodeForgeNode,
  NodeForgeNodeData,
  ProjectGraph,
  ProjectVariable,
  ScriptBlueprint,
  Vector3Tuple,
} from '../types';
import {
  parseFeatherScript,
  type FeatherDiagnostic,
  type FeatherExpression,
  type FeatherFunctionDeclaration,
  type FeatherStatement,
  type FeatherVariableDeclaration,
  type FeatherEventHandler,
} from './featherParser';
import { isBlockingFeatherWarning, suggestIdentifier } from './featherDiagnostics';
import { decodeTimelineCurve, timelineCurvePreset } from '../runtime/timelineCurve';

export interface FeatherCompileResult {
  ok: boolean;
  diagnostics: FeatherDiagnostic[];
  graph?: ProjectGraph;
  blueprint?: ScriptBlueprint;
}

interface FeatherCompileOptions {
  source: string;
  blueprint: ScriptBlueprint;
  graph: ProjectGraph;
  variables: ProjectVariable[];
  /** All project blueprints — used to resolve blueprint NAMES in cast()/find_actor()/find_actors(). */
  blueprints?: ScriptBlueprint[];
  preserveSource?: boolean;
}

/** An execution continuation point: a node plus the exec pin the next statement chains from. */
interface ExecSource {
  nodeId: string;
  handle: string;
}

interface CompiledChain {
  first?: string;
  exits: ExecSource[];
}

const out = (node: NodeForgeNode, handle = 'exec-out'): ExecSource => ({ nodeId: node.id, handle });

interface ParsedCall {
  callee: string;
  positional: string[];
  named: Map<string, string>;
}

const VALID_TYPES = new Set<GraphValueType>(['number', 'string', 'boolean', 'vector3']);
const COMPARATORS = ['==', '!=', '>=', '<=', '>', '<'] as const;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A value source: a node plus the output pin to read from (event roots expose args on named pins). */
interface ValueRef {
  nodeId: string;
  sourceHandle: string;
}

/** Bare-identifier callees the language/printer owns — never treated as user Call Function targets. */
const RESERVED_CALLEES = new Set([
  'print', 'wait', 'destroy', 'fire_event', 'apply_damage', 'apply_force', 'apply_impulse', 'apply_torque',
  'set_var', 'get_var', 'set_position', 'set_rotation', 'set_scale', 'look_at', 'set_velocity', 'set_physics',
  'set_visible', 'set_active', 'set_joint_motor', 'set_ragdoll', 'tween', 'timeline', 'timeline_control', 'fracture',
  'burst_particles', 'set_particles', 'spawn_particles', 'play_animation', 'set_movement_mode',
  'enter_vehicle', 'exit_vehicle', 'spawn_projectile', 'spawn_attached', 'cut_cable', 'set_cable_length',
  'spawn_object', 'spawn_prefab', 'explode', 'spawn_decal', 'cooldown', 'do_once', 'cast',
  'find_actor', 'find_actors', 'raycast', 'overlap_sphere', 'sphere_cast', 'contact_normal', 'contact_point', 'impact_speed', 'velocity', 'cable_tension', 'position', 'rotation',
  'scale', 'node_value', 'last_spawned', 'cycle', 'vec3', 'min', 'max', 'clamp', 'lerp', 'distance', 'normalize',
  'length', 'dot', 'map_range', 'abs', 'round', 'floor', 'sin', 'cos', 'pow', 'random', 'random_int', 'range',
  'append', 'vec_add', 'vec_sub', 'vec_scale',
  'if', 'else', 'elif', 'for', 'while', 'match', 'return', 'pass', 'on', 'function', 'var', 'blueprint',
  'detached', 'none', 'true', 'false', 'self', 'other', 'payload', 'node',
]);

const sanitizeIdentifier = (value: string | undefined, fallback: string): string => {
  const cleaned = (value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const candidate = cleaned || fallback;
  return /^[A-Za-z_]/.test(candidate) ? candidate : `_${candidate}`;
};

const unquote = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!/^(['"]).*\1$/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed.replace(/^'|'$/g, '"'));
  } catch {
    return trimmed.slice(1, -1);
  }
};

const splitTopLevel = (value: string, delimiter = ','): string[] => {
  const parts: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === delimiter && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
};

/** Strip outer parentheses ONLY when they wrap the whole expression — "(a) + (b)" is untouched. */
const stripOuterParens = (value: string): string => {
  let result = value.trim();
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0;
    let quote: '"' | "'" | null = null;
    let escaped = false;
    let wraps = true;
    for (let i = 0; i < result.length - 1; i += 1) {
      const ch = result[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '(') depth += 1;
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          wraps = false;
          break;
        }
      }
    }
    if (!wraps) break;
    result = result.slice(1, -1).trim();
  }
  return result;
};

/** Scan quote/bracket-aware and report each top-level position where `matches` accepts a token. */
const scanTopLevel = (value: string, matches: (index: number) => number): number[] => {
  const hits: number[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0) {
      const length = matches(i);
      if (length > 0) {
        hits.push(i);
        i += length - 1;
      }
    }
  }
  return hits;
};

/** Last top-level word operator (" and " / " or " / " if " / " else ") — split point for left associativity. */
const findLastWordOp = (value: string, word: string): number => {
  const token = ` ${word} `;
  const hits = scanTopLevel(value, (i) => (value.slice(i, i + token.length) === token ? token.length : 0));
  return hits.length ? hits[hits.length - 1] : -1;
};

const OPERATOR_CHARS = new Set(['+', '-', '*', '/', '%', '<', '>', '=', '!', '(', ',', ':']);

/** Last top-level BINARY + or - (skips unary minus and exponent notation like 3e-5). */
const findLastAdditive = (value: string): number => {
  const hits = scanTopLevel(value, (i) => {
    const ch = value[i];
    if (ch !== '+' && ch !== '-') return 0;
    const before = value.slice(0, i).trimEnd();
    if (!before || OPERATOR_CHARS.has(before[before.length - 1])) return 0;
    if (/[0-9]e$/i.test(before)) return 0;
    return 1;
  });
  return hits.length ? hits[hits.length - 1] : -1;
};

/** Last top-level * / or % with a non-empty left side. */
const findLastMultiplicative = (value: string): number => {
  const hits = scanTopLevel(value, (i) => {
    const ch = value[i];
    if (ch !== '*' && ch !== '/' && ch !== '%') return 0;
    const before = value.slice(0, i).trimEnd();
    if (!before || OPERATOR_CHARS.has(before[before.length - 1])) return 0;
    return 1;
  });
  return hits.length ? hits[hits.length - 1] : -1;
};

const findTopLevelToken = (value: string, token: string): number => {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i <= value.length - token.length; i += 1) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && value.slice(i, i + token.length) === token) return i;
  }
  return -1;
};

const parseCall = (raw: string): ParsedCall | undefined => {
  const trimmed = raw.trim();
  const open = trimmed.indexOf('(');
  if (open <= 0 || !trimmed.endsWith(')')) return undefined;
  const callee = trimmed.slice(0, open).trim();
  const args = splitTopLevel(trimmed.slice(open + 1, -1));
  const named = new Map<string, string>();
  const positional: string[] = [];
  for (const arg of args) {
    const colon = findTopLevelToken(arg, ':');
    if (colon > 0) named.set(arg.slice(0, colon).trim(), arg.slice(colon + 1).trim());
    else positional.push(arg);
  }
  return { callee, positional, named };
};

const parseType = (typeName: string | undefined, fallback: GraphValueType): GraphValueType =>
  VALID_TYPES.has(typeName as GraphValueType) ? (typeName as GraphValueType) : fallback;

const inferLiteralType = (raw: string): GraphValueType => {
  const literal = parseLiteral(raw);
  if (Array.isArray(literal)) return 'vector3';
  if (typeof literal === 'boolean') return 'boolean';
  if (typeof literal === 'string') return 'string';
  return 'number';
};

const parseLiteral = (raw: string | undefined): GraphValue | undefined => {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const quoted = unquote(trimmed);
  if (quoted !== undefined) return quoted;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const number = Number(trimmed);
  if (Number.isFinite(number)) return number;
  const vector = trimmed.match(/^vec3\((.*)\)$/);
  if (vector) {
    const [x = '0', y = '0', z = '0'] = splitTopLevel(vector[1]);
    return [Number(x) || 0, Number(y) || 0, Number(z) || 0] as Vector3Tuple;
  }
  return undefined;
};

/** Parse `{ enabled: true, body: "dynamic" }` into a key → raw-expression map. */
const parseObjectLiteral = (raw: string | undefined): Map<string, string> => {
  const map = new Map<string, string>();
  if (!raw) return map;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return map;
  for (const part of splitTopLevel(trimmed.slice(1, -1))) {
    let quote: '"' | "'" | null = null;
    let escaped = false;
    let depth = 0;
    let colon = -1;
    for (let i = 0; i < part.length; i += 1) {
      const ch = part[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
      if (ch === ':' && depth === 0) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    const key = part.slice(0, colon).trim();
    if (IDENTIFIER.test(key)) map.set(key, part.slice(colon + 1).trim());
  }
  return map;
};

const PHYSICS_BODIES = new Set(['dynamic', 'fixed', 'kinematic']);
const PHYSICS_COLLIDERS = new Set(['box', 'sphere', 'capsule', 'mesh', 'convex']);
const TWEEN_PROPERTIES = new Set(['position', 'rotation', 'scale']);
const TWEEN_EASINGS = new Set(['linear', 'easeIn', 'easeOut', 'easeInOut']);
const TIMELINE_COMMANDS = new Set(['play', 'restart', 'reverse', 'stop']);
const MOVEMENT_MODES = new Set(['walking', 'swimming', 'climbing', 'flying']);

const dataForLiteral = (value: GraphValue | undefined, fallbackType: GraphValueType): Partial<NodeForgeNodeData> => {
  const type = value === undefined ? fallbackType : Array.isArray(value) ? 'vector3' : typeof value === 'boolean' ? 'boolean' : typeof value === 'string' ? 'string' : 'number';
  if (type === 'string') return { valueType: 'string', stringValue: String(value ?? '') };
  if (type === 'boolean') return { valueType: 'boolean', booleanValue: Boolean(value) };
  if (type === 'vector3') return { valueType: 'vector3', vectorValue: (Array.isArray(value) ? value : [0, 0, 0]) as Vector3Tuple };
  return { valueType: 'number', numberValue: Number(value ?? 0) };
};

const literalNodeLabel = (value: GraphValue): string => {
  if (Array.isArray(value)) return 'Vector3';
  if (typeof value === 'boolean') return 'Boolean';
  if (typeof value === 'string') return 'String';
  return 'Number';
};

class FeatherGraphBuilder {
  private readonly nodes: NodeForgeNode[] = [];
  private readonly edges: Edge[] = [];
  private readonly diagnostics: FeatherDiagnostic[] = [];
  private readonly projectVariableByName: Map<string, ProjectVariable>;
  private readonly blueprints: ScriptBlueprint[];
  /** The event/function root being compiled — binds its arg identifiers (payload/amount/a/b/c). */
  private currentRoot?: NodeForgeNode;
  /** Innermost-first loop variable bindings ("index"/"actor" → the loop node's value-out). */
  private readonly loopBindings: Array<{ name: string; ref: ValueRef }> = [];
  private readonly knownFunctions = new Set<string>();
  private cursorY = 60;

  constructor(
    private readonly blueprint: ScriptBlueprint,
    variables: ProjectVariable[],
    blueprints?: ScriptBlueprint[],
    functionNames: Iterable<string> = [],
  ) {
    this.projectVariableByName = new Map(variables.map((variable) => [sanitizeIdentifier(variable.name, variable.id), variable]));
    this.blueprints = blueprints ?? [];
    for (const name of functionNames) this.knownFunctions.add(sanitizeIdentifier(name, name).toLowerCase());
  }

  /** Resolve a blueprint display name (as the printer quotes it) back to its id. */
  private blueprintIdByName(name: string | undefined): string | undefined {
    if (!name) return undefined;
    const wanted = name.trim();
    const found = this.blueprints.find(
      (item) => item.name === wanted || item.name === wanted.replace(/_/g, ' ') || item.id === wanted,
    );
    return found?.id;
  }

  graph(name: string, id: string): ProjectGraph {
    return {
      id,
      name,
      nodes: layoutGraphNodes(this.nodes, this.edges),
      edges: this.edges,
    };
  }

  warning(loc: FeatherExpression['loc'] | FeatherStatement, message: string) {
    this.diagnostics.push({
      severity: 'warning',
      message,
      line: loc.line,
      column: loc.column,
      length: loc.length,
    });
  }

  compileHandler(handler: FeatherEventHandler) {
    const root = this.createEventNode(handler);
    this.currentRoot = root;
    const chain = this.compileStatements(handler.body);
    if (chain.first) this.exec(root.id, chain.first);
    this.currentRoot = undefined;
  }

  compileFunction(fn: FeatherFunctionDeclaration) {
    const root = this.addNode('event.functionEntry', { functionName: sanitizeIdentifier(fn.name, 'MyFunction') }, 0);
    this.currentRoot = root;
    const chain = this.compileStatements(fn.body);
    if (chain.first) this.exec(root.id, chain.first);
    this.currentRoot = undefined;
  }

  compileDetached(statements: FeatherStatement[]) {
    this.currentRoot = undefined;
    this.compileStatements(statements);
  }

  diagnosticsList(): FeatherDiagnostic[] {
    return this.diagnostics;
  }

  private compileStatements(statements: FeatherStatement[]): CompiledChain {
    let first: string | undefined;
    let exits: ExecSource[] = [];

    for (const statement of statements) {
      const compiled = this.compileStatement(statement);
      if (!compiled.first) continue;
      if (!first) first = compiled.first;
      for (const exit of exits) this.exec(exit.nodeId, compiled.first, exit.handle);
      exits = compiled.exits;
    }

    return { first, exits };
  }

  private compileStatement(statement: FeatherStatement): CompiledChain {
    switch (statement.kind) {
      case 'PassStatement':
        return { exits: [] };
      case 'ExpressionStatement':
        return this.compileExpressionStatement(statement.expression);
      case 'AssignmentStatement':
        return this.compileAssignment(statement);
      case 'ReturnStatement':
        return this.compileReturn(statement);
      case 'IfStatement':
        return this.compileIf(statement);
      case 'ForStatement':
        return this.compileFor(statement);
      case 'WhileStatement':
      case 'MatchStatement':
      case 'LabelBlock':
      case 'ErrorStatement':
        return this.comment(statement, `Unsupported FeatherScript block: ${statement.kind}`);
      default:
        return { exits: [] };
    }
  }

  private compileIf(statement: Extract<FeatherStatement, { kind: 'IfStatement' }>): CompiledChain {
    // Gate tests (cooldown/do_once/cast) compile to their dedicated gate nodes — exec gates with no
    // false pin, so `else` is not available on them.
    const gate = this.gateForTest(statement.test.raw);
    if (gate) {
      const consequent = this.compileStatements(statement.consequent);
      if (consequent.first) this.exec(gate.id, consequent.first);
      if (statement.alternates.length) {
        this.warning(statement, 'else/elif is not supported on cooldown()/do_once()/cast() gates — only on plain conditions.');
      }
      return { first: gate.id, exits: consequent.exits.length ? consequent.exits : [out(gate)] };
    }

    const branch = this.addNode('logic.branch', { booleanValue: true }, 1);
    const condition = this.compileValueExpression(statement.test.raw, 'boolean', 0);
    if (condition) this.value(condition, branch.id, 'condition');
    const consequent = this.compileStatements(statement.consequent);
    if (consequent.first) this.exec(branch.id, consequent.first);

    const alternate = this.compileAlternates(statement.alternates);
    if (alternate.first) this.exec(branch.id, alternate.first, 'exec-false');

    // Continue after the if from BOTH paths: the true chain's exits plus either the else chain's
    // exits or (with no else) the branch's False pin — so following statements always run.
    const exits: ExecSource[] = [
      ...(consequent.exits.length ? consequent.exits : consequent.first ? [] : [out(branch)]),
      ...(alternate.first ? alternate.exits : [out(branch, 'exec-false')]),
    ];
    return { first: branch.id, exits };
  }

  /** elif chains compile as a nested branch hanging off the previous branch's False pin. */
  private compileAlternates(
    alternates: Extract<FeatherStatement, { kind: 'IfStatement' }>['alternates'],
  ): CompiledChain {
    if (!alternates.length) return { exits: [] };
    const [head, ...rest] = alternates;
    if (head.kind === 'ElseClause' || !head.test) return this.compileStatements(head.body);

    const branch = this.addNode('logic.branch', { booleanValue: true }, 1);
    const condition = this.compileValueExpression(head.test.raw, 'boolean', 0);
    if (condition) this.value(condition, branch.id, 'condition');
    const consequent = this.compileStatements(head.body);
    if (consequent.first) this.exec(branch.id, consequent.first);
    const tail = this.compileAlternates(rest);
    if (tail.first) this.exec(branch.id, tail.first, 'exec-false');
    return {
      first: branch.id,
      exits: [
        ...(consequent.exits.length ? consequent.exits : consequent.first ? [] : [out(branch)]),
        ...(tail.first ? tail.exits : [out(branch, 'exec-false')]),
      ],
    };
  }

  /** cooldown(seconds) / do_once() / cast(target, "Blueprint") as a whole if-test → gate node. */
  private gateForTest(raw: string): NodeForgeNode | undefined {
    const call = parseCall(stripOuterParens(raw));
    if (!call) return undefined;
    if (call.callee === 'cooldown') {
      const node = this.addNode('logic.cooldown', { numberValue: 1 }, 1);
      this.attachValueOrLiteral(node, 'seconds', call.named.get('seconds') ?? call.positional[0], 'number', 'numberValue');
      return node;
    }
    if (call.callee === 'do_once') return this.addNode('logic.doOnce', {}, 1);
    if (call.callee === 'cast') {
      const targetRaw = call.named.get('target') ?? call.positional[0];
      const blueprintName = unquote(call.named.get('blueprint') ?? call.positional[1] ?? '');
      const castBlueprintId = this.blueprintIdByName(blueprintName);
      if (blueprintName && !castBlueprintId) this.warning({ line: 1, column: 1, length: 1 }, `Unknown blueprint "${blueprintName}" in cast().`);
      const node = this.addNode('logic.cast', { targetObjectId: this.targetLiteral(targetRaw) ?? '$self', castBlueprintId }, 1);
      if (targetRaw && !this.isTargetSentinel(targetRaw)) this.attachWiredValue(node, 'object', targetRaw, 'string');
      return node;
    }
    return undefined;
  }

  /** for index in range(N): / for actor in find_actors(...): */
  private compileFor(statement: Extract<FeatherStatement, { kind: 'ForStatement' }>): CompiledChain {
    const iterable = stripOuterParens(statement.iterable.raw);
    const call = parseCall(iterable);
    let node: NodeForgeNode | undefined;
    if (call?.callee === 'range') {
      node = this.addNode('logic.forLoop', { loopCount: 4 }, 1);
      this.attachValueOrLiteral(node, 'count', call.named.get('count') ?? call.positional[0], 'number', 'loopCount');
    } else if (call?.callee === 'find_actors' || call?.callee === 'find_actor') {
      node = this.addNode('logic.forEachActor', this.actorQueryData(call, 'find_actors'), 1);
    }
    if (!node) return this.comment(statement, `Unsupported loop iterable "${iterable}" — use range(N) or find_actors(...).`);

    this.loopBindings.unshift({ name: statement.binding, ref: { nodeId: node.id, sourceHandle: 'value-out' } });
    const body = this.compileStatements(statement.body);
    this.loopBindings.shift();
    if (body.first) this.exec(node.id, body.first, 'exec-body');
    // Following statements chain from the loop's Completed pin (the default exec-out).
    return { first: node.id, exits: [out(node)] };
  }

  /** Shared blueprint:/tag:/mode: parsing for find_actor (value) and find_actors (loop). */
  private actorQueryData(call: ParsedCall, context: string): Partial<NodeForgeNodeData> {
    const data: Partial<NodeForgeNodeData> = {};
    const blueprintName = unquote(call.named.get('blueprint') ?? '');
    const tag = unquote(call.named.get('tag') ?? '');
    if (blueprintName) {
      const id = this.blueprintIdByName(blueprintName);
      if (id) data.castBlueprintId = id;
      else this.warning({ line: 1, column: 1, length: 1 }, `Unknown blueprint "${blueprintName}" in ${context}().`);
    } else if (tag !== undefined && call.named.has('tag')) {
      data.stringValue = tag;
    }
    const mode = unquote(call.named.get('mode') ?? '');
    if (mode === 'first' || mode === 'nearest') data.findMode = mode;
    return data;
  }

  private isTargetSentinel(raw: string): boolean {
    const value = unquote(raw) ?? raw.trim();
    return value === 'self' || value === 'Player' || value === 'other' || value === 'cast_actor' || unquote(raw) !== undefined;
  }

  /** Route a statement's target argument: sentinels/quoted ids → targetObjectId; expressions
   *  (loop actors, find_actor, a Cast's As pin) → wired into the node's "target" input. */
  private applyTargetArg(node: NodeForgeNode, targetRaw: string | undefined) {
    if (!targetRaw) return;
    if (this.isTargetSentinel(targetRaw)) {
      node.data = { ...node.data, targetObjectId: this.targetLiteral(targetRaw) };
      return;
    }
    this.attachWiredValue(node, 'target', targetRaw, 'string');
  }

  /** Named args win; a compact `{ key: value }` object (printer form of set_physics / Environment.set) fills the rest. */
  private mergeCallProps(call: ParsedCall, objectIndex = 1): Map<string, string> {
    const props = new Map(call.named);
    for (const [key, value] of parseObjectLiteral(call.positional[objectIndex])) {
      if (!props.has(key)) props.set(key, value);
    }
    return props;
  }

  private compileReturn(statement: Extract<FeatherStatement, { kind: 'ReturnStatement' }>): CompiledChain {
    const node = this.addNode('logic.functionReturn', {}, 1);
    if (statement.value && statement.value.raw !== 'none') {
      const valueRef = this.compileValueExpression(statement.value.raw, inferLiteralType(statement.value.raw), 0);
      if (valueRef) this.value(valueRef, node.id, 'value');
    }
    return { first: node.id, exits: [] };
  }

  private compileAssignment(statement: Extract<FeatherStatement, { kind: 'AssignmentStatement' }>): CompiledChain {
    if (statement.operator !== '=') {
      return this.comment(statement, `Unsupported assignment operator "${statement.operator}" for ${statement.target}.`);
    }

    if (statement.target === 'Time.scale') {
      const node = this.addNode('action.setTimeScale', {}, 1);
      this.attachValueOrLiteral(node, 'scale', statement.value.raw, 'number', 'numberValue');
      return { first: node.id, exits: [out(node)] };
    }

    if (statement.target === 'Time.of_day') {
      const node = this.addNode('action.setTimeOfDay', {}, 1);
      this.attachValueOrLiteral(node, 'time', statement.value.raw, 'number', 'timeOfDay');
      return { first: node.id, exits: [out(node)] };
    }

    const gameVariable = statement.target.match(/^Game\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (gameVariable) {
      const variable = this.projectVariableByName.get(gameVariable[1]);
      if (!variable) return this.comment(statement, `Unknown project variable "${gameVariable[1]}".`);
      const node = this.addNode('variable.set', { variableId: variable.id, valueType: variable.type }, 1);
      this.attachValueOrLiteral(node, 'value', statement.value.raw, variable.type);
      return { first: node.id, exits: [out(node)] };
    }

    const objectVariable = statement.target.match(/^self\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (objectVariable) {
      const node = this.addNode('variable.setObject', { objectKey: objectVariable[1], targetObjectId: '$self' }, 1);
      this.attachValueOrLiteral(node, 'value', statement.value.raw, inferLiteralType(statement.value.raw));
      return { first: node.id, exits: [out(node)] };
    }

    return this.comment(statement, `Unsupported assignment target "${statement.target}".`);
  }

  private compileExpressionStatement(expression: FeatherExpression): CompiledChain {
    const call = parseCall(expression.raw);
    if (!call) return this.comment(expression, `Unsupported expression: ${expression.raw}`);

    const node = this.nodeForCall(call);
    if (!node) {
      const last = this.diagnostics[this.diagnostics.length - 1];
      if (last?.message.startsWith('Unknown function')) return { exits: [] };
      return this.comment(expression, `Unsupported call: ${expression.raw}`);
    }
    return { first: node.id, exits: [out(node)] };
  }

  private nodeForCall(call: ParsedCall): NodeForgeNode | undefined {
    const stringArg = (name: string, index: number, fallback = '') => unquote(call.named.get(name) ?? call.positional[index] ?? '') ?? fallback;
    const rawArg = (name: string, index: number) => call.named.get(name) ?? call.positional[index];
    const numberArg = (name: string, index: number, fallback: number) => {
      const value = parseLiteral(rawArg(name, index));
      return typeof value === 'number' ? value : fallback;
    };

    switch (call.callee) {
      case 'node': {
        const kind = (unquote(call.positional[0] ?? '') ?? '') as GraphNodeKind;
        if (!kind.includes('.')) return undefined;
        return this.addNode(kind, {}, 1);
      }
      case 'print': {
        const node = this.addNode('action.print', {}, 1);
        this.attachValueOrLiteral(node, 'message', rawArg('message', 0) ?? '""', 'string', 'message');
        return node;
      }
      case 'self.translate': {
        const node = this.addNode('action.translate', { axis: stringArg('axis', 0, 'z') as 'x' | 'y' | 'z', amount: numberArg('amount', 1, -3.6) }, 1);
        // Positional arg 0 is the vector form only when it isn't the quoted axis shorthand.
        const positionalVector = call.positional[0] && unquote(call.positional[0]) === undefined ? call.positional[0] : undefined;
        this.attachWiredValue(node, 'vector', call.named.get('vector') ?? positionalVector, 'vector3');
        this.attachValueOrLiteral(node, 'amount', call.named.get('amount'), 'number', 'amount');
        return node;
      }
      case 'self.rotate': {
        const node = this.addNode('action.rotate', { axis: stringArg('axis', 0, 'y') as 'x' | 'y' | 'z', amount: numberArg('amount', 1, 90) }, 1);
        this.attachValueOrLiteral(node, 'amount', call.named.get('amount'), 'number', 'amount');
        return node;
      }
      case 'self.move': {
        const node = this.addNode('action.move', { amount: numberArg('speed', 1, 4) }, 1);
        this.attachWiredValue(node, 'vector', rawArg('vector', 0), 'vector3');
        this.attachValueOrLiteral(node, 'speed', call.named.get('speed'), 'number', 'amount');
        return node;
      }
      case 'self.drive': {
        const node = this.addNode('action.drive', {}, 1);
        this.attachWiredValue(node, 'vector', rawArg('vector', 0) ?? 'Input.drive()', 'vector3');
        return node;
      }
      case 'self.jump':
        return this.addNode('action.jump', {}, 1);
      case 'self.move_to': {
        const node = this.addNode('action.moveTo', {}, 1);
        this.attachWiredValue(node, 'target', rawArg('target', 0), 'vector3');
        this.attachValueOrLiteral(node, 'speed', call.named.get('speed'), 'number', 'amount');
        this.attachValueOrLiteral(node, 'arrival', call.named.get('arrival'), 'number', 'numberValue');
        return node;
      }
      case 'wait': {
        const node = this.addNode('logic.delay', { numberValue: numberArg('seconds', 0, 1) }, 1);
        this.attachValueOrLiteral(node, 'seconds', rawArg('seconds', 0), 'number', 'numberValue');
        return node;
      }
      case 'destroy':
        return this.addNode('action.destroyObject', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
      case 'fire_event': {
        const node = this.addNode('action.fireEvent', { eventName: stringArg('eventName', 0, 'CustomEvent') }, 1);
        this.applyTargetArg(node, call.named.get('target'));
        const payload = call.named.get('payload');
        if (payload) this.attachWiredValue(node, 'payload', payload, inferLiteralType(payload));
        return node;
      }
      case 'apply_damage': {
        const node = this.addNode('action.applyDamage', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachValueOrLiteral(node, 'amount', rawArg('amount', 1), 'number', 'damageAmount');
        return node;
      }
      case 'apply_force': {
        const node = this.addNode('action.applyForce', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
        this.attachWiredValue(node, 'vector', rawArg('vector', 1), 'vector3');
        this.attachValueOrLiteral(node, 'amount', rawArg('amount', 2) ?? call.named.get('amount'), 'number', 'amount');
        return node;
      }
      case 'apply_impulse': {
        const node = this.addNode('action.applyImpulse', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
        this.attachWiredValue(node, 'vector', rawArg('vector', 1), 'vector3');
        this.attachValueOrLiteral(node, 'amount', rawArg('amount', 2) ?? call.named.get('amount'), 'number', 'amount');
        return node;
      }
      case 'apply_force_at_point': {
        const node = this.addNode('action.applyForceAtPoint', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
        this.attachWiredValue(node, 'vector', rawArg('vector', 1), 'vector3');
        this.attachValueOrLiteral(node, 'point', rawArg('point', 2) ?? call.named.get('point'), 'vector3', 'localPoint');
        this.attachValueOrLiteral(node, 'amount', rawArg('amount', 3) ?? call.named.get('amount'), 'number', 'amount');
        return node;
      }
      case 'set_var': {
        const node = this.addNode('variable.setObject', { objectKey: stringArg('key', 1, 'value') }, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachValueOrLiteral(node, 'value', rawArg('value', 2), inferLiteralType(rawArg('value', 2) ?? '0'));
        return node;
      }
      case 'self.face_player':
        return this.addNode('action.facePlayer', {}, 1);
      case 'set_position':
      case 'set_rotation':
      case 'set_scale': {
        const kind: GraphNodeKind =
          call.callee === 'set_position' ? 'action.setPosition' : call.callee === 'set_rotation' ? 'action.setRotation' : 'action.setScale';
        const handle = call.callee === 'set_position' ? 'position' : call.callee === 'set_rotation' ? 'rotation' : 'scale';
        const node = this.addNode(kind, {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachWiredValue(node, handle, rawArg(handle, 1), 'vector3');
        return node;
      }
      case 'look_at': {
        const node = this.addNode('action.lookAt', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachWiredValue(node, 'point', rawArg('point', 1), 'vector3');
        return node;
      }
      case 'set_velocity': {
        const node = this.addNode('action.setVelocity', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachWiredValue(node, 'vector', rawArg('vector', 1), 'vector3');
        return node;
      }
      case 'apply_torque': {
        const node = this.addNode('action.applyTorque', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
        this.attachWiredValue(node, 'vector', rawArg('vector', 1), 'vector3');
        this.attachValueOrLiteral(node, 'amount', rawArg('amount', 2) ?? call.named.get('amount'), 'number', 'amount');
        return node;
      }
      case 'spawn_object':
        return this.addNode('action.spawnObject', { spawnKind: stringArg('kind', 0, 'cube') as NodeForgeNodeData['spawnKind'] }, 1);
      case 'spawn_prefab': {
        const node = this.addNode('action.spawnPrefab', { prefabId: stringArg('prefabId', 0, '') || undefined }, 1);
        this.attachWiredValue(node, 'location', call.named.get('location'), 'vector3');
        return node;
      }
      case 'explode': {
        const node = this.addNode('action.explode', {}, 1);
        this.attachWiredValue(node, 'location', call.named.get('location'), 'vector3');
        this.attachValueOrLiteral(node, 'radius', call.named.get('radius'), 'number', 'explodeRadius');
        this.attachValueOrLiteral(node, 'damage', call.named.get('damage'), 'number', 'explodeDamage');
        return node;
      }
      case 'spawn_decal': {
        const decalKind = unquote(call.named.get('kind') ?? '');
        const node = this.addNode('action.spawnDecal', decalKind === 'blood' || decalKind === 'scorch' ? { decalKind } : {}, 1);
        this.attachWiredValue(node, 'location', call.named.get('location'), 'vector3');
        this.attachWiredValue(node, 'normal', call.named.get('normal'), 'vector3');
        this.attachValueOrLiteral(node, 'size', call.named.get('size'), 'number', 'decalSize');
        return node;
      }
      case 'set_visible': {
        const node = this.addNode('action.setVisible', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
        this.attachValueOrLiteral(node, 'visible', rawArg('visible', 1), 'boolean', 'visible');
        return node;
      }
      case 'set_joint_motor': {
        const node = this.addNode('action.setJointMotor', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachWiredValue(node, 'position', call.named.get('position'), 'number');
        this.attachValueOrLiteral(node, 'velocity', call.named.get('velocity'), 'number', 'numberValue');
        return node;
      }
      case 'set_active': {
        const node = this.addNode('action.setActive', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
        this.attachValueOrLiteral(node, 'on', rawArg('on', 1), 'boolean', 'booleanValue');
        return node;
      }
      case 'set_physics': {
        const props = this.mergeCallProps(call, 1);
        const body = unquote(props.get('body') ?? '') ?? 'dynamic';
        const collider = unquote(props.get('collider') ?? '') ?? 'box';
        const node = this.addNode(
          'action.setPhysics',
          {
            physicsBodyType: (PHYSICS_BODIES.has(body) ? body : 'dynamic') as NodeForgeNodeData['physicsBodyType'],
            physicsCollider: (PHYSICS_COLLIDERS.has(collider) ? collider : 'box') as NodeForgeNodeData['physicsCollider'],
          },
          1,
        );
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachValueOrLiteral(node, 'enabled', props.get('enabled'), 'boolean', 'physicsEnabled');
        this.attachValueOrLiteral(node, 'mass', props.get('mass'), 'number', 'physicsMass');
        return node;
      }
      case 'set_ragdoll': {
        const node = this.addNode('action.setRagdoll', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachValueOrLiteral(node, 'on', rawArg('on', 1), 'boolean', 'booleanValue');
        return node;
      }
      case 'tween':
      case 'timeline': {
        const property = unquote(call.named.get('property') ?? '') ?? 'position';
        const easing = unquote(call.named.get('easing') ?? '') ?? 'easeInOut';
        const space = unquote(call.named.get('space') ?? '') ?? 'local';
        const relative = parseLiteral(call.named.get('relative') ?? 'false');
        const loop = parseLiteral(call.named.get('loop') ?? 'false');
        const pingPong = parseLiteral(call.named.get('ping_pong') ?? 'false');
        const encodedCurve = unquote(call.named.get('curve') ?? '');
        const timelineId = unquote(call.named.get('id') ?? '') || (call.callee === 'timeline' ? makeId('timeline') : undefined);
        const timelineName = unquote(call.named.get('name') ?? '');
        const node = this.addNode(
          'action.tweenProperty',
          {
            tweenProperty: (TWEEN_PROPERTIES.has(property) ? property : 'position') as NodeForgeNodeData['tweenProperty'],
            easing: (TWEEN_EASINGS.has(easing) ? easing : 'easeInOut') as NodeForgeNodeData['easing'],
            tweenCurve:
              call.callee === 'timeline'
                ? decodeTimelineCurve(encodedCurve) ?? timelineCurvePreset('smooth')
                : decodeTimelineCurve(encodedCurve),
            tweenSpace: space === 'world' ? 'world' : 'local',
            tweenValueMode: relative === true ? 'relative' : 'absolute',
            tweenLoop: loop === true,
            tweenPingPong: pingPong === true,
            ...(call.callee === 'timeline' ? { timelineId, timelineName: timelineName || 'Timeline' } : {}),
          },
          1,
        );
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachValueOrLiteral(node, 'to', call.named.get('to') ?? call.positional[1], 'vector3', 'vectorValue');
        this.attachValueOrLiteral(node, 'duration', call.named.get('duration'), 'number', 'numberValue');
        return node;
      }
      case 'timeline_control': {
        const timelineRefId = unquote(call.positional[0] ?? call.named.get('id') ?? '') || undefined;
        const requested = unquote(call.named.get('command') ?? '') ?? 'play';
        return this.addNode(
          'action.timelineControl',
          {
            timelineRefId,
            timelineCommand: (TIMELINE_COMMANDS.has(requested) ? requested : 'play') as NodeForgeNodeData['timelineCommand'],
          },
          1,
        );
      }
      case 'fracture': {
        const node = this.addNode('action.fractureObject', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        return node;
      }
      case 'burst_particles': {
        const node = this.addNode('action.burstParticles', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachValueOrLiteral(node, 'count', rawArg('count', 1), 'number', 'numberValue');
        return node;
      }
      case 'set_particles': {
        const node = this.addNode('action.setParticlesEmitting', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachValueOrLiteral(node, 'on', rawArg('on', 1), 'boolean', 'booleanValue');
        return node;
      }
      case 'spawn_particles': {
        const node = this.addNode('action.spawnParticleSystem', { particleSystemId: stringArg('systemId', 0, '') || undefined }, 1);
        this.attachWiredValue(node, 'location', call.named.get('location'), 'vector3');
        const attach = parseLiteral(call.named.get('attach') ?? '');
        if (typeof attach === 'boolean') node.data = { ...node.data, particleAttach: attach };
        return node;
      }
      case 'play_animation':
      case 'Animator.play': {
        const node = this.addNode(
          'action.playAnimation',
          { animationId: stringArg('animationId', 0, '') || undefined },
          1,
        );
        this.applyTargetArg(node, call.named.get('target'));
        this.attachValueOrLiteral(node, 'speed', call.named.get('speed'), 'number', 'animationSpeed');
        return node;
      }
      case 'set_movement_mode': {
        const mode = unquote(rawArg('mode', 1) ?? '') ?? 'walking';
        const node = this.addNode(
          'action.setMovementMode',
          { movementMode: (MOVEMENT_MODES.has(mode) ? mode : 'walking') as NodeForgeNodeData['movementMode'] },
          1,
        );
        this.applyTargetArg(node, rawArg('target', 0));
        return node;
      }
      case 'enter_vehicle': {
        const node = this.addNode('action.enterVehicle', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        return node;
      }
      case 'exit_vehicle': {
        const node = this.addNode('action.exitVehicle', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        const offset = call.named.get('offset') ?? call.positional[1];
        const literal = parseLiteral(offset);
        if (Array.isArray(literal)) node.data = { ...node.data, vectorValue: literal };
        else if (offset) this.attachWiredValue(node, 'offset', offset, 'vector3');
        return node;
      }
      case 'spawn_projectile': {
        const node = this.addNode('action.spawnProjectile', {}, 1);
        this.attachValueOrLiteral(node, 'speed', call.named.get('speed') ?? call.positional[0], 'number', 'projectileSpeed');
        this.attachValueOrLiteral(node, 'damage', call.named.get('damage') ?? call.positional[1], 'number', 'projectileDamage');
        return node;
      }
      case 'spawn_attached': {
        const node = this.addNode(
          'action.spawnAttached',
          {
            assetId: stringArg('assetId', 0, '') || undefined,
            attachBoneName: unquote(call.named.get('bone') ?? '') || undefined,
            attachSocketName: unquote(call.named.get('socket') ?? '') || undefined,
          },
          1,
        );
        this.applyTargetArg(node, call.named.get('target'));
        return node;
      }
      case 'cut_cable': {
        const node = this.addNode('action.cutCable', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        return node;
      }
      case 'set_cable_length': {
        const node = this.addNode('action.setCableLength', {}, 1);
        this.applyTargetArg(node, rawArg('target', 0));
        this.attachValueOrLiteral(node, 'length', rawArg('length', 1), 'number', 'numberValue');
        return node;
      }
      case 'Camera.set': {
        const node = this.addNode('action.setCamera', {}, 1);
        this.attachWiredValue(node, 'distance', call.named.get('distance') ?? call.positional[0], 'number');
        this.attachWiredValue(node, 'height', call.named.get('height') ?? call.positional[1], 'number');
        return node;
      }
      case 'Screen.fade': {
        const color = unquote(call.named.get('color') ?? '');
        const node = this.addNode('action.screenFade', color ? { fadeColor: color } : {}, 1);
        this.attachValueOrLiteral(node, 'to', rawArg('to', 0), 'number', 'fadeTo');
        this.attachValueOrLiteral(node, 'duration', call.named.get('duration'), 'number', 'numberValue');
        return node;
      }
      case 'Replay.start': {
        const node = this.addNode('action.startReplay', {}, 1);
        this.attachValueOrLiteral(node, 'seconds', rawArg('seconds', 0), 'number', 'numberValue');
        return node;
      }
      case 'Environment.set': {
        const objectRaw = call.positional[0]?.trim().startsWith('{') ? call.positional[0] : undefined;
        const props = objectRaw ? parseObjectLiteral(objectRaw) : call.named;
        const envPatch: NonNullable<NodeForgeNodeData['envPatch']> = {};
        for (const [key, value] of props) {
          const lit = parseLiteral(value);
          if (lit === undefined) continue;
          (envPatch as Record<string, GraphValue>)[key] = lit;
        }
        return this.addNode('action.setEnvironment', { envPatch }, 1);
      }
      case 'UI.show':
        return this.addNode('ui.show', { documentId: stringArg('documentId', 0, '') || undefined }, 1);
      case 'UI.hide':
        return this.addNode('ui.hide', { documentId: stringArg('documentId', 0, '') || undefined }, 1);
      case 'UI.toggle':
        return this.addNode('ui.toggle', { documentId: stringArg('documentId', 0, '') || undefined }, 1);
      case 'UI.set_text': {
        const node = this.addNode('ui.setText', { documentId: stringArg('documentId', 0, '') || undefined, elementId: stringArg('elementId', 1, '') || undefined }, 1);
        this.attachValueOrLiteral(node, 'text', rawArg('text', 2), 'string', 'stringValue');
        return node;
      }
      case 'UI.set_visible': {
        const node = this.addNode(
          'ui.setVisible',
          { documentId: stringArg('documentId', 0, '') || undefined, elementId: stringArg('elementId', 1, '') || undefined },
          1,
        );
        this.attachValueOrLiteral(node, 'visible', rawArg('visible', 2), 'boolean', 'visible');
        return node;
      }
      case 'Save.write':
        return this.addNode('save.write', { saveSlot: stringArg('slot', 0, 'slot1') }, 1);
      case 'Save.load':
        return this.addNode('save.load', { saveSlot: stringArg('slot', 0, 'slot1') }, 1);
      case 'Save.clear':
        return this.addNode('save.clear', { saveSlot: stringArg('slot', 0, 'slot1') }, 1);
      case 'Audio.play':
        return this.addNode('action.playSound', { assetId: stringArg('assetId', 0, '') || undefined }, 1);
      case 'Cinematic.play':
        return this.addNode('action.playCinematic', { cinematicId: stringArg('cinematicId', 0, '') || undefined }, 1);
      case 'Scene.load':
        return this.addNode('action.loadScene', { targetSceneId: stringArg('sceneId', 0, '') || undefined }, 1);
      case 'Quality.set':
        return this.addNode('action.setQuality', { qualityLevel: stringArg('level', 0, 'High') as NodeForgeNodeData['qualityLevel'] }, 1);
      case 'Camera.shake': {
        const node = this.addNode('action.cameraShake', {}, 1);
        this.attachValueOrLiteral(node, 'amount', rawArg('amount', 0), 'number', 'shakeAmount');
        return node;
      }
      case 'Screen.flash': {
        const color = unquote(call.named.get('color') ?? '');
        const node = this.addNode('action.screenFlash', color ? { flashColor: color } : {}, 1);
        this.attachValueOrLiteral(node, 'amount', rawArg('amount', 0), 'number', 'flashAmount');
        return node;
      }
      case 'Animator.set_float': {
        const node = this.addNode('animator.setFloat', { paramName: stringArg('param', 0, 'param') }, 1);
        this.attachValueOrLiteral(node, 'value', rawArg('value', 1), 'number', 'numberValue');
        return node;
      }
      case 'Animator.set_bool': {
        const node = this.addNode('animator.setBool', { paramName: stringArg('param', 0, 'param') }, 1);
        this.attachValueOrLiteral(node, 'value', rawArg('value', 1), 'boolean', 'booleanValue');
        return node;
      }
      case 'Animator.trigger':
        return this.addNode('animator.setTrigger', { paramName: stringArg('param', 0, 'param') }, 1);
      case 'Material.set_color': {
        const node = this.addNode('action.setMaterialColor', { materialColorTarget: stringArg('target', 0, 'base') as NodeForgeNodeData['materialColorTarget'] }, 1);
        this.attachValueOrLiteral(node, 'color', rawArg('color', 1), 'string', 'materialColor');
        return node;
      }
      case 'Material.set': {
        const node = this.addNode('action.setMaterialProperty', { materialProperty: stringArg('property', 0, 'metalness') as NodeForgeNodeData['materialProperty'] }, 1);
        this.attachValueOrLiteral(node, 'value', rawArg('value', 1), 'number', 'numberValue');
        return node;
      }
      default:
        // A bare-identifier callee we don't own = a user function → Call Function node (Blueprint
        // function-lite). Positional/named args wire into the A/B/C pins.
        if (IDENTIFIER.test(call.callee) && !RESERVED_CALLEES.has(call.callee)) return this.buildCallFunction(call, 1);
        return undefined;
    }
  }

  private buildCallFunction(call: ParsedCall, depth: number): NodeForgeNode | undefined {
    const name = sanitizeIdentifier(call.callee, 'MyFunction');
    if (!this.knownFunctions.has(name.toLowerCase())) {
      const hint = suggestIdentifier(call.callee, [...RESERVED_CALLEES, ...this.knownFunctions]);
      this.warning(
        { line: 1, column: 1, length: call.callee.length || 1 },
        `Unknown function "${call.callee}"${hint ? ` — did you mean ${hint}()?` : '. Declare it with `function Name:` first, or use a built-in.'}`,
      );
      return undefined;
    }
    const node = this.addNode('logic.callFunction', { functionName: name }, depth);
    (['a', 'b', 'c'] as const).forEach((handle, index) => {
      const raw = call.named.get(handle) ?? call.positional[index];
      if (raw !== undefined) this.attachWiredValue(node, handle, raw, 'number');
    });
    return node;
  }

  private attachValueOrLiteral(
    node: NodeForgeNode,
    handle: string,
    raw: string | undefined,
    fallbackType: GraphValueType,
    dataKey?: keyof NodeForgeNodeData,
  ) {
    if (!raw) return;
    const literal = parseLiteral(raw);
    if (literal !== undefined && dataKey) {
      node.data = { ...node.data, [dataKey]: literal };
      return;
    }
    if (literal !== undefined && !dataKey) {
      node.data = { ...node.data, ...dataForLiteral(literal, fallbackType) };
      return;
    }
    const valueRef = this.compileValueExpression(raw, fallbackType, 0);
    if (valueRef) this.value(valueRef, node.id, handle);
  }

  /** Always materialize the value as a wired node — for inputs the runtime ONLY reads via an edge
   *  (vectors on Translate/Move/Drive/Apply Force/Apply Impulse, Fire Event payload). */
  private attachWiredValue(node: NodeForgeNode, handle: string, raw: string | undefined, fallbackType: GraphValueType) {
    if (raw === undefined) return;
    const valueRef = this.compileValueExpression(raw, fallbackType, 0);
    if (valueRef) this.value(valueRef, node.id, handle);
  }

  /** Build a binary-operator node with left/right compiled into the a/b (or custom) input handles. */
  private binaryNode(
    kind: GraphNodeKind,
    data: Partial<NodeForgeNodeData>,
    left: string,
    right: string,
    depth: number,
    handles: [string, string] = ['a', 'b'],
  ): ValueRef {
    const node = this.addNode(kind, data, depth);
    const a = this.compileValueExpression(left, 'number', depth);
    const b = this.compileValueExpression(right, 'number', depth);
    if (a) this.value(a, node.id, handles[0]);
    if (b) this.value(b, node.id, handles[1]);
    return { nodeId: node.id, sourceHandle: 'value-out' };
  }

  private compileValueExpression(raw: string | undefined, fallbackType: GraphValueType, depth: number): ValueRef | undefined {
    if (!raw) return undefined;
    const trimmed = stripOuterParens(raw);
    const ref = (node: NodeForgeNode): ValueRef => ({ nodeId: node.id, sourceHandle: 'value-out' });
    const literal = parseLiteral(trimmed);
    if (literal !== undefined) {
      return ref(this.addNode(makeNodeData(literalNodeLabel(literal), 'Values').nodeKind, dataForLiteral(literal, fallbackType), depth));
    }

    const variable = trimmed.match(/^Game\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (variable) {
      const found = this.projectVariableByName.get(variable[1]);
      if (!found) {
        this.warning({ line: 1, column: 1, length: 1 }, `Unknown project variable "${variable[1]}".`);
        return undefined;
      }
      return ref(this.addNode('variable.get', { variableId: found.id, valueType: found.type }, depth));
    }

    // Runtime defaults the printer surfaces as pseudo-values: leaving these UNWIRED is the correct
    // compilation (the node falls back to the owner's position/forward at runtime).
    if (trimmed === 'self.position' || trimmed === 'self.forward') return undefined;

    const objectVariable = trimmed.match(/^self\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (objectVariable) return ref(this.addNode('variable.getObject', { objectKey: objectVariable[1], targetObjectId: '$self' }, depth));

    // Identifiers bound by the innermost loop (for index / for actor), then by the enclosing
    // event/function root: custom-event payload, damage amount, function args a/b/c.
    if (IDENTIFIER.test(trimmed)) {
      const bound = this.loopBindings.find((binding) => binding.name === trimmed);
      if (bound) return bound.ref;
      if (this.currentRoot) {
        const rootKind = this.currentRoot.data.nodeKind;
        if (trimmed === 'payload' && rootKind === 'event.custom') return { nodeId: this.currentRoot.id, sourceHandle: 'value-out' };
        if (trimmed === 'amount' && rootKind === 'event.receiveDamage') return { nodeId: this.currentRoot.id, sourceHandle: 'value-out' };
        if (trimmed === 'speed' && rootKind === 'event.land') return { nodeId: this.currentRoot.id, sourceHandle: 'value-out' };
        if ((trimmed === 'a' || trimmed === 'b' || trimmed === 'c') && rootKind === 'event.functionEntry') {
          return { nodeId: this.currentRoot.id, sourceHandle: `arg-${trimmed}` };
        }
      }
    }

    // Inside a collision handler, the impact's contact detail reads straight off the root's pins.
    if (this.currentRoot?.data.nodeKind === 'event.collisionEnter') {
      if (trimmed === 'other') return { nodeId: this.currentRoot.id, sourceHandle: 'value-out' };
      if (trimmed === 'contact_normal()') return { nodeId: this.currentRoot.id, sourceHandle: 'normal' };
      if (trimmed === 'contact_point()') return { nodeId: this.currentRoot.id, sourceHandle: 'point' };
      if (trimmed === 'impact_speed()') return { nodeId: this.currentRoot.id, sourceHandle: 'speed' };
    }

    if (trimmed === 'Input.move()') return ref(this.addNode('input.move', {}, depth));
    if (trimmed === 'Input.drive()') return ref(this.addNode('input.driveInput', {}, depth));
    if (trimmed === 'self.is_grounded()') return ref(this.addNode('query.grounded', {}, depth));
    if (trimmed === 'self.vehicle_speed()') return ref(this.addNode('query.vehicleSpeed', {}, depth));
    if (trimmed === 'Player.location') return ref(this.addNode('ai.playerLocation', {}, depth));
    if (trimmed === 'Time.of_day') return ref(this.addNode('query.getTimeOfDay', {}, depth));
    if (trimmed === 'AI.distance_to_player()') return ref(this.addNode('ai.distanceToPlayer', {}, depth));
    if (trimmed === 'AI.direction_to_player()') return ref(this.addNode('ai.directionToPlayer', {}, depth));
    if (trimmed === 'AI.has_line_of_sight()') return ref(this.addNode('ai.hasLineOfSight', {}, depth));
    if (trimmed === 'Animator.state()') return ref(this.addNode('animator.getState', {}, depth));
    if (trimmed === 'Material.color()') return ref(this.addNode('action.getMaterialColor', {}, depth));

    // Multi-output queries read via a pin suffix: raycast(...).actor, overlap_sphere(...).count.
    const suffixed = trimmed.match(/^(raycast|overlap_sphere|sphere_cast)\((.*)\)\.(hit|actor|point|distance|count|normal)$/);
    if (suffixed) {
      const call = parseCall(`${suffixed[1]}(${suffixed[2]})`);
      const sourceHandle = suffixed[3] === 'hit' ? 'value-out' : suffixed[3];
      if (call?.callee === 'raycast') {
        const node = this.addNode('query.raycast', {}, depth);
        this.attachWiredValue(node, 'direction', call.named.get('direction'), 'vector3');
        this.attachValueOrLiteral(node, 'distance', call.named.get('distance'), 'number', 'numberValue');
        return { nodeId: node.id, sourceHandle };
      }
      if (call?.callee === 'overlap_sphere') {
        const node = this.addNode('query.overlapSphere', {}, depth);
        this.attachWiredValue(node, 'location', call.named.get('location'), 'vector3');
        this.attachValueOrLiteral(node, 'radius', call.named.get('radius'), 'number', 'numberValue');
        return { nodeId: node.id, sourceHandle };
      }
      if (call?.callee === 'sphere_cast') {
        const node = this.addNode('query.sphereCast', {}, depth);
        this.attachWiredValue(node, 'direction', call.named.get('direction'), 'vector3');
        this.attachValueOrLiteral(node, 'distance', call.named.get('distance'), 'number', 'numberValue');
        this.attachValueOrLiteral(node, 'radius', call.named.get('radius'), 'number', 'amount');
        return { nodeId: node.id, sourceHandle };
      }
    }

    const call = parseCall(trimmed);
    if (call) {
      const arg = (name: string, index: number) => call.named.get(name) ?? call.positional[index];
      const wireAll = (kind: GraphNodeKind, data: Partial<NodeForgeNodeData>, handles: Array<[string, string | undefined]>): ValueRef => {
        const node = this.addNode(kind, data, depth);
        handles.forEach(([handle, value]) => {
          if (value !== undefined) this.attachWiredValue(node, handle, value, 'number');
        });
        return ref(node);
      };
      switch (call.callee) {
        case 'vec3': {
          const values = call.positional.map((item) => parseLiteral(item));
          if (values.length === 3 && values.every((item) => typeof item === 'number')) {
            return ref(this.addNode('value.vector3', { vectorValue: values as unknown as Vector3Tuple }, depth));
          }
          return wireAll('math.makeVector', {}, [['x', arg('x', 0)], ['y', arg('y', 1)], ['z', arg('z', 2)]]);
        }
        case 'get_var': {
          const key = unquote(call.named.get('key') ?? call.positional[1] ?? '') ?? 'value';
          const node = this.addNode('variable.getObject', { objectKey: key, targetObjectId: '$self' }, depth);
          this.applyTargetArg(node, call.named.get('target') ?? call.positional[0]);
          return ref(node);
        }
        case 'min':
        case 'max':
          return wireAll(call.callee === 'min' ? 'math.min' : 'math.max', {}, [['a', arg('a', 0)], ['b', arg('b', 1)]]);
        case 'clamp':
          return wireAll('math.clamp', {}, [['value', arg('value', 0)], ['min', arg('min', 1)], ['max', arg('max', 2)]]);
        case 'lerp':
          return wireAll('math.lerp', {}, [['a', arg('a', 0)], ['b', arg('b', 1)], ['t', arg('t', 2)]]);
        case 'pow':
          return wireAll('math.power', {}, [['a', arg('a', 0)], ['b', arg('b', 1)]]);
        case 'distance':
          return wireAll('math.distance', {}, [['a', arg('a', 0)], ['b', arg('b', 1)]]);
        case 'dot':
          return wireAll('math.dot', {}, [['a', arg('a', 0)], ['b', arg('b', 1)]]);
        case 'normalize':
          return wireAll('math.normalize', {}, [['value', arg('value', 0)]]);
        case 'length':
          return wireAll('math.vectorLength', {}, [['vector', arg('vector', 0)]]);
        case 'map_range':
          return wireAll('math.mapRange', {}, [
            ['value', arg('value', 0)],
            ['inMin', arg('inMin', 1)],
            ['inMax', arg('inMax', 2)],
            ['outMin', arg('outMin', 3)],
            ['outMax', arg('outMax', 4)],
          ]);
        case 'abs':
        case 'round':
        case 'floor':
        case 'sin':
        case 'cos':
          return wireAll(`math.${call.callee}` as GraphNodeKind, {}, [['value', arg('value', 0)]]);
        case 'vec_add':
          return wireAll('math.vectorAdd', {}, [['a', arg('a', 0)], ['b', arg('b', 1)]]);
        case 'vec_sub':
          return wireAll('math.vectorSubtract', {}, [['a', arg('a', 0)], ['b', arg('b', 1)]]);
        case 'vec_scale':
          return wireAll('math.vectorScale', {}, [['vector', arg('vector', 0)], ['scale', arg('scale', 1)]]);
        case 'append':
          return wireAll('string.append', {}, [['a', arg('a', 0)], ['b', arg('b', 1)]]);
        case 'random':
        case 'random_int': {
          const node = this.addNode('value.random', call.callee === 'random_int' ? { randomInteger: true } : {}, depth);
          this.attachValueOrLiteral(node, 'min', arg('min', 0), 'number', 'randomMin');
          this.attachValueOrLiteral(node, 'max', arg('max', 1), 'number', 'randomMax');
          return ref(node);
        }
        case 'position':
        case 'rotation':
        case 'scale': {
          const kind: GraphNodeKind =
            call.callee === 'position' ? 'action.getPosition' : call.callee === 'rotation' ? 'action.getRotation' : 'action.getScale';
          return ref(this.targetedValueNode(kind, arg('target', 0), depth));
        }
        case 'velocity':
          return ref(this.targetedValueNode('query.velocity', arg('target', 0), depth));
        case 'speed':
          return ref(this.targetedValueNode('query.getSpeed', arg('target', 0), depth));
        case 'cable_tension':
          return ref(this.addNode('query.cableTension', { targetObjectId: this.targetLiteral(arg('target', 0)) }, depth));
        case 'find_actor': {
          const data = this.actorQueryData(call, 'find_actor');
          const kind: GraphNodeKind = data.castBlueprintId ? 'query.findActorByBlueprint' : 'query.findActorByTag';
          return ref(this.addNode(kind, data, depth));
        }
        case 'Save.has':
          return ref(this.addNode('save.has', { saveSlot: unquote(arg('slot', 0) ?? '') ?? 'slot1' }, depth));
        case 'Animator.get':
          return ref(this.addNode('animator.getParam', { paramName: unquote(arg('param', 0) ?? '') ?? 'param' }, depth));
        case 'Material.get':
          return ref(
            this.addNode('action.getMaterialProperty', { materialProperty: (unquote(arg('property', 0) ?? '') ?? 'metalness') as NodeForgeNodeData['materialProperty'] }, depth),
          );
        case 'Data.get': {
          const node = this.addNode(
            'data.tableGet',
            { tableId: unquote(arg('table', 0) ?? '') || undefined, columnId: unquote(arg('column', 2) ?? '') || undefined },
            depth,
          );
          this.attachValueOrLiteral(node, 'rowKey', arg('rowKey', 1), 'string', 'rowKey');
          return ref(node);
        }
        default:
          if (IDENTIFIER.test(call.callee) && !RESERVED_CALLEES.has(call.callee)) {
            const fn = this.buildCallFunction(call, depth);
            return fn ? ref(fn) : undefined;
          }
      }
    }

    // Operators, lowest precedence first so the tree splits correctly: Python conditional,
    // or, and, not, comparisons, additive, multiplicative.
    const ifIdx = findLastWordOp(trimmed, 'if');
    if (ifIdx > 0) {
      const elseIdx = findLastWordOp(trimmed.slice(ifIdx), 'else');
      if (elseIdx > 0) {
        const node = this.addNode('logic.select', {}, depth);
        const a = this.compileValueExpression(trimmed.slice(0, ifIdx), fallbackType, depth);
        const condition = this.compileValueExpression(trimmed.slice(ifIdx + 4, ifIdx + elseIdx), 'boolean', depth);
        const b = this.compileValueExpression(trimmed.slice(ifIdx + elseIdx + 6), fallbackType, depth);
        if (a) this.value(a, node.id, 'a');
        if (condition) this.value(condition, node.id, 'condition');
        if (b) this.value(b, node.id, 'b');
        return ref(node);
      }
    }
    const orIdx = findLastWordOp(trimmed, 'or');
    if (orIdx > 0) return this.binaryNode('logic.or', {}, trimmed.slice(0, orIdx), trimmed.slice(orIdx + 4), depth);
    const andIdx = findLastWordOp(trimmed, 'and');
    if (andIdx > 0) return this.binaryNode('logic.and', {}, trimmed.slice(0, andIdx), trimmed.slice(andIdx + 5), depth);
    if (trimmed.startsWith('not ')) {
      const node = this.addNode('logic.not', {}, depth);
      const value = this.compileValueExpression(trimmed.slice(4), 'boolean', depth);
      if (value) this.value(value, node.id, 'value');
      return ref(node);
    }

    for (const op of COMPARATORS) {
      const index = findTopLevelToken(trimmed, op);
      if (index > 0) {
        return this.binaryNode('logic.compare', { compareOp: op }, trimmed.slice(0, index), trimmed.slice(index + op.length), depth);
      }
    }

    const addIdx = findLastAdditive(trimmed);
    if (addIdx > 0) {
      const kind: GraphNodeKind = trimmed[addIdx] === '+' ? 'math.add' : 'math.subtract';
      return this.binaryNode(kind, {}, trimmed.slice(0, addIdx), trimmed.slice(addIdx + 1), depth);
    }
    const mulIdx = findLastMultiplicative(trimmed);
    if (mulIdx > 0) {
      const kind: GraphNodeKind =
        trimmed[mulIdx] === '*' ? 'math.multiply' : trimmed[mulIdx] === '/' ? 'math.divide' : 'math.modulo';
      return this.binaryNode(kind, {}, trimmed.slice(0, mulIdx), trimmed.slice(mulIdx + 1), depth);
    }

    this.warning({ line: 1, column: 1, length: trimmed.length || 1 }, `Unsupported value expression "${trimmed}".`);
    return undefined;
  }

  /** A target-aware value node (Get Position/Rotation/Scale/Velocity): sentinels/ids go to
   *  targetObjectId; expressions (a Cast's As pin, find_actor) wire into the "target" input. */
  private targetedValueNode(kind: GraphNodeKind, targetRaw: string | undefined, depth: number): NodeForgeNode {
    if (!targetRaw || this.isTargetSentinel(targetRaw)) {
      return this.addNode(kind, { targetObjectId: this.targetLiteral(targetRaw) }, depth);
    }
    const node = this.addNode(kind, {}, depth);
    this.attachWiredValue(node, 'target', targetRaw, 'string');
    return node;
  }

  private createEventNode(handler: FeatherEventHandler): NodeForgeNode {
    switch (handler.eventName) {
      case 'start':
        return this.addNode('event.start', {}, 0);
      case 'update': {
        const every = handler.detail?.match(/^every\s+([0-9.]+)s?$/);
        return this.addNode('event.update', every ? { numberValue: Number(every[1]) || 0 } : {}, 0);
      }
      case 'key_down':
        return this.addNode('event.keyDown', { keyCode: unquote(handler.args[0] ?? '') ?? 'KeyW' }, 0);
      case 'key_up':
        return this.addNode('event.keyUp', { keyCode: unquote(handler.args[0] ?? '') ?? 'KeyW' }, 0);
      case 'collision_enter':
        return this.addNode('event.collisionEnter', this.contactFilter(handler.args), 0);
      case 'collision_exit':
        return this.addNode('event.collisionExit', this.contactFilter(handler.args), 0);
      case 'trigger_enter':
        return this.addNode('event.triggerEnter', this.contactFilter(handler.args), 0);
      case 'trigger_exit':
        return this.addNode('event.triggerExit', this.contactFilter(handler.args), 0);
      case 'interact':
        return this.addNode('event.interact', {}, 0);
      case 'receive_damage':
        return this.addNode('event.receiveDamage', {}, 0);
      case 'timer':
        return this.addNode('event.timer', { numberValue: Number(handler.args[0] ?? 1) || 1 }, 0);
      case 'land':
        return this.addNode('event.land', {}, 0);
      default:
        return this.addNode('event.custom', { eventName: sanitizeIdentifier(handler.eventName, 'CustomEvent') }, 0);
    }
  }

  private targetLiteral(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const value = unquote(raw) ?? raw.trim();
    if (value === 'self') return '$self';
    if (value === 'Player') return '$player';
    if (value === 'other') return '$trigger';
    if (value === 'cast_actor') return '$cast';
    return value;
  }

  /** Parse the optional `other: "object-id"` filter on collision/trigger handlers. */
  private contactFilter(args: string[]): Partial<NodeForgeNodeData> {
    for (const arg of args) {
      const match = arg.match(/^other\s*:\s*(.+)$/);
      const id = match ? unquote(match[1]) : undefined;
      if (id) return { otherObjectId: id };
    }
    return {};
  }

  private addNode(kind: GraphNodeKind, data: Partial<NodeForgeNodeData>, depth: number): NodeForgeNode {
    const category = categoryByKind(kind);
    const node: NodeForgeNode = {
      id: makeId('node'),
      type: 'nodeforge',
      position: { x: 80 + depth * 260, y: this.cursorY },
      data: makeNodeData(data.label ?? kind, category, { nodeKind: kind, ...data }),
      ...(kind === 'comment.note' ? { width: 340, height: 140, zIndex: -1 } : {}),
    };
    this.cursorY += 116;
    this.nodes.push(node);
    return node;
  }

  private exec(source: string, target: string, sourceHandle = 'exec-out') {
    this.edges.push({
      id: makeId('edge'),
      source,
      target,
      sourceHandle,
      targetHandle: 'exec-in',
      animated: true,
      type: 'smoothstep',
    });
  }

  private value(source: ValueRef, target: string, targetHandle: string) {
    this.edges.push({
      id: makeId('edge'),
      source: source.nodeId,
      target,
      sourceHandle: source.sourceHandle,
      targetHandle,
      type: 'smoothstep',
      style: { stroke: '#3DD0DC', strokeWidth: 2 },
    });
  }

  private comment(loc: FeatherExpression | FeatherStatement, message: string): CompiledChain {
    this.warning('loc' in loc ? loc.loc : loc, message);
    const node = this.addNode('comment.note', { message }, 1);
    return { first: node.id, exits: [out(node)] };
  }
}

const nextBlueprintVariables = (blueprint: ScriptBlueprint, declarations: FeatherVariableDeclaration[]): BlueprintVariable[] => {
  const existingByName = new Map((blueprint.variables ?? []).map((variable) => [sanitizeIdentifier(variable.name, variable.id), variable]));
  return declarations.map((declaration) => {
    const type = parseType(declaration.typeName, declaration.initializer ? inferLiteralType(declaration.initializer.raw) : 'number');
    const previous = existingByName.get(sanitizeIdentifier(declaration.name, 'value'));
    return {
      id: previous?.id ?? makeId('bpv'),
      name: declaration.name,
      type,
      defaultValue: parseLiteral(declaration.initializer?.raw) ?? previous?.defaultValue ?? (type === 'string' ? '' : type === 'boolean' ? false : type === 'vector3' ? [0, 0, 0] : 0),
    };
  });
};

export const compileFeatherScriptToGraph = (options: FeatherCompileOptions): FeatherCompileResult => {
  const parsed = parseFeatherScript(options.source);
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length) return { ok: false, diagnostics: parsed.diagnostics };

  const builder = new FeatherGraphBuilder(
    options.blueprint,
    options.variables,
    options.blueprints,
    parsed.program.functions.map((fn) => fn.name),
  );
  for (const handler of parsed.program.handlers) builder.compileHandler(handler);
  for (const fn of parsed.program.functions) builder.compileFunction(fn);
  if (parsed.program.detached) builder.compileDetached(parsed.program.detached.body);

  const diagnostics = [...parsed.diagnostics, ...builder.diagnosticsList()];
  if (diagnostics.some(isBlockingFeatherWarning)) {
    return { ok: false, diagnostics };
  }

  const nextBlueprint: ScriptBlueprint = {
    ...options.blueprint,
    name: parsed.program.blueprint?.name ? parsed.program.blueprint.name.replace(/_/g, ' ') : options.blueprint.name,
    variables: nextBlueprintVariables(options.blueprint, parsed.program.variables),
    featherSource: options.preserveSource ? options.source : undefined,
  };
  const graph = builder.graph(`${nextBlueprint.name} Graph`, options.graph.id);

  return {
    ok: true,
    diagnostics,
    graph,
    blueprint: nextBlueprint,
  };
};
