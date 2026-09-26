import { describe, it, expect } from 'vitest';
import {
  ACTS,
  activePlayer,
  applyAction,
  createGame,
  LEVELS,
  legalTargets,
  type GameState,
} from '@chrono/shared';

function enter(index: number): GameState {
  const s = createGame('solo', [{ id: 'a', name: 'A' }], 7);
  s.phase = 'choosing';
  s.roomChoices = [LEVELS[index].id];
  return applyAction(s, 'a', {
    type: 'choose-room',
    roomId: LEVELS[index].id,
  });
}

function enemyAt(x: number, y: number) {
  return {
    id: 'target',
    kind: 'turret' as const,
    x,
    y,
    hp: 2,
    heading: 0,
    intent: { attack: [] },
  };
}

describe('Act mutators', () => {
  it('applies each Act’s authored mutators on room entry', () => {
    for (const act of ACTS) {
      const index = LEVELS.findIndex((level) => level.id === act.entry);
      expect(enter(index).mutators).toEqual(act.mutator ?? []);
    }
  });

  it('dense fog shortens projectile range in Act II but not Act I', () => {
    const fogged = enter(LEVELS.findIndex((level) => level.actId === 'vaults'));
    expect(fogged.mutators).toContain('dense_fog');
    fogged.enemies = [];
    fogged.tiles = ['#####', '#...#', '#...#', '#####'];
    fogged.players[0].hand = ['arrow'];
    fogged.enemies = [enemyAt(3, 1)];
    expect(legalTargets(fogged, 0)).toEqual([]);
    expect(() =>
      applyAction(fogged, 'a', {
        type: 'play',
        card: 0,
        target: { x: 3, y: 1 },
      }),
    ).toThrow();

    const clear = enter(0);
    clear.tiles = ['#####', '#...#', '#...#', '#####'];
    clear.enemies = [enemyAt(3, 1)];
    clear.players[0].hand = ['arrow'];
    expect(legalTargets(clear, 0)).toContainEqual({ x: 3, y: 1 });
  });

  it('temporal surge grants a third play only on Act III’s opening round', () => {
    const surge = enter(LEVELS.findIndex((level) => level.actId === 'fracture'));
    expect(surge.mutators).toContain('temporal_surge');
    expect(surge.plays).toBe(3);
    expect(enter(0).plays).toBe(2);
  });

  it('unstable ground doubles hazard damage when active', () => {
    const s = createGame('solo', [{ id: 'a', name: 'A' }], 7);
    s.enemies = [];
    s.tiles = ['#####', '#.~.#', '#...#', '#####'];
    s.mutators = ['unstable_ground'];
    const p = activePlayer(s);
    p.hand = ['step1'];
    const next = applyAction(s, 'a', {
      type: 'play',
      card: 0,
      target: { x: 2, y: 1 },
    });
    expect(next.players[0].hp).toBe(10);
  });
});

describe('between-room events', () => {
  it('never drops a low-HP explorer when an event fires', () => {
    let fired = false;
    for (let seed = 1; seed <= 30; seed++) {
      const s = createGame('solo', [{ id: 'a', name: 'A' }], seed);
      s.enemies = [];
      Object.assign(s.players[0], { x: 8, y: 8, hp: 4 });
      const next = applyAction(s, 'a', { type: 'end' });
      expect(next.phase).toBe('drafting');
      expect(next.players[0].hp).toBeGreaterThanOrEqual(4);
      if (next.log.some((line) => /healed|upgrad|traded|enough HP/i.test(line)))
        fired = true;
    }
    expect(fired).toBe(true);
  });
});
