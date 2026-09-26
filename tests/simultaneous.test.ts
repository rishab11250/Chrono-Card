import { describe, it, expect } from 'vitest';
import {
  createGame,
  resolveSimultaneousRound,
  previewSimultaneousTurn,
  abandonPlayer,
  type GameAction,
} from '@chrono/shared';
const party = () =>
  createGame(
    'party',
    Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
    42,
    'simultaneous',
  );
describe('simultaneous turn plans', () => {
  it('gives every explorer two plays and resolves independently of submission order', () => {
    const s = party();
    s.enemies = [];
    s.players.forEach((p) => {
      p.hp = 5;
      p.hand = ['shield', 'mend'];
    });
    const actions = s.players.map((p) => ({
      playerId: p.id,
      action: {
        type: 'submit-turn',
        actions: [
          { type: 'play', card: 0, target: { x: p.x, y: p.y } },
          { type: 'play', card: 0, target: { x: p.x, y: p.y } },
        ],
      } as GameAction,
    }));
    const next = resolveSimultaneousRound(s, actions);
    expect(next).toEqual(resolveSimultaneousRound(s, [...actions].reverse()));
    next.players.forEach((p) => expect(p).toMatchObject({ hp: 8, shield: 1 }));
    expect(next.round).toBe(s.round + 1);
    expect(s.players[0].hp).toBe(5);
  });
  it('previews the guest hand without executing enemies and rejects excessive or dead-player plans', () => {
    const s = party();
    s.players[1].hand = ['shield'];
    const p = s.players[1];
    const next = previewSimultaneousTurn(s, p.id, [
      { type: 'play', card: 0, target: p },
    ]);
    expect(next.active).toBe(1);
    expect(next.players[1].shield).toBe(1);
    expect(next.round).toBe(s.round);
    expect(next.revision).toBe(s.revision);
    expect(s.players[1].shield).toBe(0);
    expect(() =>
      previewSimultaneousTurn(
        s,
        p.id,
        Array(33).fill({ type: 'play', card: 0, target: p }),
      ),
    ).toThrow('32');
    p.hp = 0;
    expect(() => previewSimultaneousTurn(s, p.id, [])).toThrow('living');
  });
  it('discards a blocked movement without redirecting the next planned card index', () => {
    const s = party();
    s.enemies = [];
    s.players = s.players.slice(0, 2);
    Object.assign(s.players[0], { x: 2, y: 1, hand: ['step1', 'shield'] });
    Object.assign(s.players[1], { x: 4, y: 1, hand: ['step1', 'shield'] });
    const next = resolveSimultaneousRound(
      s,
      s.players.map((p) => ({
        playerId: p.id,
        action: {
          type: 'submit-turn',
          actions: [
            { type: 'play', card: 0, target: { x: 3, y: 1 } },
            {
              type: 'play',
              card: 0,
              target: p.id === 'p0' ? { x: 3, y: 1 } : { x: 4, y: 1 },
            },
          ],
        },
      })),
    );
    expect(next.players.map((p) => p.x)).toEqual([3, 4]);
    expect(next.players.map((p) => p.shield)).toEqual([1, 1]);
    expect(next.log.some((line) => line.includes('no longer'))).toBe(true);
  });
  it('preserves borrowed time for the next round and does not advance enemies on forfeiture', () => {
    const s = party();
    s.enemies = [];
    s.players[0].hand = ['boost'];
    const next = resolveSimultaneousRound(s, [
      {
        playerId: 'p0',
        action: { type: 'play', card: 0, target: s.players[1] },
      },
    ]);
    expect(next.players[1].bonus).toBe(1);
    expect(previewSimultaneousTurn(next, 'p1', []).plays).toBe(3);
    const abandoned = abandonPlayer(s, 'p0');
    expect(abandoned.round).toBe(s.round);
    expect(abandoned.active).toBe(1);
  });
});
