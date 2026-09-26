import { expect, it } from 'vitest';
import {
  activePlayer,
  applyAction,
  createGame,
  LEVELS,
  type Mode,
} from '@chrono/shared';
import { chooseAction } from './bot';

it.each([
  { mode: 'solo', count: 1 },
  { mode: 'duo', count: 2 },
  { mode: 'party', count: 4 },
] as { mode: Mode; count: number }[])(
  `finishes an expedition through ${LEVELS.length} authored rooms in $mode with ordinary legal card plays`,
  ({ mode, count }) => {
    let state = createGame(
      mode,
      Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        name: `Explorer ${i + 1}`,
      })),
      20260924,
    );
    let actions = 0;
    while (
      state.phase !== 'won' &&
      state.phase !== 'lost' &&
      actions < LEVELS.length * 300
    ) {
      state = applyAction(state, activePlayer(state).id, chooseAction(state));
      actions++;
    }
    expect({
      phase: state.phase,
      level: state.level,
      turns: state.turns,
      hp: state.players.map((p) => p.hp),
    }).toMatchObject({ phase: 'won', level: LEVELS.length - 1 });
  },
  120_000,
);
