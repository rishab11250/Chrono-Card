import { describe, it, expect } from 'vitest';
import {
  EVENT_DEFINITIONS,
  MUTATORS,
  calculateScore,
  handleBreakableWall,
  applyEventEffect,
  applyFogRange,
  getHazardDamage,
  getStartingPlays,
  createGame,
  applyAction,
  tileAt,
} from '@chrono/shared';

describe('World & Progression Features', () => {
  describe('Score Multiplier & calculateScore', () => {
    it('calculates score accurately using the baseScore formula', () => {
      // baseScore = (roomsCleared * 1000) - (turns * 10) + (noDamageRooms * 250) + (relicsCount * 100)
      const score = calculateScore(null, {
        roomsCleared: 3,
        turns: 15,
        noDamageRooms: 1,
        relicsCount: 2,
      });
      // (3 * 1000) - (15 * 10) + (1 * 250) + (2 * 100) = 3000 - 150 + 250 + 200 = 3300
      expect(score).toBe(3300);
    });

    it('applies score multiplier when provided', () => {
      const base = calculateScore(null, {
        roomsCleared: 4,
        turns: 20,
        noDamageRooms: 2,
        relicsCount: 1,
      });
      // (4 * 1000) - (20 * 10) + (2 * 250) + (1 * 100) = 4000 - 200 + 500 + 100 = 4400
      expect(base).toBe(4400);

      const multiplied = calculateScore(null, {
        roomsCleared: 4,
        turns: 20,
        noDamageRooms: 2,
        relicsCount: 1,
        multiplier: 1.5,
      });
      expect(multiplied).toBe(6600);
    });

    it('extracts progress details directly from a GameState', () => {
      const state = createGame('solo', [{ id: 'hero', name: 'Hero' }]);
      state.visitedRooms = ['threshold', 'cinder', 'archive'];
      state.turns = 18;
      state.players[0].relics = ['iron_heart', 'swift_boots'];

      // (3 * 1000) - (18 * 10) + (0 * 250) + (2 * 100) = 3000 - 180 + 200 = 3020
      const score = calculateScore(state);
      expect(score).toBe(3020);

      // Augment with noDamageRooms from details
      const scoreWithNoDamage = calculateScore(state, { noDamageRooms: 2 });
      // 3020 + (2 * 250) = 3520
      expect(scoreWithNoDamage).toBe(3520);
    });

    it('handles empty or zeroed state gracefully', () => {
      expect(calculateScore()).toBe(0);
      expect(calculateScore(null)).toBe(0);
      expect(calculateScore(null, {})).toBe(0);
    });
  });

  describe('Random Events between rooms', () => {
    it('defines shrine_of_vitality with correct description and effect', () => {
      const event = EVENT_DEFINITIONS.shrine_of_vitality;
      expect(event).toBeDefined();
      expect(event.description).toBe(
        'A quiet shrine hums with chronal warmth. Heal 3 HP.',
      );
      expect(event.effect).toBe('heal_3');
    });

    it('defines time_forge with correct description and effect', () => {
      const event = EVENT_DEFINITIONS.time_forge;
      expect(event).toBeDefined();
      expect(event.description).toBe(
        'An abandoned anvil glowing with embers. Upgrade a card in your deck.',
      );
      expect(event.effect).toBe('upgrade_card');
    });

    it('defines curious_merchant with correct description and effect', () => {
      const event = EVENT_DEFINITIONS.curious_merchant;
      expect(event).toBeDefined();
      expect(event.description).toBe(
        'A hooded traveler offers a rare relic in exchange for 3 HP.',
      );
      expect(event.effect).toBe('trade_hp_for_relic');
    });

    it('applies shrine_of_vitality healing to damaged player up to maxHp', () => {
      const state = createGame('solo', [{ id: 'p1', name: 'Explorer' }]);
      state.players[0].hp = 6;
      state.players[0].maxHp = 12;

      const res = applyEventEffect(state, 'shrine_of_vitality');
      expect(res.ok).toBe(true);
      expect(state.players[0].hp).toBe(9);

      // Capped at maxHp
      state.players[0].hp = 11;
      applyEventEffect(state, 'shrine_of_vitality');
      expect(state.players[0].hp).toBe(12);
    });

    it('applies time_forge card upgrade to strike', () => {
      const state = createGame('solo', [{ id: 'p1', name: 'Explorer' }]);
      state.players[0].hand = [];
      state.players[0].discard = [];
      state.players[0].deck = ['strike', 'step1'];

      const res = applyEventEffect(state, 'time_forge');
      expect(res.ok).toBe(true);
      expect(state.players[0].deck).toContain('strike_plus');
      expect(state.players[0].deck).not.toContain('strike');
    });

    it('applies curious_merchant relic trade in exchange for 3 HP', () => {
      const state = createGame('solo', [{ id: 'p1', name: 'Explorer' }]);
      state.players[0].hp = 10;
      state.players[0].relics = [];

      const res = applyEventEffect(state, 'curious_merchant');
      expect(res.ok).toBe(true);
      expect(state.players[0].hp).toBe(7);
      expect(state.players[0].relics?.length).toBe(1);

      // Reject trade if player has 3 HP or less
      state.players[0].hp = 3;
      const reject = applyEventEffect(state, 'curious_merchant');
      expect(reject.ok).toBe(false);
      expect(state.players[0].hp).toBe(3);
    });
  });

  describe('Act Mutators', () => {
    it('defines dense_fog, unstable_ground, and temporal_surge correctly', () => {
      expect(MUTATORS.dense_fog.description).toBe(
        'All projectile ranges reduced by 1 (min 1).',
      );
      expect(MUTATORS.unstable_ground.description).toBe(
        'Hazards deal +1 damage.',
      );
      expect(MUTATORS.temporal_surge.description).toBe(
        'Explorers start with 3 plays on turn 1 of each room.',
      );
    });

    it('applies dense_fog to reduce projectile ranges (minimum 1)', () => {
      expect(applyFogRange(3, ['dense_fog'])).toBe(2);
      expect(applyFogRange(2, ['dense_fog'])).toBe(1);
      expect(applyFogRange(1, ['dense_fog'])).toBe(1);
      expect(applyFogRange(0, ['dense_fog'])).toBe(0);
      expect(applyFogRange(3, [])).toBe(3);
    });

    it('applies unstable_ground hazard damage calculation', () => {
      expect(getHazardDamage([])).toBe(1);
      expect(getHazardDamage(['unstable_ground'])).toBe(2);
    });

    it('applies temporal_surge starting plays on turn 1 of each room', () => {
      expect(getStartingPlays(1, ['temporal_surge'])).toBe(3);
      expect(getStartingPlays(2, ['temporal_surge'])).toBe(2);
      expect(getStartingPlays(1, [])).toBe(2);
    });
  });

  describe('Breakable Walls', () => {
    it('blocks explorer movement like a solid wall', () => {
      const state = createGame('solo', [{ id: 'p1', name: 'Explorer' }]);
      state.enemies = [];
      // Set a breakable wall at (2, 1) directly right of explorer at (1, 1)
      state.tiles = ['#####', '#.B.#', '#...#', '#####'];
      state.players[0].x = 1;
      state.players[0].y = 1;
      state.players[0].hand = ['step1', 'dash'];

      expect(tileAt(state, { x: 2, y: 1 })).toBe('B');

      // Attempting to step directly into the breakable wall is rejected like a wall
      expect(() =>
        applyAction(state, 'p1', {
          type: 'play',
          card: 0,
          target: { x: 2, y: 1 },
        }),
      ).toThrow('Choose a floor tile.');

      // Attempting to dash through the breakable wall should also be blocked
      expect(() =>
        applyAction(state, 'p1', {
          type: 'play',
          card: 1,
          target: { x: 3, y: 1 },
        }),
      ).toThrow('That path is blocked.');
    });

    it('breaks into floor when handleBreakableWall is called directly or adjacent', () => {
      const state = createGame('solo', [{ id: 'p1', name: 'Explorer' }]);
      state.tiles = ['#####', '#.B.#', '#...#', '#####'];

      expect(tileAt(state, { x: 2, y: 1 })).toBe('B');

      // Call handleBreakableWall targeting the wall directly
      const broken = handleBreakableWall(state, { x: 2, y: 1 });
      expect(broken).toBe(true);
      expect(tileAt(state, { x: 2, y: 1 })).toBe('.');

      // Calling on floor with no breakable walls returns false
      expect(handleBreakableWall(state, { x: 1, y: 1 })).toBe(false);
    });

    it('breaks breakable wall adjacent to an attack', () => {
      const state = createGame('solo', [{ id: 'p1', name: 'Explorer' }]);
      state.tiles = ['#####', '#.B.#', '#...#', '#####'];

      // Attack at (1, 1), which is adjacent to breakable wall at (2, 1)
      const broken = handleBreakableWall(state, { x: 1, y: 1 });
      expect(broken).toBe(true);
      expect(tileAt(state, { x: 2, y: 1 })).toBe('.');
    });

    it('breaks into floor when targeted by an attack card in engine', () => {
      const state = createGame('solo', [{ id: 'p1', name: 'Explorer' }]);
      state.enemies = [];
      state.tiles = ['#####', '#.B.#', '#...#', '#####'];
      state.players[0].x = 1;
      state.players[0].y = 1;
      state.players[0].hand = ['strike'];

      expect(tileAt(state, { x: 2, y: 1 })).toBe('B');

      // Play strike targeting breakable wall at (2, 1)
      const next = applyAction(state, 'p1', {
        type: 'play',
        card: 0,
        target: { x: 2, y: 1 },
      });

      expect(tileAt(next, { x: 2, y: 1 })).toBe('.');

      // Now explorer can step into the cleared tile
      next.players[0].hand = ['step1'];
      next.plays = 2;
      const stepped = applyAction(next, 'p1', {
        type: 'play',
        card: 0,
        target: { x: 2, y: 1 },
      });
      expect(stepped.players[0].x).toBe(2);
      expect(stepped.players[0].y).toBe(1);
    });

    it('breaks adjacent wall when attacking an enemy with strike or cleave', () => {
      const state = createGame('solo', [{ id: 'p1', name: 'Explorer' }]);
      state.tiles = ['#####', '#.eB#', '#...#', '#####'];
      state.players[0].x = 1;
      state.players[0].y = 1;
      state.enemies = [
        {
          id: 'test-enemy',
          kind: 'turret',
          x: 2,
          y: 1,
          hp: 5,
          heading: 0,
          intent: { attack: [] },
        },
      ];
      state.players[0].hand = ['strike'];

      // Strike enemy at (2, 1); adjacent wall at (3, 1) should break!
      const next = applyAction(state, 'p1', {
        type: 'play',
        card: 0,
        target: { x: 2, y: 1 },
      });

      expect(next.enemies[0].hp).toBe(3);
      expect(tileAt(next, { x: 3, y: 1 })).toBe('.');
    });
  });
});
