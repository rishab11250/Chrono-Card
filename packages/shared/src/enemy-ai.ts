import { DIRECTIONS, distance, same, tileAt, ENEMIES, LEVELS } from './engine';
import type { Enemy, EnemyIntent, GameState, Player, Position } from './types';

export interface SmartTargetResult {
  target: Player;
  player: Player;
  retreat: boolean;
  flankPositions: Position[];
  candidates: Position[];
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  shield: number;
  x: number;
  y: number;
}

export const livingAt = (s: GameState, p: Position): Player | undefined =>
  s.players.find((v) => v.hp > 0 && same(v, p));

export const enemyAt = (s: GameState, p: Position): Enemy | undefined =>
  s.enemies.find((v) => same(v, p));

export function nearestLiving(
  living: Player[],
  pos: Position,
): Player | undefined {
  if (!living.length) return undefined;
  return living.reduce((a, b) =>
    distance(pos, a) <= distance(pos, b) ? a : b,
  );
}

/**
 * getSmartTarget(livingPlayers, enemy, otherEnemies):
 * - If any player is low HP (<= 4 HP), prioritize that player.
 * - Flanking: if multiple enemies pursue the same player, calculate candidate positions around player to flank from different directions.
 * - Retreat: if an enemy has HP === 1 and damage === 0 (like healer or summoner), it steps AWAY from the nearest living player.
 */
export function getSmartTarget(
  livingPlayers: Player[],
  enemy: Enemy,
  otherEnemies: Enemy[] = [],
): (Player & SmartTargetResult) | undefined {
  if (!livingPlayers.length) return undefined;

  // 1. Low HP prioritization: If any player is low HP (<= 4 HP), prioritize that player.
  const lowHpPlayers = livingPlayers.filter((p) => p.hp <= 4);
  let target: Player;
  if (lowHpPlayers.length > 0) {
    target = lowHpPlayers.reduce((best, curr) => {
      if (curr.hp < best.hp) return curr;
      if (curr.hp > best.hp) return best;
      return distance(enemy, curr) < distance(enemy, best) ? curr : best;
    });
  } else {
    target = livingPlayers.reduce((best, curr) =>
      distance(enemy, curr) < distance(enemy, best) ? curr : best,
    );
  }

  // 2. Retreat check: HP === 1 and damage === 0
  const enemyDamage = ENEMIES[enemy.kind]?.damage ?? 0;
  const isZeroDamage = enemyDamage === 0;
  const shouldRetreat = enemy.hp === 1 && isZeroDamage;

  const nearestPlayer = livingPlayers.reduce((best, curr) =>
    distance(enemy, curr) < distance(enemy, best) ? curr : best,
  );

  const retreatCandidates = DIRECTIONS.map((d) => ({
    x: enemy.x + d.x,
    y: enemy.y + d.y,
  })).sort((a, b) => distance(b, nearestPlayer) - distance(a, nearestPlayer));

  // 3. Flanking: calculate candidate positions around player to flank from different directions.
  const flankPositions: Position[] = DIRECTIONS.map((d) => ({
    x: target.x + d.x,
    y: target.y + d.y,
  }));

  // If multiple enemies pursue the same target player, adjust preference of candidate flank positions
  const otherPursuers = otherEnemies.filter(
    (e) => e.id !== enemy.id && e.hp > 0,
  );

  const sortedFlankPositions = [...flankPositions].sort((posA, posB) => {
    const occupiedA = otherPursuers.some((e) => same(e, posA)) ? 1 : 0;
    const occupiedB = otherPursuers.some((e) => same(e, posB)) ? 1 : 0;
    if (occupiedA !== occupiedB) return occupiedA - occupiedB;
    return distance(enemy, posA) - distance(enemy, posB);
  });

  const preferredFlank = sortedFlankPositions[0] ?? target;
  const approachCandidates = DIRECTIONS.map((d) => ({
    x: enemy.x + d.x,
    y: enemy.y + d.y,
  })).sort((a, b) => distance(a, preferredFlank) - distance(b, preferredFlank));

  const result: Player & SmartTargetResult = Object.assign({}, target, {
    target,
    player: target,
    retreat: shouldRetreat,
    flankPositions: sortedFlankPositions,
    candidates: shouldRetreat ? retreatCandidates : approachCandidates,
  });

  return result;
}

/**
 * planHealer(state, healerEnemy):
 * - Stays at range.
 * - Heals 1 HP to the lowest-HP wounded enemy within 3 tiles each round.
 * - Retreat: if HP === 1 and damage === 0, steps AWAY from nearest living player.
 */
export function planHealer(state: GameState, healerEnemy: Enemy): EnemyIntent {
  const living = state.players.filter((p) => p.hp > 0);
  const nearestPlayer = living.length
    ? nearestLiving(living, healerEnemy)
    : undefined;

  // Wounded enemies within 3 tiles
  const wounded = state.enemies
    .filter(
      (e) =>
        e.hp > 0 && e.hp < ENEMIES[e.kind].hp && distance(healerEnemy, e) <= 3,
    )
    .sort((a, b) =>
      a.hp !== b.hp
        ? a.hp - b.hp
        : distance(healerEnemy, a) - distance(healerEnemy, b),
    );

  const healTarget = wounded[0]
    ? { x: wounded[0].x, y: wounded[0].y }
    : undefined;

  let move: Position | undefined;
  const isValid = (p: Position) =>
    tileAt(state, p) !== '#' && !enemyAt(state, p) && !livingAt(state, p);

  if (nearestPlayer) {
    const isCritical = healerEnemy.hp === 1;
    const isTooClose = distance(healerEnemy, nearestPlayer) < 3;

    if (isCritical || isTooClose) {
      // Step away from player to stay at range / retreat
      const candidates = DIRECTIONS.map((d) => ({
        x: healerEnemy.x + d.x,
        y: healerEnemy.y + d.y,
      }))
        .filter(isValid)
        .sort(
          (a, b) => distance(b, nearestPlayer) - distance(a, nearestPlayer),
        );
      move = candidates[0];
    } else {
      // If safe, can step towards distant wounded ally if any
      const distantWounded = state.enemies
        .filter(
          (e) =>
            e.hp > 0 &&
            e.hp < ENEMIES[e.kind].hp &&
            distance(healerEnemy, e) > 3,
        )
        .sort((a, b) => distance(healerEnemy, a) - distance(healerEnemy, b))[0];

      if (distantWounded) {
        const candidates = DIRECTIONS.map((d) => ({
          x: healerEnemy.x + d.x,
          y: healerEnemy.y + d.y,
        }))
          .filter(isValid)
          .filter((p) => distance(p, nearestPlayer) >= 3)
          .sort(
            (a, b) => distance(a, distantWounded) - distance(b, distantWounded),
          );
        move = candidates[0];
      }
    }
  }

  healerEnemy.intent = {
    attack: [],
    move,
    heal: healTarget,
  };
  return healerEnemy.intent;
}

/**
 * planShieldBearer(state, shieldEnemy):
 * - Heavy armored defender. Grants 1 shield to adjacent allies.
 * - Strikes adjacent tiles.
 */
export function planShieldBearer(
  state: GameState,
  shieldEnemy: Enemy,
): EnemyIntent {
  const living = state.players.filter((p) => p.hp > 0);
  const smart = living.length
    ? getSmartTarget(living, shieldEnemy, state.enemies)
    : undefined;
  const targetPlayer = smart?.target;

  // Adjacent attack
  const attack = DIRECTIONS.map((d) => ({
    x: shieldEnemy.x + d.x,
    y: shieldEnemy.y + d.y,
  })).filter((p) => tileAt(state, p) !== '#');

  // Adjacent allies getting shield
  const adjacentAllies = state.enemies.filter(
    (e) =>
      e.id !== shieldEnemy.id && e.hp > 0 && distance(shieldEnemy, e) === 1,
  );
  const shieldTargets = adjacentAllies.map((e) => ({ x: e.x, y: e.y }));

  // Move toward allies to defend them, or toward player
  const alliesNeedingSupport = state.enemies
    .filter(
      (e) =>
        e.id !== shieldEnemy.id && e.hp > 0 && distance(shieldEnemy, e) > 1,
    )
    .sort((a, b) => distance(shieldEnemy, a) - distance(shieldEnemy, b));

  const destination = alliesNeedingSupport[0] ?? targetPlayer;
  let move: Position | undefined;
  if (destination) {
    const candidates = DIRECTIONS.map((d) => ({
      x: shieldEnemy.x + d.x,
      y: shieldEnemy.y + d.y,
    }))
      .filter(
        (p) =>
          tileAt(state, p) !== '#' && !enemyAt(state, p) && !livingAt(state, p),
      )
      .sort((a, b) => distance(a, destination) - distance(b, destination));
    move = candidates[0];
  }

  shieldEnemy.intent = {
    attack,
    move,
    shield: shieldTargets,
  };
  return shieldEnemy.intent;
}

/**
 * planTeleporter(state, teleporterEnemy):
 * - Blinks to a random empty floor tile every 2 rounds, striking adjacent tiles on arrival.
 */
export function planTeleporter(
  state: GameState,
  teleporterEnemy: Enemy,
): EnemyIntent {
  if (teleporterEnemy.intent.charging) {
    teleporterEnemy.intent.charging = false;
    return teleporterEnemy.intent;
  }

  const level = LEVELS[state.level];
  const candidates: Position[] = [];
  if (level) {
    for (let y = 1; y < level.height - 1; y++) {
      for (let x = 1; x < level.width - 1; x++) {
        const pos = { x, y };
        if (
          tileAt(state, pos) === '.' &&
          !enemyAt(state, pos) &&
          !livingAt(state, pos)
        ) {
          candidates.push(pos);
        }
      }
    }
  }

  let targetTile: Position | undefined;
  if (candidates.length > 0) {
    const idx = Math.floor(Math.abs(state.rng ?? 42) % candidates.length);
    targetTile = candidates[idx] ?? candidates[0];
  }

  const attack = targetTile
    ? DIRECTIONS.map((d) => ({
        x: targetTile.x + d.x,
        y: targetTile.y + d.y,
      })).filter((p) => tileAt(state, p) !== '#')
    : [];

  teleporterEnemy.intent = {
    attack,
    move: targetTile,
    charging: true,
  };
  return teleporterEnemy.intent;
}

/**
 * planSummoner(state, summonerEnemy):
 * - Every 3 rounds, summons a 1 HP Minion ('seeker' / 'chaser') on an adjacent tile.
 * - Retreat: if HP === 1 and damage === 0, steps AWAY from nearest living player.
 */
export function planSummoner(
  state: GameState,
  summonerEnemy: Enemy,
): EnemyIntent {
  const living = state.players.filter((p) => p.hp > 0);
  const nearestPlayer = living.length
    ? nearestLiving(living, summonerEnemy)
    : undefined;

  const isSummonRound = state.round % 3 === 0;
  let summonPos: Position | undefined;

  if (isSummonRound) {
    const adjacent = DIRECTIONS.map((d) => ({
      x: summonerEnemy.x + d.x,
      y: summonerEnemy.y + d.y,
    }));
    summonPos = adjacent.find(
      (p) =>
        tileAt(state, p) !== '#' && !enemyAt(state, p) && !livingAt(state, p),
    );
  }

  let move: Position | undefined;
  const isValid = (p: Position) =>
    tileAt(state, p) !== '#' && !enemyAt(state, p) && !livingAt(state, p);

  if (nearestPlayer) {
    if (summonerEnemy.hp === 1) {
      // Retreat
      const candidates = DIRECTIONS.map((d) => ({
        x: summonerEnemy.x + d.x,
        y: summonerEnemy.y + d.y,
      }))
        .filter(isValid)
        .sort(
          (a, b) => distance(b, nearestPlayer) - distance(a, nearestPlayer),
        );
      move = candidates[0];
    } else if (!isSummonRound && distance(summonerEnemy, nearestPlayer) < 3) {
      // Step away to keep distance when not channeling summon
      const candidates = DIRECTIONS.map((d) => ({
        x: summonerEnemy.x + d.x,
        y: summonerEnemy.y + d.y,
      }))
        .filter(isValid)
        .sort(
          (a, b) => distance(b, nearestPlayer) - distance(a, nearestPlayer),
        );
      move = candidates[0];
    }
  }

  summonerEnemy.intent = {
    attack: [],
    move,
    summon: summonPos,
  };
  return summonerEnemy.intent;
}

/**
 * planBomberAim(state, bomberEnemy):
 * - Bomber aims at tile between closest player and the exit ('E') to cut off escape, or player's position.
 */
export function planBomberAim(state: GameState, bomberEnemy: Enemy): Position {
  const living = state.players.filter((p) => p.hp > 0);
  const nearest = living.length
    ? nearestLiving(living, bomberEnemy)
    : undefined;

  if (!nearest) {
    const fallback = { x: bomberEnemy.x, y: bomberEnemy.y };
    bomberEnemy.intent.hazard = [fallback];
    bomberEnemy.intent.attack = [];
    return fallback;
  }

  // Find the exit ('E') tile
  let exitPos: Position | undefined;
  const level = LEVELS[state.level];
  if (level) {
    for (let y = 0; y < level.height; y++) {
      const x = level.tiles[y].indexOf('E');
      if (x !== -1) {
        exitPos = { x, y };
        break;
      }
    }
  }

  let aimTile: Position = { x: nearest.x, y: nearest.y };

  if (exitPos && !same(nearest, exitPos)) {
    const dx = exitPos.x - nearest.x;
    const dy = exitPos.y - nearest.y;

    let candidateCutoff: Position;
    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
      candidateCutoff = { x: nearest.x + Math.sign(dx), y: nearest.y };
    } else if (dy !== 0) {
      candidateCutoff = { x: nearest.x, y: nearest.y + Math.sign(dy) };
    } else {
      candidateCutoff = { x: nearest.x, y: nearest.y };
    }

    const tileChar = level?.tiles[candidateCutoff.y]?.[candidateCutoff.x];
    if (tileChar === '.' || tileChar === '~') {
      aimTile = candidateCutoff;
    }
  }

  if (level?.tiles[aimTile.y]?.[aimTile.x] === 'E') {
    const alt = DIRECTIONS.map((d) => ({
      x: nearest.x + d.x,
      y: nearest.y + d.y,
    })).find(
      (p) =>
        level?.tiles[p.y]?.[p.x] === '.' || level?.tiles[p.y]?.[p.x] === '~',
    );
    if (alt) aimTile = alt;
  }

  const target = { x: aimTile.x, y: aimTile.y };
  bomberEnemy.intent.hazard = [target];
  bomberEnemy.intent.attack = [];

  return target;
}
