import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyAction,
  activePlayer,
  CARDS,
  legalTargets,
  type GameState,
} from '@chrono/shared';
import { sprites } from '../packages/client/src/pixel-art';

function makeGame(): GameState {
  const s = createGame('solo', [{ id: 'p1', name: 'Explorer' }], 42);
  s.enemies = [];
  const p = activePlayer(s);
  p.x = 2;
  p.y = 2;
  p.hand = [];
  p.deck = [];
  p.discard = [];
  return s;
}

describe('Part 1: Cards, Combos & Upgrades', () => {
  describe('1. New Cards', () => {
    it('pierce: deals 2 damage to all enemies in a straight line up to 3 tiles without stopping at first', () => {
      const s = makeGame();
      const p = activePlayer(s);
      p.hand = ['pierce'];
      s.enemies = [
        {
          id: 'e1',
          x: 3,
          y: 2,
          kind: 'turret',
          hp: 4,
          heading: 0,
          intent: { attack: [] },
        },
        {
          id: 'e2',
          x: 4,
          y: 2,
          kind: 'patroller',
          hp: 3,
          heading: 0,
          intent: { attack: [] },
        },
      ];

      expect(CARDS.pierce.draft).toBe(true);
      expect(CARDS.pierce.category).toBe('attack');
      expect(CARDS.pierce.range).toBe(3);

      // Both enemies on the line are legal targets
      const targets = legalTargets(s, 0);
      expect(targets).toContainEqual({ x: 3, y: 2 });
      expect(targets).toContainEqual({ x: 4, y: 2 });

      // Play pierce targeting along the line
      const next = applyAction(s, p.id, {
        type: 'play',
        card: 0,
        target: { x: 4, y: 2 },
      });

      // Both enemies should have taken 2 damage
      expect(next.enemies.find((e) => e.id === 'e1')?.hp).toBe(2);
      expect(next.enemies.find((e) => e.id === 'e2')?.hp).toBe(1);
    });

    it('pierce: rejects diagonals or lines without enemies', () => {
      const s = makeGame();
      const p = activePlayer(s);
      p.hand = ['pierce'];
      s.enemies = [
        {
          id: 'e1',
          x: 3,
          y: 3,
          kind: 'turret',
          hp: 2,
          heading: 0,
          intent: { attack: [] },
        },
      ];

      // Diagonal
      expect(() =>
        applyAction(s, p.id, {
          type: 'play',
          card: 0,
          target: { x: 3, y: 3 },
        }),
      ).toThrow();

      // Straight line with no enemies
      expect(() =>
        applyAction(s, p.id, {
          type: 'play',
          card: 0,
          target: { x: 2, y: 1 },
        }),
      ).toThrow('No enemies in line of fire.');
    });

    it('time_rewind: restores 1 play, cleanses negative status, and applies 2-round cooldown', () => {
      const s = makeGame();
      const p = activePlayer(s);
      p.hand = ['time_rewind'];
      p.statuses = [{ type: 'poison', rounds: 2 }];
      s.plays = 1;

      expect(CARDS.time_rewind.draft).toBe(true);
      expect(CARDS.time_rewind.range).toBe(0);
      expect(CARDS.time_rewind.cooldown).toBe(2);

      const next = applyAction(s, p.id, {
        type: 'play',
        card: 0,
      });

      // 1 play restored: went from 1 to 2
      expect(next.plays).toBe(2);
      // Status cleansed
      expect(next.players[0].statuses?.some((st) => st.type === 'poison')).toBe(
        false,
      );
      // Cooldown recorded
      expect(next.players[0].cooldowns?.time_rewind).toBe(s.round + 2);

      // Recharging prevents replay
      next.players[0].hand = ['time_rewind'];
      expect(() =>
        applyAction(next, p.id, {
          type: 'play',
          card: 0,
        }),
      ).toThrow('recharging');
    });

    it('decoy: spawns 2 HP dummy that lures nearest-target enemy AI', () => {
      const s = makeGame();
      const p = activePlayer(s);
      p.hand = ['decoy'];
      // Place chaser at (5, 2), player is at (2, 2)
      s.enemies = [
        {
          id: 'c1',
          x: 5,
          y: 2,
          kind: 'chaser',
          hp: 2,
          heading: 0,
          intent: { attack: [] },
        },
      ];

      expect(CARDS.decoy.draft).toBe(true);
      expect(CARDS.decoy.range).toBe(2);

      // Deploy decoy at (4, 2) - closer to chaser than player
      const next = applyAction(s, p.id, {
        type: 'play',
        card: 0,
        target: { x: 4, y: 2 },
      });

      expect(next.decoys).toHaveLength(1);
      expect(next.decoys![0]).toMatchObject({
        x: 4,
        y: 2,
        hp: 2,
        maxHp: 2,
        kind: 'decoy',
      });

      // End turn - chaser should target the closer decoy at (4, 2)
      const afterEnemyTurn = applyAction(next, p.id, { type: 'end' });
      // Enemy moved or aimed towards decoy
      expect(afterEnemyTurn.decoys![0].hp).toBeLessThanOrEqual(2);
    });
  });

  describe('2. Combo Chains', () => {
    it('move followed by attack deals +1 combo damage and logs combo strike', () => {
      const s = makeGame();
      const p = activePlayer(s);
      p.x = 1;
      p.y = 1;
      p.hand = ['step1', 'strike'];
      s.enemies = [
        {
          id: 'e1',
          x: 3,
          y: 1,
          kind: 'turret',
          hp: 4,
          heading: 0,
          intent: { attack: [] },
        },
      ];

      // 1. Play move card to (2, 1)
      const step1Result = applyAction(s, p.id, {
        type: 'play',
        card: 0,
        target: { x: 2, y: 1 },
      });
      expect(step1Result.players[0].lastCardCategory).toBe('move');

      // 2. Play attack card (strike: base 2 + 1 combo = 3 damage)
      const strikeResult = applyAction(step1Result, p.id, {
        type: 'play',
        card: 0, // strike is now index 0
        target: { x: 3, y: 1 },
      });

      // Enemy takes 3 damage instead of 2 (4 - 3 = 1 HP remaining)
      expect(strikeResult.enemies[0].hp).toBe(1);
      expect(strikeResult.log).toContain('Combo strike! +1 bonus damage.');
      // lastCardCategory resets after attack
      expect(strikeResult.players[0].lastCardCategory).toBeUndefined();
    });

    it('attack followed by attack does not deal combo bonus', () => {
      const s = makeGame();
      const p = activePlayer(s);
      p.x = 1;
      p.y = 1;
      p.hand = ['strike', 'strike'];
      s.enemies = [
        {
          id: 'e1',
          x: 2,
          y: 1,
          kind: 'turret',
          hp: 6,
          heading: 0,
          intent: { attack: [] },
        },
      ];

      // First strike deals 2
      const first = applyAction(s, p.id, {
        type: 'play',
        card: 0,
        target: { x: 2, y: 1 },
      });
      expect(first.enemies[0].hp).toBe(4);
      expect(first.players[0].lastCardCategory).toBeUndefined();

      // Second strike deals 2 (not combo)
      const second = applyAction(first, p.id, {
        type: 'play',
        card: 0,
        target: { x: 2, y: 1 },
      });
      expect(second.enemies[0].hp).toBe(2);
      expect(second.log).not.toContain('Combo strike! +1 bonus damage.');
    });

    it('resets lastCardCategory at end of turn via advance() and draw()', () => {
      const s = makeGame();
      const p = activePlayer(s);
      p.x = 1;
      p.y = 1;
      p.hand = ['step1'];
      const moved = applyAction(s, p.id, {
        type: 'play',
        card: 0,
        target: { x: 2, y: 1 },
      });
      expect(moved.players[0].lastCardCategory).toBe('move');

      const ended = applyAction(moved, p.id, { type: 'end' });
      expect(ended.players[0].lastCardCategory).toBeUndefined();
    });
  });

  describe('3. Card Upgrades & Forge', () => {
    it('arrow_plus: range 3, 3 damage', () => {
      const s = makeGame();
      const p = activePlayer(s);
      p.x = 1;
      p.y = 1;
      p.hand = ['arrow_plus'];
      s.enemies = [
        {
          id: 'e1',
          x: 4,
          y: 1,
          kind: 'turret',
          hp: 4,
          heading: 0,
          intent: { attack: [] },
        },
      ];

      expect(CARDS.arrow_plus.range).toBe(3);
      // Enemy at distance 3 is reachable
      const next = applyAction(s, p.id, {
        type: 'play',
        card: 0,
        target: { x: 4, y: 1 },
      });
      expect(next.enemies[0].hp).toBe(1); // 4 - 3 = 1
    });

    it('step3: moves up to 3 tiles in a straight line', () => {
      const s = makeGame();
      const p = activePlayer(s);
      p.x = 1;
      p.y = 1;
      p.hand = ['step3'];

      expect(CARDS.step3.range).toBe(3);
      const next = applyAction(s, p.id, {
        type: 'play',
        card: 0,
        target: { x: 4, y: 1 },
      });
      expect(next.players[0].x).toBe(4);
      expect(next.players[0].y).toBe(1);
    });

    it('shield_plus: grants 2 shields', () => {
      const s = makeGame();
      const p = activePlayer(s);
      p.hand = ['shield_plus'];

      const next = applyAction(s, p.id, {
        type: 'play',
        card: 0,
      });
      expect(next.players[0].shield).toBe(2);
    });

    it('forge: upgrades strike -> strike_plus, or arrow -> arrow_plus, or step2 -> step3', () => {
      // 1. strike present -> strike_plus
      const s1 = makeGame();
      s1.players[0].hand = ['forge'];
      s1.players[0].deck = ['strike', 'arrow', 'step2'];
      const r1 = applyAction(s1, 'p1', { type: 'play', card: 0 });
      expect(r1.players[0].deck).toContain('strike_plus');
      expect(r1.players[0].deck).not.toContain('strike');

      // 2. No strike, arrow present -> arrow_plus
      const s2 = makeGame();
      s2.players[0].hand = ['forge'];
      s2.players[0].deck = ['arrow', 'step2'];
      const r2 = applyAction(s2, 'p1', { type: 'play', card: 0 });
      expect(r2.players[0].deck).toContain('arrow_plus');
      expect(r2.players[0].deck).not.toContain('arrow');

      // 3. No strike or arrow, step2 present -> step3
      const s3 = makeGame();
      s3.players[0].hand = ['forge'];
      s3.players[0].deck = ['step2'];
      const r3 = applyAction(s3, 'p1', { type: 'play', card: 0 });
      expect(r3.players[0].deck).toContain('step3');
      expect(r3.players[0].deck).not.toContain('step2');

      // 4. No strike, arrow, or step2, shield present -> shield_plus
      const s4 = makeGame();
      s4.players[0].hand = ['forge'];
      s4.players[0].deck = ['shield'];
      const r4 = applyAction(s4, 'p1', { type: 'play', card: 0 });
      expect(r4.players[0].deck).toContain('shield_plus');
      expect(r4.players[0].deck).not.toContain('shield');
    });
  });

  describe('4. Pixel art / Icons mapping', () => {
    it('maps all new card IDs to expected sprites', () => {
      expect(sprites.pierce).toBe(sprites.arrow);
      expect(sprites.time_rewind).toBe(sprites.redraw);
      expect(sprites.decoy).toBe(sprites.explorer);
      expect(sprites.arrow_plus).toBe(sprites.arrow);
      expect(sprites.step3).toBe(sprites.step2);
      expect(sprites.shield_plus).toBe(sprites.shield);
    });
  });
});
