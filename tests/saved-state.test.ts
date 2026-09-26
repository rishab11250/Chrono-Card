import { describe, it, expect } from 'vitest';
import { createGame, applyAction } from '@chrono/shared';
import { restoreLocalGame } from '../packages/client/src/saved-state';
describe('browser save recovery', () => {
  it('restores current saves and fills missing fields on older saves', () => {
    const s = createGame('solo', [{ id: 'a', name: 'A' }]);
    expect(restoreLocalGame(s)).toEqual(s);
    const older = JSON.parse(JSON.stringify(s));
    delete older.hazards;
    delete older.draftChoices;
    delete older.relicChoices;
    delete older.visitedRooms;
    delete older.roomChoices;
    expect(restoreLocalGame(older)).toMatchObject({
      hazards: [],
      draftChoices: {},
      visitedRooms: [],
      roomChoices: [],
    });
  });
  it('rejects structural corruption before it reaches rendering', () => {
    const s = createGame('solo', [{ id: 'a', name: 'A' }]);
    for (const bad of [
      null,
      [],
      {},
      { ...s, active: 10 },
      { ...s, level: 999 },
      { ...s, players: [{}] },
      { ...s, players: [{ ...s.players[0], hand: ['__proto__'] }] },
      { ...s, enemies: [{ ...s.enemies[0], intent: null }] },
      { ...s, log: null },
      { ...s, hazards: [null] },
      { ...s, phase: 'drafting' },
    ])
      expect(restoreLocalGame(bad)).toBeNull();
  });
  it('accepts a real pending draft and route choice', () => {
    let s = createGame('solo', [{ id: 'a', name: 'A' }]);
    s.enemies = [];
    Object.assign(s.players[0], { x: 8, y: 8 });
    s = applyAction(s, 'a', { type: 'end' });
    expect(restoreLocalGame(s)).toEqual(s);
    s = applyAction(s, 'a', {
      type: 'pick-relic',
      relicId: s.relicChoices!.a[0],
    });
    s = applyAction(s, 'a', {
      type: 'draft-card',
      cardId: s.draftChoices.a[0],
    });
    expect(restoreLocalGame(s)).toEqual(s);
  });
});
