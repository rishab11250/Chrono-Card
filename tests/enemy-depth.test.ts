import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyAction,
  tileAt,
  ENEMIES,
  resolveSimultaneousRound,
  type GameState,
  type EnemyKind,
} from '@chrono/shared';
function fixture(kind: EnemyKind): GameState {
  const s = createGame('solo', [{ id: 'a', name: 'A' }]);
  s.enemies = [
    {
      id: 'test',
      kind,
      x: 4,
      y: 3,
      hp: ENEMIES[kind].hp,
      heading: 0,
      intent: { attack: [] },
    },
  ];
  return applyAction(s, 'a', { type: 'end' });
}
describe('new telegraphed enemies', () => {
  it('Bomber announces a fixed tile before dropping embers; standing there causes no damage', () => {
    let s = fixture('bomber');
    const before = structuredClone(s);
    const marked = { ...s.enemies[0].intent.hazard![0] };
    expect(s.hazards).toEqual([]);
    expect(s.enemies[0].intent.attack).toEqual([]);
    s = applyAction(s, 'a', { type: 'end' });
    expect(tileAt(s, marked)).toBe('~');
    expect(s.players[0].hp).toBe(12);
    expect(s.enemies[0]).toMatchObject({ x: 4, y: 3 });
    expect(before.hazards).toEqual([]);
  });
  it('temporary hazards hurt on entry and expire after three complete rounds', () => {
    let s = fixture('bomber');
    s = applyAction(s, 'a', { type: 'end' });
    const h = s.hazards[0];
    expect(h.expiresRound - s.round).toBe(3);
    s.enemies = [];
    s.players[0].x = 2;
    s.players[0].y = 1;
    s.players[0].hand = ['step1'];
    s = applyAction(s, 'a', { type: 'play', card: 0, target: { x: 1, y: 1 } });
    expect(s.players[0].hp).toBe(11);
    for (let n = 0; n < 2; n++) {
      s = applyAction(s, 'a', { type: 'end' });
      expect(tileAt(s, h)).toBe('~');
    }
    s = applyAction(s, 'a', { type: 'end' });
    expect(s.hazards).toEqual([]);
    expect(tileAt(s, h)).toBe('.');
  });
  it.each(['chaser_elite', 'warden_elite'] as const)(
    '%s retains its telegraph through two rounds, then attacks and moves',
    (kind) => {
      let s = fixture(kind);
      expect(s.enemies[0].hp).toBe(4);
      expect(s.enemies[0].intent.charging).toBe(true);
      const announced = structuredClone(s.enemies[0].intent);
      const target = announced.attack[0];
      Object.assign(s.players[0], target);
      s = applyAction(s, 'a', { type: 'end' });
      expect(s.players[0].hp).toBe(12);
      expect(s.enemies[0]).toMatchObject({ x: 4, y: 3 });
      expect(s.enemies[0].intent.attack).toEqual(announced.attack);
      expect(s.enemies[0].intent.charging).toBe(false);
      s = applyAction(s, 'a', { type: 'end' });
      expect(s.players[0].hp).toBe(12 - ENEMIES[kind].damage);
      expect(s.enemies[0].intent.charging).toBe(true);
    },
  );
  it('does not skip the windup in simultaneous rounds', () => {
    const s = fixture('chaser_elite');
    Object.assign(s.players[0], s.enemies[0].intent.attack[0]);
    const next = resolveSimultaneousRound(s, [
      { playerId: 'a', action: { type: 'end' } },
    ]);
    expect(next.players[0].hp).toBe(12);
    expect(next.enemies[0].intent.charging).toBe(false);
  });
  it.each(['turret', 'warden_elite'] as const)(
    '%s does not accumulate attack tiles across rounds',
    (kind) => {
      let s = fixture(kind);
      for (let round = 0; round < 6; round++) {
        s = applyAction(s, 'a', { type: 'end' });
        const tiles = s.enemies[0].intent.attack;
        const unique = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
        expect(unique.size).toBe(tiles.length);
        expect(tiles.length).toBeLessThanOrEqual(kind === 'turret' ? 3 : 8);
      }
    },
  );
});
