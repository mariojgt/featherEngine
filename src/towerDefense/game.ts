export type TowerKind = 'seed' | 'frost' | 'cannon';
export type EnemyKind = 'shambler' | 'runner' | 'brute';
export type GamePhase = 'build' | 'wave' | 'won' | 'lost';

export const GAME_TITLE = 'Sproutwatch';

export interface Point {
  x: number;
  z: number;
}

export interface BuildPlot extends Point {
  id: number;
}

export interface Decoration extends Point {
  kind: 'flower' | 'mushroom' | 'rock';
  rotation: number;
  scale: number;
}

export interface GeneratedMap {
  seed: number;
  path: Point[];
  plots: BuildPlot[];
  decorations: Decoration[];
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  /** Distance travelled along the route, in world units. */
  progress: number;
  /** Simulation time at which the frost slow expires. */
  slowUntil: number;
}

export interface Tower {
  plotId: number;
  kind: TowerKind;
  level: number;
  x: number;
  z: number;
  cooldown: number;
  targetAngle: number;
  invested: number;
}

export interface Shot {
  id: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  kind: TowerKind;
  life: number;
}

export interface Effect {
  id: number;
  x: number;
  z: number;
  kind: 'hit' | 'kill' | 'leak' | 'build';
  life: number;
}

export interface TowerDefinition {
  name: string;
  role: string;
  cost: number;
  maxLevel: 3;
  upgradeCosts: readonly [number, number];
  damage: number;
  range: number;
  fireInterval: number;
  splashRadius: number;
  slowFactor: number;
  slowDuration: number;
}

export interface TowerStats {
  kind: TowerKind;
  level: number;
  damage: number;
  range: number;
  fireInterval: number;
  splashRadius: number;
  slowFactor: number;
  slowDuration: number;
}

export interface Game {
  map: GeneratedMap;
  coins: number;
  lives: number;
  wave: number;
  totalWaves: 10;
  phase: GamePhase;
  enemies: Enemy[];
  towers: Tower[];
  shots: Shot[];
  effects: Effect[];
  kills: number;
  elapsed: number;
  /** Enemies in the current wave that have not entered the map yet. */
  spawnRemaining: number;
  /** Internal fixed-step remainder. Kept public so the state is serializable. */
  simulationRemainder: number;
  nextSpawnIn: number;
  spawnIndex: number;
  nextEntityId: number;
}

export const TOWER_DEFS: Readonly<Record<TowerKind, TowerDefinition>> = {
  seed: {
    name: 'Pea Sprout',
    role: 'Rapid single-target damage',
    cost: 80,
    maxLevel: 3,
    upgradeCosts: [65, 105],
    damage: 10,
    range: 4.5,
    fireInterval: 0.32,
    splashRadius: 0,
    slowFactor: 1,
    slowDuration: 0,
  },
  frost: {
    name: 'Snowdrop',
    role: 'Control and persistent slowing',
    cost: 105,
    maxLevel: 3,
    upgradeCosts: [80, 120],
    damage: 7,
    range: 4.25,
    fireInterval: 0.72,
    splashRadius: 0,
    slowFactor: 0.48,
    slowDuration: 1.7,
  },
  cannon: {
    name: 'Pumpkin Mortar',
    role: 'Slow area damage',
    cost: 145,
    maxLevel: 3,
    upgradeCosts: [105, 150],
    damage: 34,
    range: 5.25,
    fireInterval: 1.55,
    splashRadius: 1.75,
    slowFactor: 1,
    slowDuration: 0,
  },
};

const FIXED_STEP = 1 / 30;
const MAX_STEP_SECONDS = 300;
const LEVEL_DAMAGE = [1, 1.62, 2.38] as const;
const LEVEL_RANGE = [1, 1.08, 1.16] as const;
const LEVEL_RATE = [1, 0.88, 0.76] as const;

interface EnemyDefinition {
  hp: number;
  speed: number;
  bounty: number;
  lifeDamage: number;
}

const ENEMY_DEFS: Readonly<Record<EnemyKind, EnemyDefinition>> = {
  shambler: { hp: 52, speed: 0.92, bounty: 10, lifeDamage: 2 },
  runner: { hp: 34, speed: 1.62, bounty: 11, lifeDamage: 1 },
  brute: { hp: 150, speed: 0.6, bounty: 22, lifeDamage: 3 },
};

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedQuarter(value: number): number {
  return Math.round(value * 4) / 4;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

function distanceToPath(point: Point, path: readonly Point[]): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, path[index - 1], path[index]));
  }
  return distance;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function generateMap(seed: number): GeneratedMap {
  const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
  const random = makeRandom(normalizedSeed);
  const path: Point[] = [];
  let currentZ = Math.floor(random() * 7) - 3;
  path.push({ x: -12, z: currentZ });

  const bendCount = 4 + Math.floor(random() * 2);
  for (let bend = 0; bend < bendCount; bend += 1) {
    const baseX = -6 + (14 * bend) / Math.max(1, bendCount - 1);
    const x = roundedQuarter(baseX + (random() - 0.5) * 1.25);
    path.push({ x, z: currentZ });

    let nextZ = Math.floor(random() * 13) - 6;
    if (Math.abs(nextZ - currentZ) < 3) {
      nextZ = currentZ <= 0 ? Math.min(6, currentZ + 3 + Math.floor(random() * 3)) : Math.max(-6, currentZ - 3 - Math.floor(random() * 3));
    }
    path.push({ x, z: nextZ });
    currentZ = nextZ;
  }
  path.push({ x: 12, z: currentZ });

  const desiredPlots = 10 + Math.floor(random() * 7);
  const candidates: Point[] = [];
  for (let x = -10.5; x <= 10.5; x += 1.5) {
    for (let z = -7; z <= 7; z += 1.5) {
      const point = { x: roundedQuarter(x + (random() - 0.5) * 0.35), z: roundedQuarter(z + (random() - 0.5) * 0.35) };
      const routeDistance = distanceToPath(point, path);
      if (routeDistance >= 1.65 && routeDistance <= 4.1) candidates.push(point);
    }
  }

  const plots: BuildPlot[] = [];
  const orderedCandidates = shuffled(candidates, random);
  for (const candidate of orderedCandidates) {
    if (plots.every((plot) => Math.hypot(plot.x - candidate.x, plot.z - candidate.z) >= 2.15)) {
      plots.push({ id: plots.length + 1, ...candidate });
      if (plots.length === desiredPlots) break;
    }
  }
  // The dense candidate grid normally satisfies the wider spacing. The fallback guarantees the
  // advertised pad count for every 32-bit seed while still keeping pads visually distinct.
  if (plots.length < desiredPlots) {
    for (const candidate of orderedCandidates) {
      if (plots.every((plot) => Math.hypot(plot.x - candidate.x, plot.z - candidate.z) >= 1.35)) {
        plots.push({ id: plots.length + 1, ...candidate });
        if (plots.length === desiredPlots) break;
      }
    }
  }

  const decorations: Decoration[] = [];
  const decorationKinds: Decoration['kind'][] = ['flower', 'mushroom', 'rock'];
  for (let index = 0; index < 22; index += 1) {
    const point = { x: roundedQuarter(-11 + random() * 22), z: roundedQuarter(-7 + random() * 14) };
    if (distanceToPath(point, path) < 1.2 || plots.some((plot) => Math.hypot(plot.x - point.x, plot.z - point.z) < 1.1)) continue;
    decorations.push({
      ...point,
      kind: decorationKinds[Math.floor(random() * decorationKinds.length)],
      rotation: random() * Math.PI * 2,
      scale: 0.75 + random() * 0.55,
    });
  }

  return { seed: normalizedSeed, path, plots, decorations };
}

export function towerStats(kind: TowerKind, level: number): TowerStats {
  if (!Number.isInteger(level) || level < 1 || level > TOWER_DEFS[kind].maxLevel) {
    throw new RangeError(`Tower level must be an integer from 1 to ${TOWER_DEFS[kind].maxLevel}.`);
  }
  const definition = TOWER_DEFS[kind];
  const levelIndex = level - 1;
  return {
    kind,
    level,
    damage: definition.damage * LEVEL_DAMAGE[levelIndex],
    range: definition.range * LEVEL_RANGE[levelIndex],
    fireInterval: definition.fireInterval * LEVEL_RATE[levelIndex],
    splashRadius: definition.splashRadius === 0 ? 0 : definition.splashRadius + levelIndex * 0.2,
    slowFactor: definition.slowFactor,
    slowDuration: definition.slowDuration === 0 ? 0 : definition.slowDuration + levelIndex * 0.35,
  };
}

export function createGame(seed: number): Game {
  return {
    map: generateMap(seed),
    coins: 260,
    lives: 20,
    wave: 0,
    totalWaves: 10,
    phase: 'build',
    enemies: [],
    towers: [],
    shots: [],
    effects: [],
    kills: 0,
    elapsed: 0,
    spawnRemaining: 0,
    simulationRemainder: 0,
    nextSpawnIn: 0,
    spawnIndex: 0,
    nextEntityId: 1,
  };
}

function waveSize(wave: number): number {
  return 6 + wave * 2;
}

function spawnInterval(wave: number): number {
  return Math.max(0.48, 0.9 - wave * 0.035);
}

function waveBonus(wave: number): number {
  return 24 + wave * 6;
}

export function startWave(game: Game): boolean {
  if (game.phase !== 'build' || game.wave >= game.totalWaves || game.enemies.length > 0) return false;
  game.wave += 1;
  game.phase = 'wave';
  game.spawnRemaining = waveSize(game.wave);
  game.spawnIndex = 0;
  game.nextSpawnIn = 0.2;
  return true;
}

export function placeTower(game: Game, plotId: number, kind: TowerKind): boolean {
  if (game.phase !== 'build' || !Object.prototype.hasOwnProperty.call(TOWER_DEFS, kind)) return false;
  const plot = game.map.plots.find((candidate) => candidate.id === plotId);
  const definition = TOWER_DEFS[kind];
  if (!plot || game.coins < definition.cost || game.towers.some((tower) => tower.plotId === plotId)) return false;
  game.coins -= definition.cost;
  game.towers.push({
    plotId,
    kind,
    level: 1,
    x: plot.x,
    z: plot.z,
    cooldown: 0,
    targetAngle: 0,
    invested: definition.cost,
  });
  game.effects.push({ id: game.nextEntityId++, x: plot.x, z: plot.z, kind: 'build', life: 0.65 });
  return true;
}

export function upgradeTower(game: Game, plotId: number): boolean {
  if (game.phase !== 'build') return false;
  const tower = game.towers.find((candidate) => candidate.plotId === plotId);
  if (!tower) return false;
  const definition = TOWER_DEFS[tower.kind];
  if (tower.level >= definition.maxLevel) return false;
  const cost = definition.upgradeCosts[tower.level - 1];
  if (game.coins < cost) return false;
  game.coins -= cost;
  tower.invested += cost;
  tower.level += 1;
  game.effects.push({ id: game.nextEntityId++, x: tower.x, z: tower.z, kind: 'build', life: 0.65 });
  return true;
}

export function sellTower(game: Game, plotId: number): boolean {
  if (game.phase !== 'build') return false;
  const index = game.towers.findIndex((tower) => tower.plotId === plotId);
  if (index < 0) return false;
  const [tower] = game.towers.splice(index, 1);
  game.coins += Math.floor(tower.invested * 0.7);
  return true;
}

function routeLength(path: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += Math.hypot(path[index].x - path[index - 1].x, path[index].z - path[index - 1].z);
  }
  return total;
}

function pointAtDistance(path: readonly Point[], distance: number): Point {
  let remaining = Math.max(0, distance);
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const segmentLength = Math.hypot(end.x - start.x, end.z - start.z);
    if (remaining <= segmentLength) {
      const t = segmentLength === 0 ? 0 : remaining / segmentLength;
      return { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t };
    }
    remaining -= segmentLength;
  }
  return { ...path[path.length - 1] };
}

function enemyKindFor(game: Game, index: number): EnemyKind {
  const roll = ((game.map.seed ^ Math.imul(game.wave + 17, 0x9e3779b1) ^ Math.imul(index + 31, 0x85ebca6b)) >>> 0) % 100;
  if (game.wave >= 3 && roll < Math.min(13 + game.wave * 2, 32)) return 'brute';
  if (game.wave >= 2 && roll < Math.min(42 + game.wave * 2, 62)) return 'runner';
  return 'shambler';
}

function spawnEnemy(game: Game): void {
  const kind = enemyKindFor(game, game.spawnIndex);
  const definition = ENEMY_DEFS[kind];
  const healthScale = 1 + (game.wave - 1) * 0.2;
  const hp = Math.round(definition.hp * healthScale);
  const start = game.map.path[0];
  game.enemies.push({
    id: game.nextEntityId++,
    kind,
    x: start.x,
    z: start.z,
    hp,
    maxHp: hp,
    progress: 0,
    slowUntil: 0,
  });
  game.spawnIndex += 1;
  game.spawnRemaining -= 1;
}

function expireVisuals(game: Game, dt: number): void {
  for (const shot of game.shots) shot.life -= dt;
  for (const effect of game.effects) effect.life -= dt;
  game.shots = game.shots.filter((shot) => shot.life > 0);
  game.effects = game.effects.filter((effect) => effect.life > 0);
}

function applyDamage(game: Game, enemy: Enemy, damage: number): void {
  if (enemy.hp <= 0) return;
  enemy.hp -= damage;
  game.effects.push({ id: game.nextEntityId++, x: enemy.x, z: enemy.z, kind: 'hit', life: 0.28 });
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    game.kills += 1;
    game.coins += ENEMY_DEFS[enemy.kind].bounty;
    game.effects.push({ id: game.nextEntityId++, x: enemy.x, z: enemy.z, kind: 'kill', life: 0.75 });
  }
}

function updateWave(game: Game, dt: number): void {
  game.nextSpawnIn -= dt;
  while (game.spawnRemaining > 0 && game.nextSpawnIn <= 0) {
    spawnEnemy(game);
    game.nextSpawnIn += spawnInterval(game.wave);
  }

  const fullRouteLength = routeLength(game.map.path);
  for (const enemy of game.enemies) {
    if (enemy.hp <= 0) continue;
    const slowMultiplier = enemy.slowUntil > game.elapsed ? TOWER_DEFS.frost.slowFactor : 1;
    enemy.progress += ENEMY_DEFS[enemy.kind].speed * slowMultiplier * dt;
    const position = pointAtDistance(game.map.path, enemy.progress);
    enemy.x = position.x;
    enemy.z = position.z;
    if (enemy.progress >= fullRouteLength) {
      enemy.hp = 0;
      game.lives = Math.max(0, game.lives - ENEMY_DEFS[enemy.kind].lifeDamage);
      game.effects.push({ id: game.nextEntityId++, x: enemy.x, z: enemy.z, kind: 'leak', life: 0.85 });
    }
  }

  if (game.lives <= 0) {
    game.phase = 'lost';
    game.spawnRemaining = 0;
    game.enemies = [];
    return;
  }

  for (const tower of game.towers) {
    tower.cooldown = Math.max(0, tower.cooldown - dt);
    if (tower.cooldown > 0) continue;
    const stats = towerStats(tower.kind, tower.level);
    let target: Enemy | undefined;
    for (const enemy of game.enemies) {
      if (enemy.hp <= 0 || Math.hypot(enemy.x - tower.x, enemy.z - tower.z) > stats.range) continue;
      if (!target || enemy.progress > target.progress || (enemy.progress === target.progress && enemy.id < target.id)) target = enemy;
    }
    if (!target) continue;

    tower.targetAngle = Math.atan2(target.x - tower.x, target.z - tower.z);
    tower.cooldown = stats.fireInterval;
    game.shots.push({
      id: game.nextEntityId++,
      x: tower.x,
      z: tower.z,
      tx: target.x,
      tz: target.z,
      kind: tower.kind,
      life: tower.kind === 'cannon' ? 0.3 : 0.16,
    });

    if (tower.kind === 'cannon') {
      const targets = game.enemies.filter((enemy) => enemy.hp > 0 && Math.hypot(enemy.x - target.x, enemy.z - target.z) <= stats.splashRadius);
      for (const enemy of targets) applyDamage(game, enemy, stats.damage);
    } else {
      applyDamage(game, target, stats.damage);
      if (tower.kind === 'frost' && target.hp > 0) target.slowUntil = Math.max(target.slowUntil, game.elapsed + stats.slowDuration);
    }
  }

  game.enemies = game.enemies.filter((enemy) => enemy.hp > 0);
  if (game.spawnRemaining === 0 && game.enemies.length === 0) {
    game.coins += waveBonus(game.wave);
    game.phase = game.wave >= game.totalWaves ? 'won' : 'build';
  }
}

function fixedUpdate(game: Game, dt: number): void {
  game.elapsed += dt;
  expireVisuals(game, dt);
  if (game.phase === 'wave') updateWave(game, dt);
}

export function stepGame(game: Game, dtSeconds: number): void {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
  game.simulationRemainder += Math.min(dtSeconds, MAX_STEP_SECONDS);
  while (game.simulationRemainder + 1e-10 >= FIXED_STEP) {
    fixedUpdate(game, FIXED_STEP);
    game.simulationRemainder -= FIXED_STEP;
  }
  if (Math.abs(game.simulationRemainder) < 1e-10) game.simulationRemainder = 0;
}
