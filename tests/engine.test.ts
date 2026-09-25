import { describe, expect, it } from 'vitest';
import {
  abandonPlayer,
  activePlayer,
  applyAction,
  CARDS,
  createGame,
  dailySeed,
  ENEMIES,
  legalTargets,
  LEVELS,
  same,
  type CardId,
  type Enemy,
  type GameState,
} from '@chrono/shared';

const solo = (seed = 42) =>
  createGame('solo', [{ id: 'p1', name: 'Ada' }], seed);
function fixture(card: CardId): GameState {
  const s = solo();
  s.enemies = [];
  const p = activePlayer(s);
  p.x = 2;
  p.y = 3;
  p.hand = [card];
  return s;
}
function enemy(x: number, y: number, kind: Enemy['kind'] = 'turret'): Enemy {
  return {
    id: 'target',
    x,
    y,
    kind,
    hp: 2,
    heading: 0,
    intent: { attack: [] },
  };
}
function play(s: GameState, x?: number, y?: number) {
  return applyAction(s, activePlayer(s).id, {
    type: 'play',
    card: 0,
    ...(x === undefined ? {} : { target: { x, y: y! } }),
  });
}

describe('content and deterministic turns', () => {
  it('contains all ten cards, three patterns, and five connected 10x10 rooms', () => {
    expect(Object.keys(CARDS)).toHaveLength(10);
    expect(Object.keys(ENEMIES)).toHaveLength(3);
    expect(LEVELS).toHaveLength(5);
    for (const level of LEVELS) {
      expect(level.tiles).toHaveLength(10);
      level.tiles.forEach((row) => expect(row).toHaveLength(10));
      const visited = new Set(['1,1']);
      const queue = [{ x: 1, y: 1 }];
      for (const p of queue)
        for (const d of [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: -1 },
        ]) {
          const n = { x: p.x + d.x, y: p.y + d.y };
          const key = `${n.x},${n.y}`;
          if (
            level.tiles[n.y]?.[n.x] &&
            level.tiles[n.y][n.x] !== '#' &&
            !visited.has(key)
          ) {
            visited.add(key);
            queue.push(n);
          }
        }
      level.tiles.forEach((row, y) =>
        [...row].forEach((tile, x) => {
          if (tile !== '#') expect(visited.has(`${x},${y}`)).toBe(true);
        }),
      );
      level.enemies.forEach((e) =>
        expect(visited.has(`${e.x},${e.y}`)).toBe(true),
      );
    }
  });
  it('replays the same seed and actions identically without mutating inputs', () => {
    let a = solo(123);
    let b = solo(123);
    const before = structuredClone(a);
    for (let i = 0; i < 8; i++) {
      a = applyAction(a, 'p1', { type: 'end' });
      b = applyAction(b, 'p1', { type: 'end' });
    }
    expect(a).toEqual(b);
    expect(before).toEqual(solo(123));
    expect(solo(124)).not.toEqual(before);
    expect(dailySeed('2026-09-24')).toBe(dailySeed('2026-09-24'));
    expect(dailySeed('2026-09-25')).not.toBe(dailySeed('2026-09-24'));
  });
  it('draws five cards, guarantees movement and damage, and conserves the deck', () => {
    let s = solo();
    s.enemies = [];
    for (let turn = 0; turn < 50; turn++) {
      const p = activePlayer(s);
      expect(p.hand).toHaveLength(5);
      expect(p.hand.some((id) => CARDS[id].category === 'move')).toBe(true);
      expect(p.hand.some((id) => CARDS[id].category === 'attack')).toBe(true);
      expect(p.hand.length + p.deck.length + p.discard.length).toBe(14);
      s = applyAction(s, p.id, { type: 'end' });
    }
  });
  it('rejects wrong turns, invalid cards, walls, diagonals, and exhausted actions atomically', () => {
    const s = fixture('step2');
    const original = structuredClone(s);
    expect(() => applyAction(s, 'intruder', { type: 'end' })).toThrow('turn');
    expect(() => applyAction(s, 'p1', { type: 'play', card: 9 })).toThrow(
      'card',
    );
    expect(() => play(s, 0, 3)).toThrow();
    expect(() => play(s, 3, 2)).toThrow();
    expect(() => play(s, 2.5, 3)).toThrow();
    expect(s).toEqual(original);
    s.plays = 0;
    expect(() => play(s, 3, 3)).toThrow('No plays');
  });
});
describe('card effects', () => {
  it('steps one or two tiles and cannot cross actors or walls', () => {
    expect(activePlayer(play(fixture('step1'), 3, 3)).x).toBe(3);
    expect(activePlayer(play(fixture('step2'), 4, 3)).x).toBe(4);
    expect(() => play(fixture('step1'), 4, 3)).toThrow();
    const s = fixture('step2');
    s.enemies = [enemy(3, 3)];
    expect(() => play(s, 4, 3)).toThrow('blocked');
  });
  it('dashes through enemies but cannot land on them or cross walls', () => {
    const s = fixture('dash');
    s.enemies = [enemy(3, 3)];
    expect(activePlayer(play(s, 5, 3)).x).toBe(5);
    expect(() => play(s, 3, 3)).toThrow('blocked');
    s.players[0].y = 2;
    s.players[0].x = 4;
    expect(() => play(s, 6, 2)).toThrow('blocked');
  });
  it('applies hazards when walking, skips intermediate hazards on dash, and damages on landing', () => {
    const s = fixture('step2');
    s.players[0].x = 5;
    s.players[0].y = 5;
    expect(activePlayer(play(s, 7, 5)).hp).toBe(11);
    s.players[0].hand = ['dash'];
    expect(activePlayer(play(s, 7, 5)).hp).toBe(12);
    expect(activePlayer(play(s, 6, 5)).hp).toBe(11);
  });
  it('swaps adjacent enemies without moving their already-announced attack', () => {
    const s = fixture('swap');
    s.enemies = [enemy(3, 3)];
    s.enemies[0].intent.attack = [{ x: 3, y: 4 }];
    const result = play(s, 3, 3);
    expect(result.players[0].x).toBe(3);
    expect(result.enemies[0].x).toBe(2);
    expect(result.enemies[0].intent.attack).toEqual([{ x: 3, y: 4 }]);
  });
  it('swaps distant allies and applies hazards to both destination tiles', () => {
    const s = createGame('duo', [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
    ]);
    s.players[0].hand = ['swap'];
    s.players[1].x = 6;
    s.players[1].y = 5;
    const result = play(s, 6, 5);
    expect(result.players[0].hp).toBe(11);
    expect(result.players[1]).toMatchObject({ x: 1, y: 1, hp: 12 });
  });
  it('strikes adjacent targets and shoots only unobstructed two-tile lines', () => {
    const s = fixture('strike');
    s.enemies = [enemy(3, 3)];
    expect(play(s, 3, 3).enemies).toHaveLength(0);
    s.players[0].hand = ['arrow'];
    s.enemies = [enemy(4, 3)];
    expect(play(s, 4, 3).enemies).toHaveLength(0);
    s.enemies.push({ ...enemy(3, 3), id: 'blocker' });
    expect(() => play(s, 4, 3)).toThrow('clear range');
  });
  it('shields self or ally and absorbs exactly one hit', () => {
    const s = fixture('shield');
    s.enemies = [enemy(5, 3), { ...enemy(6, 3), id: 'second' }];
    s.enemies.forEach((e) => {
      e.intent.attack = [{ x: 2, y: 3 }];
    });
    const shielded = play(s);
    expect(shielded.players[0].shield).toBe(1);
    const after = applyAction(shielded, 'p1', { type: 'end' });
    expect(after.players[0].shield).toBe(0);
    expect(after.players[0].hp).toBe(10);
    const duo = createGame('duo', [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
    ]);
    duo.players[0].hand = ['shield'];
    expect(play(duo, 2, 1).players[1].shield).toBe(1);
  });
  it('redraws without consuming a play and still conserves all cards', () => {
    const s = solo();
    const p = activePlayer(s);
    p.deck = [...p.deck, ...p.hand];
    p.hand = [p.deck.splice(p.deck.indexOf('redraw'), 1)[0]];
    const after = play(s);
    expect(after.plays).toBe(2);
    expect(activePlayer(after).hand).toHaveLength(5);
    expect(
      activePlayer(after).hand.length +
        activePlayer(after).deck.length +
        activePlayer(after).discard.length,
    ).toBe(14);
  });
  it('boosts an ally’s next turn and taunts a fixed attack coordinate', () => {
    const s = createGame('duo', [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
    ]);
    s.players[0].hand = ['boost'];
    const boosted = play(s, 2, 1);
    const next = applyAction(boosted, 'p1', { type: 'end' });
    expect(next.active).toBe(1);
    expect(next.plays).toBe(3);
    next.players[1].hand = ['taunt'];
    const e = next.enemies[0];
    const taunted = play(next, e.x, e.y);
    expect(taunted.enemies[0].intent.attack).toEqual([{ x: 2, y: 1 }]);
  });
  it('only previews legal targets, without modifying game state', () => {
    const s = fixture('step2');
    const before = structuredClone(s);
    const targets = legalTargets(s, 0);
    expect(targets.some((p) => same(p, { x: 4, y: 3 }))).toBe(true);
    expect(targets.some((p) => same(p, { x: 3, y: 4 }))).toBe(false);
    expect(s).toEqual(before);
    for (const target of targets)
      expect(() =>
        applyAction(s, 'p1', { type: 'play', card: 0, target }),
      ).not.toThrow();
  });
});
describe('enemy rounds and expedition outcomes', () => {
  it('waits for all party members before executing exact advertised attacks', () => {
    let s = createGame(
      'party',
      ['A', 'B', 'C', 'D'].map((name, i) => ({ name, id: `p${i}` })),
    );
    const start = structuredClone(s.enemies);
    s.enemies[0].intent.attack = [{ x: 1, y: 1 }];
    const damage = ENEMIES[s.enemies[0].kind].damage;
    for (let i = 0; i < 3; i++) {
      s = applyAction(s, `p${i}`, { type: 'end' });
      expect(s.round).toBe(1);
      expect(s.players[0].hp).toBe(12);
      expect(s.enemies.map(({ x, y }) => ({ x, y }))).toEqual(
        start.map(({ x, y }) => ({ x, y })),
      );
    }
    s = applyAction(s, 'p3', { type: 'end' });
    expect(s.round).toBe(2);
    expect(s.players[0].hp).toBe(12 - damage);
  });
  it('loses only when the whole party falls and rejects further actions', () => {
    const s = fixture('shield');
    s.players[0].hp = 1;
    s.enemies = [enemy(3, 3)];
    s.enemies[0].intent.attack = [{ x: 2, y: 3 }];
    const lost = applyAction(s, 'p1', { type: 'end' });
    expect(lost.phase).toBe('lost');
    expect(() => applyAction(lost, 'p1', { type: 'end' })).toThrow('ended');
  });
  it('locks the exit until cleared, advances rooms, heals, and wins in the final room', () => {
    const s = fixture('step1');
    s.players[0].x = 7;
    s.players[0].y = 8;
    s.enemies = [enemy(4, 3)];
    expect(play(s, 8, 8).level).toBe(0);
    s.enemies = [];
    s.players[0].hp = 4;
    const next = play(s, 8, 8);
    expect(next.level).toBe(1);
    expect(next.players[0]).toMatchObject({ x: 1, y: 1, hp: 7 });
    expect(next.enemies.length).toBeGreaterThan(0);
    s.level = 4;
    const won = play(s, 8, 8);
    expect(won.phase).toBe('won');
  });
  it('revives fallen allies but never players who abandoned the room', () => {
    let s = createGame('party', [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ]);
    s = abandonPlayer(s, 'b');
    s.players[2].hp = 0;
    s.enemies = [];
    s.players[0].hand = ['step1'];
    s.players[0].x = 7;
    s.players[0].y = 8;
    const next = play(s, 8, 8);
    expect(next.players[1].hp).toBe(0);
    expect(next.players[2].hp).toBe(3);
  });
});
