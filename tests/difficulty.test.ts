import { describe, it, expect } from 'vitest';
import {
  ACTS,
  LEVELS,
  ENEMIES,
  createGame,
  applyAction,
  roomThreatBudget,
  activePlayer,
  type GameState,
} from '@chrono/shared';
function enter(index: number, count: number, seed: number) {
  let s = createGame(
    count === 1 ? 'solo' : 'party',
    Array.from({ length: count }, (_, i) => ({ id: String(i), name: `P${i}` })),
    seed,
  );
  s.phase = 'choosing';
  s.roomChoices = [LEVELS[index].id];
  s = applyAction(s, '0', { type: 'choose-room', roomId: LEVELS[index].id });
  return s;
}
describe('Act threat budgets', () => {
  it('grows by graph depth and party size, with equal budgets for sibling routes', () => {
    for (const act of ACTS) {
      const entry = LEVELS.find((l) => l.id === act.entry)!;
      expect(roomThreatBudget(entry, 1)).toBe(act.difficulty.baseThreat);
      expect(roomThreatBudget(entry, 4)).toBe(
        act.difficulty.baseThreat + 3 * act.difficulty.threatPerAlly,
      );
      const siblings = entry.next.map((id) => LEVELS.find((l) => l.id === id)!);
      expect(roomThreatBudget(siblings[0], 1)).toBe(
        roomThreatBudget(siblings[1], 1),
      );
    }
  });
  it('fills exact budgets reproducibly, uses all enemy types, and spawns on distinct safe floor tiles', () => {
    const seen = new Set<string>();
    for (let index = 0; index < LEVELS.length; index++)
      for (const count of [1, 2, 4])
        for (const seed of [42, 123, 987]) {
          const s = enter(index, count, seed),
            level = LEVELS[index];
          expect(s).toEqual(enter(index, count, seed));
          expect(
            s.enemies.reduce((n, e) => n + ENEMIES[e.kind].threat, 0),
          ).toBe(roomThreatBudget(level, count));
          expect(new Set(s.enemies.map((e) => `${e.x},${e.y}`)).size).toBe(
            s.enemies.length,
          );
          s.enemies.forEach((e) => {
            seen.add(e.kind);
            expect(level.tiles[e.y][e.x]).toBe('.');
            expect(e.x > 2 || e.y > 2).toBe(true);
          });
          if (!level.next.length)
            expect(
              s.enemies.some(
                (e) =>
                  e.kind ===
                  ACTS.find((a) => a.id === level.actId)!.difficulty.boss,
              ),
            ).toBe(true);
        }
    expect([...seen].sort()).toEqual(Object.keys(ENEMIES).sort());
  });
  it('loads the next budget through actual draft and route actions', () => {
    let s: GameState = createGame('solo', [{ id: 'a', name: 'A' }]);
    s.enemies = [];
    Object.assign(s.players[0], { x: 8, y: 8 });
    s = applyAction(s, 'a', { type: 'end' });
    while (s.phase === 'drafting')
      s = applyAction(s, activePlayer(s).id, {
        type: 'draft-card',
        cardId: s.draftChoices[activePlayer(s).id][0],
      });
    s = applyAction(s, 'a', { type: 'choose-room', roomId: s.roomChoices[0] });
    expect(s.enemies.reduce((n, e) => n + ENEMIES[e.kind].threat, 0)).toBe(
      roomThreatBudget(LEVELS[s.level], 1),
    );
  });
});
