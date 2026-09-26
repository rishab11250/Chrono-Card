import { describe, expect, it } from 'vitest';
import {
  createGame,
  applyAction,
  ENEMIES,
  resolveSimultaneousRound,
  type GameAction,
} from '@chrono/shared';

describe('toxic_blade', () => {
  it('poisons the enemy alongside 1 damage', () => {
    const s = createGame('solo', [{ id: 'a', name: 'A' }], 9);
    s.enemies = [
      {
        id: 't',
        kind: 'patroller',
        x: 2,
        y: 1,
        hp: ENEMIES.patroller.hp,
        heading: 0,
        intent: { attack: [] },
      },
    ];
    s.players[0].x = 1;
    s.players[0].y = 1;
    s.players[0].hand = ['toxic_blade'];
    const next = applyAction(s, 'a', {
      type: 'play',
      card: 0,
      target: { x: 2, y: 1 },
    });
    expect(next.enemies[0].hp).toBe(ENEMIES.patroller.hp - 1);
    expect(next.enemies[0].statuses?.some((st) => st.type === 'poison')).toBe(
      true,
    );
  });
});

describe('hunters_mark', () => {
  it('consumes its charge on the next attack', () => {
    const s = createGame('solo', [{ id: 'a', name: 'A' }], 13);
    s.enemies = [
      {
        id: 't',
        kind: 'patroller',
        x: 2,
        y: 1,
        hp: 4,
        heading: 0,
        intent: { attack: [] },
      },
    ];
    s.players[0].x = 1;
    s.players[0].y = 1;
    s.players[0].hand = ['hunters_mark', 'strike'];
    const marked = applyAction(s, 'a', {
      type: 'play',
      card: 0,
      target: { x: 1, y: 1 },
    });
    expect(marked.players[0].bonusDamage).toBe(1);
    const after = applyAction(marked, 'a', {
      type: 'play',
      card: 0,
      target: { x: 2, y: 1 },
    });
    expect(after.enemies[0].hp).toBe(1);
    expect(after.players[0].bonusDamage ?? 0).toBe(0);
  });
});

describe('simultaneous round tolerates empty plans', () => {
  it('resolves when every living member submitted an empty plan', () => {
    const s = createGame(
      'party',
      [0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}` })),
      21,
      'simultaneous',
    );
    s.enemies = [];
    s.players[0].x = 1;
    s.players[0].y = 1;
    const actions: { playerId: string; action: GameAction }[] = s.players.map(
      (p) => ({
        playerId: p.id,
        action: { type: 'submit-turn', actions: [] },
      }),
    );
    const next = resolveSimultaneousRound(s, actions);
    expect(next.round).toBe(s.round + 1);
  });
});

describe('user profile redaction', () => {
  it('omitted — covered by server.test.ts', () => {
    expect(true).toBe(true);
  });
});
