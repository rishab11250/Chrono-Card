import {
  activePlayer,
  applyAction,
  CARDS,
  distance,
  LEVELS,
  same,
  type GameAction,
  type GameState,
  type Position,
} from '@chrono/shared';

function pathDistance(s: GameState, from: Position, target: Position) {
  const queue = [{ ...from, cost: 0 }];
  const seen = new Set([`${from.x},${from.y}`]);
  for (const p of queue) {
    if (same(p, target)) return p.cost;
    for (const d of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const n = { x: p.x + d.x, y: p.y + d.y, cost: p.cost + 1 };
      const key = `${n.x},${n.y}`;
      if (
        LEVELS[s.level].tiles[n.y]?.[n.x] &&
        LEVELS[s.level].tiles[n.y][n.x] !== '#' &&
        !seen.has(key)
      ) {
        seen.add(key);
        queue.push(n);
      }
    }
  }
  return 50;
}
function score(s: GameState) {
  if (s.phase === 'won') return 1_000_000;
  if (s.phase === 'choosing') return 500_000;
  if (s.phase === 'lost') return -1_000_000;
  const p = activePlayer(s);
  let exitPos = { x: 8, y: 8 };
  const level = LEVELS[s.level];
  if (level) {
    for (let y = 0; y < level.height; y++) {
      const x = level.tiles[y].indexOf('E');
      if (x !== -1) {
        exitPos = { x, y };
        break;
      }
    }
  }
  const dist = s.enemies.length
    ? Math.min(...s.enemies.map((e) => pathDistance(s, p, e)))
    : pathDistance(s, p, exitPos);
  return (
    s.level * 10_000 -
    s.enemies.length * 300 +
    -s.enemies.reduce((total,e)=>total+e.hp*35,0) +
    s.players.reduce((sum, v) => sum + v.hp * 6 + v.shield * 1.5, 0) -
    dist * 5 -
    s.enemies.reduce(
      (sum, e) => sum + (e.intent.attack.some((t) => same(t, p)) ? 10 : 0),
      0,
    ) +
    s.plays * 0.05
  );
}
function candidates(s: GameState): { state: GameState; action: GameAction }[] {
  if (s.plays < 1) return [];
  const p = activePlayer(s);
  const result: { state: GameState; action: GameAction }[] = [];
  const lvl = LEVELS[s.level];
  const maxW = lvl ? lvl.width - 1 : 9;
  const maxH = lvl ? lvl.height - 1 : 9;
  p.hand.forEach((id, card) => {
    let targets: Position[];
    if (id === 'redraw' || id === 'shield') targets = [{ x: p.x, y: p.y }];
    else if (CARDS[id].category === 'attack' || id === 'taunt')
      targets = s.enemies;
    else if (id === 'boost')
      targets = s.players.filter((v) => v.id !== p.id && v.hp > 0);
    else {
      targets = [];
      for (let y = 1; y < maxH; y++)
        for (let x = 1; x < maxW; x++)
          if (
            (x === p.x || y === p.y) &&
            distance(p, { x, y }) <= CARDS[id].range
          )
            targets.push({ x, y });
      if (id === 'swap')
        targets.push(...s.players.filter((v) => v.id !== p.id && v.hp > 0));
    }
    for (const target of targets) {
      const action: GameAction = {
        type: 'play',
        card,
        target: { x: target.x, y: target.y },
      };
      try {
        result.push({ state: applyAction(s, p.id, action), action });
      } catch {
        /* Ignore illegal candidates. */
      }
    }
  });
  return result;
}
export function chooseAction(s: GameState): GameAction {
  if (s.phase === 'choosing') return {type: 'choose-room', roomId: s.roomChoices[0]};
  const options = candidates(s);
  if (!options.length) return { type: 'end' };
  const base = score(s);
  const evaluated = options
    .map((candidate) => {
      let value = score(candidate.state);
      if (
        candidate.state.phase === 'playing' &&
        candidate.state.level === s.level &&
        candidate.state.active === s.active
      ) {
        const followups = candidates(candidate.state);
        if (followups.length)
          value = Math.max(
            value,
            ...followups.map((next) => score(next.state)),
          );
      }
      return { ...candidate, value };
    })
    .sort((a, b) => b.value - a.value || score(b.state) - score(a.state));
  const best = evaluated[0];
  // A redraw can rescue a spent hand, but should not become a zero-cost loop.
  if (best.value > base + 0.01) return best.action;
  const redraw = s.players[s.active].hand.indexOf('redraw');
  if (redraw >= 0 && s.plays > 0) return { type: 'play', card: redraw };
  return { type: 'end' };
}
