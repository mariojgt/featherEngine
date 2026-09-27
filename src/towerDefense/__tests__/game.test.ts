import { describe, expect, it } from 'vitest';
import {
  TOWER_DEFS,
  createGame,
  generateMap,
  placeTower,
  sellTower,
  startWave,
  stepGame,
  towerStats,
  upgradeTower,
  type Enemy,
  type Game,
  type Point,
  type TowerKind,
} from '../game';

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t));
}

function distanceToPath(point: Point, path: Point[]): number {
  return Math.min(...path.slice(1).map((end, index) => pointToSegmentDistance(point, path[index], end)));
}

function closestProgress(point: Point, path: Point[]): number {
  let traversed = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / (length * length)));
    const candidate = { x: start.x + dx * t, z: start.z + dz * t };
    const distance = Math.hypot(point.x - candidate.x, point.z - candidate.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestProgress = traversed + length * t;
    }
    traversed += length;
  }
  return bestProgress;
}

function routeLength(path: Point[]): number {
  return path.slice(1).reduce((length, point, index) => length + Math.hypot(point.x - path[index].x, point.z - path[index].z), 0);
}

function addDurableEnemy(game: Game, progress: number, id: number): Enemy {
  const enemy: Enemy = {
    id,
    kind: 'brute',
    x: game.map.path[0].x,
    z: game.map.path[0].z,
    hp: 1_000,
    maxHp: 1_000,
    progress,
    slowUntil: 0,
  };
  game.enemies.push(enemy);
  return enemy;
}

function combatFixture(kind: TowerKind): { game: Game; enemies: Enemy[] } {
  const game = createGame(73);
  const plot = game.map.plots[0];
  game.coins = 10_000;
  expect(placeTower(game, plot.id, kind)).toBe(true);
  game.phase = 'wave';
  game.wave = 1;
  game.spawnRemaining = 1;
  game.nextSpawnIn = 1_000;
  const progress = closestProgress(plot, game.map.path);
  const enemies = [addDurableEnemy(game, progress, 90_001), addDurableEnemy(game, progress + 0.2, 90_002)];
  stepGame(game, 1 / 30);
  return { game, enemies };
}

describe('Sproutwatch procedural map', () => {
  it('is reproducible, seed-sensitive, orthogonal, bounded, and buildable', () => {
    const map = generateMap(42);
    expect(generateMap(42)).toEqual(map);
    expect(generateMap(43).path).not.toEqual(map.path);
    expect(map.plots.length).toBeGreaterThanOrEqual(10);
    expect(map.plots.length).toBeLessThanOrEqual(16);
    expect(routeLength(map.path)).toBeGreaterThan(35);

    for (let index = 1; index < map.path.length; index += 1) {
      const start = map.path[index - 1];
      const end = map.path[index];
      expect(start.x === end.x || start.z === end.z).toBe(true);
      expect(start).not.toEqual(end);
    }
    for (const point of map.path) {
      expect(point.x).toBeGreaterThanOrEqual(-12);
      expect(point.x).toBeLessThanOrEqual(12);
      expect(point.z).toBeGreaterThanOrEqual(-8);
      expect(point.z).toBeLessThanOrEqual(8);
    }
    for (const plot of map.plots) {
      expect(distanceToPath(plot, map.path)).toBeGreaterThanOrEqual(1.6);
      expect(distanceToPath(plot, map.path)).toBeLessThanOrEqual(4.2);
    }
  });

  it('keeps its invariants across a wide seed sample', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const map = generateMap(seed);
      expect(map.plots.length).toBeGreaterThanOrEqual(10);
      expect(map.plots.length).toBeLessThanOrEqual(16);
      expect(map.path.every((point, index) => index === 0 || point.x === map.path[index - 1].x || point.z === map.path[index - 1].z)).toBe(true);
    }
  });
});

describe('Sproutwatch economy', () => {
  it('guards purchases, upgrades, caps, occupied plots, and refunds', () => {
    const game = createGame(7);
    const plotId = game.map.plots[0].id;
    expect(placeTower(game, plotId, 'seed')).toBe(true);
    expect(game.coins).toBe(260 - TOWER_DEFS.seed.cost);
    expect(placeTower(game, plotId, 'seed')).toBe(false);
    expect(placeTower(game, -1, 'seed')).toBe(false);

    game.coins = 0;
    expect(upgradeTower(game, plotId)).toBe(false);
    game.coins = 1_000;
    expect(upgradeTower(game, plotId)).toBe(true);
    expect(upgradeTower(game, plotId)).toBe(true);
    expect(upgradeTower(game, plotId)).toBe(false);
    const invested = game.towers[0].invested;
    const beforeSale = game.coins;
    expect(sellTower(game, plotId)).toBe(true);
    expect(game.coins).toBe(beforeSale + Math.floor(invested * 0.7));
    expect(sellTower(game, plotId)).toBe(false);
  });

  it('allows building only between waves and exposes scaling stats', () => {
    const game = createGame(3);
    expect(startWave(game)).toBe(true);
    expect(placeTower(game, game.map.plots[0].id, 'seed')).toBe(false);
    expect(upgradeTower(game, game.map.plots[0].id)).toBe(false);
    expect(sellTower(game, game.map.plots[0].id)).toBe(false);
    expect(towerStats('seed', 3).damage).toBeGreaterThan(towerStats('seed', 1).damage);
    expect(() => towerStats('seed', 4)).toThrow(RangeError);
  });
});

describe('Sproutwatch combat and waves', () => {
  it('gives seed, frost, and cannon distinct damage, slowing, and splash roles', () => {
    const seed = combatFixture('seed');
    expect(seed.enemies[0].hp + seed.enemies[1].hp).toBe(2_000 - TOWER_DEFS.seed.damage);
    expect(seed.enemies.filter((enemy) => enemy.hp < enemy.maxHp)).toHaveLength(1);

    const frost = combatFixture('frost');
    expect(frost.enemies.filter((enemy) => enemy.hp < enemy.maxHp)).toHaveLength(1);
    expect(frost.enemies.some((enemy) => enemy.slowUntil > frost.game.elapsed)).toBe(true);

    const cannon = combatFixture('cannon');
    expect(cannon.enemies[0].hp).toBeLessThan(cannon.enemies[0].maxHp);
    expect(cannon.enemies[1].hp).toBeLessThan(cannon.enemies[1].maxHp);
  });

  it('pays kills and wave bonuses, then returns to build mode', () => {
    const game = createGame(9);
    game.coins = 10_000;
    for (const plot of game.map.plots) placeTower(game, plot.id, 'cannon');
    const coinsBefore = game.coins;
    expect(startWave(game)).toBe(true);
    for (let seconds = 0; seconds < 180 && game.phase === 'wave'; seconds += 0.25) stepGame(game, 0.25);
    expect(game.phase).toBe('build');
    expect(game.kills).toBeGreaterThan(0);
    expect(game.coins).toBeGreaterThan(coinsBefore);
  });

  it('ends in loss when leaks exhaust the base', () => {
    const game = createGame(11);
    game.phase = 'wave';
    game.wave = 1;
    game.lives = 1;
    game.spawnRemaining = 0;
    const enemy = addDurableEnemy(game, routeLength(game.map.path) - 0.001, 88_001);
    enemy.kind = 'runner';
    stepGame(game, 1 / 30);
    expect(game.phase).toBe('lost');
    expect(game.lives).toBe(0);
  });

  it('wins only after the tenth wave is resolved', () => {
    const game = createGame(12);
    game.wave = 9;
    expect(startWave(game)).toBe(true);
    game.spawnRemaining = 0;
    game.enemies = [];
    stepGame(game, 1 / 30);
    expect(game.phase).toBe('won');
    expect(game.wave).toBe(10);
    expect(startWave(game)).toBe(false);
  });

  it('is stable when the same elapsed time arrives in different chunks', () => {
    const coarse = createGame(19);
    const fine = createGame(19);
    for (const game of [coarse, fine]) {
      placeTower(game, game.map.plots[0].id, 'seed');
      placeTower(game, game.map.plots[1].id, 'frost');
      startWave(game);
    }
    stepGame(coarse, 3);
    for (let index = 0; index < 300; index += 1) stepGame(fine, 0.01);

    const snapshot = (game: Game) => ({
      phase: game.phase,
      coins: game.coins,
      lives: game.lives,
      kills: game.kills,
      spawnRemaining: game.spawnRemaining,
      elapsed: Number(game.elapsed.toFixed(8)),
      enemies: game.enemies.map((enemy) => ({ id: enemy.id, hp: enemy.hp, progress: Number(enemy.progress.toFixed(8)), slowUntil: Number(enemy.slowUntil.toFixed(8)) })),
      towers: game.towers.map((tower) => ({ cooldown: Number(tower.cooldown.toFixed(8)), targetAngle: Number(tower.targetAngle.toFixed(8)) })),
    });
    expect(snapshot(fine)).toEqual(snapshot(coarse));
  });
});
