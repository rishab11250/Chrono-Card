import { expect, it } from 'vitest';
import {
  activePlayer,
  applyAction,
  createGame,
  type Mode,
} from '@chrono/shared';
import { chooseAction } from './bot';

it.each([
  { mode: 'solo', count: 1 },
  { mode: 'duo', count: 2 },
  { mode: 'party', count: 4 },
] as { mode: Mode; count: number }[])(
  'finishes all five rooms in $mode with ordinary legal card plays',
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
    while (state.phase === 'playing' && actions < 1500) {
      state = applyAction(state, activePlayer(state).id, chooseAction(state));
      actions++;
    }
    expect({
      phase: state.phase,
      level: state.level,
      turns: state.turns,
      hp: state.players.map((p) => p.hp),
    }).toMatchObject({ phase: 'won', level: 4 });
  },
  120_000,
);
