import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyAction,
  tileAt,
  distance,
  same,
  ENEMIES,
  LEVELS,
  getSmartTarget,
  planHealer,
  planShieldBearer,
  planTeleporter,
  planSummoner,
  planBomberAim,
  type GameState,
  type Enemy,
  type Player,
} from '@chrono/shared';

function createTestGame(): GameState {
  const s = createGame('duo', [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
  ]);
  s.enemies = [];
  return s;
}

describe('New Enemy Definitions in enemies.json', () => {
  it('healer has correct stats and description', () => {
    const healer = ENEMIES.healer;
    expect(healer).toBeDefined();
    expect(healer.hp).toBe(3);
    expect(healer.damage).toBe(0);
    expect(healer.threat).toBe(2);
    expect(healer.description).toContain(
      'Heals 1 HP to the lowest-HP wounded enemy within 3 tiles',
    );
  });

  it('shield_bearer has correct stats and description', () => {
    const shieldBearer = ENEMIES.shield_bearer;
    expect(shieldBearer).toBeDefined();
    expect(shieldBearer.hp).toBe(4);
    expect(shieldBearer.damage).toBe(1);
    expect(shieldBearer.threat).toBe(2);
    expect(shieldBearer.description).toContain(
      'Grants 1 shield to adjacent allies',
    );
  });

  it('teleporter has correct stats and description', () => {
    const teleporter = ENEMIES.teleporter;
    expect(teleporter).toBeDefined();
    expect(teleporter.hp).toBe(3);
    expect(teleporter.damage).toBe(2);
    expect(teleporter.threat).toBe(3);
    expect(teleporter.description).toContain(
      'Blinks to a random empty floor tile every 2 rounds',
    );
  });

  it('summoner has correct stats and description', () => {
    const summoner = ENEMIES.summoner;
    expect(summoner).toBeDefined();
    expect(summoner.hp).toBe(3);
    expect(summoner.damage).toBe(0);
    expect(summoner.threat).toBe(3);
    expect(summoner.description).toContain(
      "summons a 1 HP Minion ('seeker' / 'chaser') on an adjacent tile",
    );
  });
});

describe('getSmartTarget', () => {
  it('prioritizes low HP player (<= 4 HP) over a closer player with higher HP', () => {
    const p1: Player = {
      id: 'p1',
      name: 'Alice',
      x: 2,
      y: 1,
      hp: 10,
      maxHp: 12,
      shield: 0,
      hand: [],
      deck: [],
      discard: [],
      bonus: 0,
    };
    const p2: Player = {
      id: 'p2',
      name: 'Bob',
      x: 5,
      y: 1,
      hp: 3,
      maxHp: 12,
      shield: 0,
      hand: [],
      deck: [],
      discard: [],
      bonus: 0,
    };
    const enemy: Enemy = {
      id: 'e1',
      kind: 'chaser',
      x: 1,
      y: 1,
      hp: 2,
      heading: 0,
      intent: { attack: [] },
    };

    const target = getSmartTarget([p1, p2], enemy);
    expect(target).toBeDefined();
    expect(target?.id).toBe('p2');
    expect(target?.target.id).toBe('p2');
    expect(target?.retreat).toBe(false);
  });

  it('selects the lowest HP when multiple players have <= 4 HP', () => {
    const p1: Player = {
      id: 'p1',
      name: 'Alice',
      x: 3,
      y: 1,
      hp: 4,
      maxHp: 12,
      shield: 0,
      hand: [],
      deck: [],
      discard: [],
      bonus: 0,
    };
    const p2: Player = {
      id: 'p2',
      name: 'Bob',
      x: 5,
      y: 1,
      hp: 2,
      maxHp: 12,
      shield: 0,
      hand: [],
      deck: [],
      discard: [],
      bonus: 0,
    };
    const enemy: Enemy = {
      id: 'e1',
      kind: 'chaser',
      x: 1,
      y: 1,
      hp: 2,
      heading: 0,
      intent: { attack: [] },
    };

    const target = getSmartTarget([p1, p2], enemy);
    expect(target?.id).toBe('p2');
  });

  it('falls back to nearest player when all players have > 4 HP', () => {
    const p1: Player = {
      id: 'p1',
      name: 'Alice',
      x: 2,
      y: 1,
      hp: 8,
      maxHp: 12,
      shield: 0,
      hand: [],
      deck: [],
      discard: [],
      bonus: 0,
    };
    const p2: Player = {
      id: 'p2',
      name: 'Bob',
      x: 6,
      y: 1,
      hp: 6,
      maxHp: 12,
      shield: 0,
      hand: [],
      deck: [],
      discard: [],
      bonus: 0,
    };
    const enemy: Enemy = {
      id: 'e1',
      kind: 'chaser',
      x: 1,
      y: 1,
      hp: 2,
      heading: 0,
      intent: { attack: [] },
    };

    const target = getSmartTarget([p1, p2], enemy);
    expect(target?.id).toBe('p1');
  });

  it('triggers retreat when enemy has HP === 1 and damage === 0, stepping away from player', () => {
    const player: Player = {
      id: 'p1',
      name: 'Alice',
      x: 3,
      y: 3,
      hp: 10,
      maxHp: 12,
      shield: 0,
      hand: [],
      deck: [],
      discard: [],
      bonus: 0,
    };
    const healer: Enemy = {
      id: 'h1',
      kind: 'healer',
      x: 3,
      y: 4,
      hp: 1,
      heading: 0,
      intent: { attack: [] },
    };

    const result = getSmartTarget([player], healer);
    expect(result?.retreat).toBe(true);
    // Candidates should step away from player at (3, 3)
    const bestMove = result?.candidates[0];
    expect(bestMove).toBeDefined();
    // Distance from bestMove to player (3,3) should be >= original distance (1)
    expect(distance(bestMove!, player)).toBeGreaterThanOrEqual(1);
    expect(distance(bestMove!, player)).toBeGreaterThan(
      distance({ x: 3, y: 3 }, player),
    );
  });

  it('calculates candidate positions to flank around the player when multiple enemies pursue', () => {
    const player: Player = {
      id: 'p1',
      name: 'Alice',
      x: 4,
      y: 4,
      hp: 10,
      maxHp: 12,
      shield: 0,
      hand: [],
      deck: [],
      discard: [],
      bonus: 0,
    };
    const enemy1: Enemy = {
      id: 'e1',
      kind: 'chaser',
      x: 4,
      y: 3, // Already occupying North flank position (4, 3)
      hp: 2,
      heading: 0,
      intent: { attack: [] },
    };
    const enemy2: Enemy = {
      id: 'e2',
      kind: 'chaser',
      x: 4,
      y: 6, // Approaching from South
      hp: 2,
      heading: 0,
      intent: { attack: [] },
    };

    const result = getSmartTarget([player], enemy2, [enemy1]);
    expect(result?.flankPositions).toBeDefined();
    expect(result?.flankPositions.length).toBe(4);
    // The occupied position (4, 3) should NOT be the first preferred flank
    expect(same(result!.flankPositions[0], { x: 4, y: 3 })).toBe(false);
  });
});

describe('planHealer', () => {
  it('heals the lowest-HP wounded enemy within 3 tiles and stays at range', () => {
    const s = createTestGame();
    s.players[0].x = 1;
    s.players[0].y = 1;

    const wounded1: Enemy = {
      id: 'w1',
      kind: 'chaser',
      x: 4,
      y: 4,
      hp: 1, // Max is 2
      heading: 0,
      intent: { attack: [] },
    };
    const wounded2: Enemy = {
      id: 'w2',
      kind: 'warden_elite',
      x: 5,
      y: 4,
      hp: 3, // Max is 4
      heading: 0,
      intent: { attack: [] },
    };
    const healer: Enemy = {
      id: 'h1',
      kind: 'healer',
      x: 4,
      y: 5,
      hp: 3,
      heading: 0,
      intent: { attack: [] },
    };
    s.enemies = [wounded1, wounded2, healer];

    const intent = planHealer(s, healer);
    expect(intent.attack).toEqual([]);
    expect(intent.heal).toEqual({ x: 4, y: 4 }); // Targets lowest-HP wounded enemy w1
  });

  it('retreats away from nearest player when HP === 1', () => {
    const s = createTestGame();
    s.players[0].x = 2;
    s.players[0].y = 2;

    const healer: Enemy = {
      id: 'h1',
      kind: 'healer',
      x: 3,
      y: 2,
      hp: 1,
      heading: 0,
      intent: { attack: [] },
    };
    s.enemies = [healer];

    const intent = planHealer(s, healer);
    expect(intent.move).toBeDefined();
    // Move should increase distance from player (2, 2)
    const prevDist = distance(healer, s.players[0]);
    const nextDist = distance(intent.move!, s.players[0]);
    expect(nextDist).toBeGreaterThan(prevDist);
  });
});

describe('planShieldBearer', () => {
  it('grants shield to adjacent allies and attacks adjacent tiles', () => {
    const s = createTestGame();
    s.players[0].x = 1;
    s.players[0].y = 1;

    const ally: Enemy = {
      id: 'a1',
      kind: 'chaser',
      x: 4,
      y: 3,
      hp: 2,
      heading: 0,
      intent: { attack: [] },
    };
    const shieldBearer: Enemy = {
      id: 'sb1',
      kind: 'shield_bearer',
      x: 4,
      y: 4,
      hp: 4,
      heading: 0,
      intent: { attack: [] },
    };
    s.enemies = [ally, shieldBearer];

    const intent = planShieldBearer(s, shieldBearer);
    expect(intent.shield).toContainEqual({ x: 4, y: 3 });
    expect(intent.attack.length).toBeGreaterThan(0);
  });

  it('shield protects allies from damage in game resolution', () => {
    const s = createGame('solo', [{ id: 'a', name: 'Alice' }]);
    s.players[0].x = 2;
    s.players[0].y = 1;
    s.players[0].hand = ['strike'];

    const ally: Enemy = {
      id: 'a1',
      kind: 'chaser',
      x: 3,
      y: 1,
      hp: 2,
      shield: 1, // Already shielded
      heading: 0,
      intent: { attack: [] },
    };
    s.enemies = [ally];

    // Strike the shielded enemy
    const nextState = applyAction(s, 'a', {
      type: 'play',
      card: 0,
      target: { x: 3, y: 1 },
    });

    expect(nextState.enemies).toHaveLength(1);
    expect(nextState.enemies[0].hp).toBe(2); // Shield absorbed the hit!
    expect(nextState.enemies[0].shield).toBe(0);
  });
});

describe('planTeleporter', () => {
  it('telegraphs a random floor blink destination and strikes adjacent tiles upon arrival', () => {
    const s = createTestGame();
    const teleporter: Enemy = {
      id: 't1',
      kind: 'teleporter',
      x: 3,
      y: 3,
      hp: 3,
      heading: 0,
      intent: { attack: [] },
    };
    s.enemies = [teleporter];

    const intent = planTeleporter(s, teleporter);
    expect(intent.charging).toBe(true);
    expect(intent.move).toBeDefined();
    expect(tileAt(s, intent.move!)).toBe('.');
    // Attack should surround arrival destination
    const arrival = intent.move!;
    expect(intent.attack).toContainEqual({ x: arrival.x + 1, y: arrival.y });
  });

  it('cycles charging off on round 2 to execute blink', () => {
    const s = createTestGame();
    const teleporter: Enemy = {
      id: 't1',
      kind: 'teleporter',
      x: 3,
      y: 3,
      hp: 3,
      heading: 0,
      intent: {
        attack: [{ x: 5, y: 6 }],
        move: { x: 5, y: 5 },
        charging: true,
      },
    };
    s.enemies = [teleporter];

    const intent = planTeleporter(s, teleporter);
    expect(intent.charging).toBe(false);
    expect(intent.move).toEqual({ x: 5, y: 5 });
  });
});

describe('planSummoner', () => {
  it('summons a minion on round multiple of 3 on an adjacent tile', () => {
    const s = createTestGame();
    s.round = 3;
    const summoner: Enemy = {
      id: 'sm1',
      kind: 'summoner',
      x: 4,
      y: 4,
      hp: 3,
      heading: 0,
      intent: { attack: [] },
    };
    s.enemies = [summoner];

    const intent = planSummoner(s, summoner);
    expect(intent.summon).toBeDefined();
    expect(distance(summoner, intent.summon!)).toBe(1);
    expect(tileAt(s, intent.summon!)).toBe('.');
  });

  it('spawns a 1 HP Seeker minion in enemyTurn when summon is executed', () => {
    const s = createGame('solo', [{ id: 'a', name: 'Alice' }]);
    s.round = 3;
    const summoner: Enemy = {
      id: 'sm1',
      kind: 'summoner',
      x: 4,
      y: 4,
      hp: 3,
      heading: 0,
      intent: {
        attack: [],
        summon: { x: 4, y: 5 },
      },
    };
    s.enemies = [summoner];
    s.players[0].hand = ['step1'];
    s.players[0].x = 1;
    s.players[0].y = 1;

    // End turn to trigger enemyTurn
    const nextState = applyAction(s, 'a', { type: 'end' });
    const minion = nextState.enemies.find((e) => e.kind === 'chaser');
    expect(minion).toBeDefined();
    expect(minion?.hp).toBe(1);
    expect(minion?.x).toBe(4);
    expect(minion?.y).toBe(5);
  });
});

describe('planBomberAim', () => {
  it('aims at tile between closest player and exit to cut off escape', () => {
    const s = createTestGame();
    s.players[0].x = 2;
    s.players[0].y = 2;

    const level = LEVELS[s.level];
    let exitPos = { x: 8, y: 8 };
    for (let y = 0; y < level.height; y++) {
      const x = level.tiles[y].indexOf('E');
      if (x !== -1) {
        exitPos = { x, y };
        break;
      }
    }

    const bomber: Enemy = {
      id: 'b1',
      kind: 'bomber',
      x: 5,
      y: 5,
      hp: 2,
      heading: 0,
      intent: { attack: [] },
    };
    s.enemies = [bomber];

    const aim = planBomberAim(s, bomber);
    expect(aim).toBeDefined();
    expect(bomber.intent.hazard).toBeDefined();
    expect(bomber.intent.hazard![0]).toEqual({ x: aim.x, y: aim.y });

    // The aim tile should be closer to exit than player is, or equal to player's position
    const playerDist = distance(s.players[0], exitPos);
    const aimDist = distance(aim, exitPos);
    expect(aimDist).toBeLessThanOrEqual(playerDist);
  });
});
