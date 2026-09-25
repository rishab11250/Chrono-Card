import cardData from './cards.json';
import enemyData from './enemies.json';
import levelData from './levels.json';
import type {
  Card,
  CardId,
  GameAction,
  GameState,
  Level,
  Mode,
  Player,
  Position,
  TurnOrder,
  Act,
} from './types';

export const CARDS = Object.fromEntries(
  cardData.map((card) => [card.id, card]),
) as Record<CardId, Card>;
export const ENEMIES = enemyData;
export const ACTS = levelData.acts as Act[];
export const LEVELS: Level[] = ACTS.flatMap(act => act.rooms.map((lvl) => ({
  ...lvl,
  actId: act.id,
  width: lvl.tiles[0]?.length ?? 10,
  height: lvl.tiles.length,
})));
export const levelIndex = (id: string) => LEVELS.findIndex(level => level.id === id);
export function nextRoomIds(s: GameState): string[] {
  const level = LEVELS[s.level];
  if (level.next.length) return [...level.next];
  const act = ACTS.findIndex(act => act.id === level.actId);
  return ACTS[act + 1] ? [ACTS[act + 1].entry] : [];
}
export const DIRECTIONS: Position[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
export const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
export const distance = (a: Position, b: Position) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const tileAt = (s: GameState, p: Position) =>
  LEVELS[s.level].tiles[p.y]?.[p.x] ?? '#';
const livingAt = (s: GameState, p: Position) =>
  s.players.find((v) => v.hp > 0 && same(v, p));
const enemyAt = (s: GameState, p: Position) =>
  s.enemies.find((v) => same(v, p));
export const activePlayer = (s: GameState) => s.players[s.active];
function note(s: GameState, message: string) {
  s.log = [...s.log.slice(-7), message];
}
function random(s: GameState) {
  s.rng = (Math.imul(1664525, s.rng) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
function shuffle<T>(s: GameState, values: T[]) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
function draw(s: GameState, p: Player) {
  p.discard.push(...p.hand);
  p.hand = [];
  if (p.deck.length < 7) {
    p.deck.push(...shuffle(s, p.discard));
    p.discard = [];
  }
  // Each fresh hand has movement and damage, so unlucky draws cannot strand a run.
  for (const category of ['move', 'attack']) {
    let index = p.deck.findIndex((id) => CARDS[id].category === category);
    if (index < 0) {
      const fromDiscard = p.discard.findIndex(
        (id) => CARDS[id].category === category,
      );
      if (fromDiscard >= 0) p.deck.push(...p.discard.splice(fromDiscard, 1));
      index = p.deck.findIndex((id) => CARDS[id].category === category);
    }
    if (index >= 0) p.hand.push(...p.deck.splice(index, 1));
  }
  while (p.hand.length < 5 && p.deck.length) p.hand.push(p.deck.shift()!);
}
function hit(s: GameState, p: Player, damage: number) {
  if (p.shield > 0) {
    p.shield--;
    note(s, `${p.name}'s shield absorbs the hit.`);
  } else {
    p.hp = Math.max(0, p.hp - damage);
    note(s, `${p.name} takes ${damage} damage.`);
  }
}
function hazard(s: GameState, p: Player) {
  if (tileAt(s, p) === '~') hit(s, p, 1);
}
function planEnemies(s: GameState) {
  const living = s.players.filter((p) => p.hp > 0);
  for (const e of s.enemies) {
    e.intent = { attack: [] };
    if (e.kind === 'turret') {
      const d = DIRECTIONS[e.heading % 4];
      for (let n = 1; n <= 3; n++) {
        const p = { x: e.x + d.x * n, y: e.y + d.y * n };
        if (tileAt(s, p) === '#') break;
        e.intent.attack.push(p);
      }
    } else if (e.kind === 'warden_elite') {
      if (e.hp > 2) {
        // Cross attack: all 4 cardinal directions, up to 2 tiles
        for (const d of DIRECTIONS) {
          for (let n = 1; n <= 2; n++) {
            const p = { x: e.x + d.x * n, y: e.y + d.y * n };
            if (tileAt(s, p) === '#') break;
            e.intent.attack.push(p);
          }
        }
      } else {
        // Enraged: all 8 adjacent tiles
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const p = { x: e.x + dx, y: e.y + dy };
            if (tileAt(s, p) !== '#') e.intent.attack.push(p);
          }
      }
      // Move toward nearest player if within range 4
      const nearest = [...living].sort(
        (a, b) => distance(e, a) - distance(e, b),
      )[0];
      if (nearest && distance(e, nearest) <= 4) {
        const candidates = DIRECTIONS.map((d) => ({
          x: e.x + d.x,
          y: e.y + d.y,
        })).sort((a, b) => distance(a, nearest) - distance(b, nearest));
        e.intent.move = candidates.find(
          (p) => tileAt(s, p) !== '#' && !enemyAt(s, p) && !livingAt(s, p),
        );
      }
    } else {
      e.intent.attack = DIRECTIONS.map((d) => ({
        x: e.x + d.x,
        y: e.y + d.y,
      })).filter((p) => tileAt(s, p) !== '#');
      let candidates: Position[];
      if (e.kind === 'patroller') {
        const direction = e.heading % 2 ? 1 : -1;
        candidates = [
          { x: e.x + direction, y: e.y },
          { x: e.x - direction, y: e.y },
        ];
      } else {
        const nearest = [...living].sort(
          (a, b) => distance(e, a) - distance(e, b),
        )[0];
        candidates = nearest
          ? DIRECTIONS.map((d) => ({ x: e.x + d.x, y: e.y + d.y })).sort(
              (a, b) => distance(a, nearest) - distance(b, nearest),
            )
          : [];
      }
      e.intent.move = candidates.find(
        (p) => tileAt(s, p) !== '#' && !enemyAt(s, p) && !livingAt(s, p),
      );
    }
  }
}
function loadLevel(s: GameState) {
  s.phase = 'playing';
  s.roomChoices = [];
  s.visitedRooms = [...(s.visitedRooms ?? []), LEVELS[s.level].id];
  const positions = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
  ];
  s.players.forEach((p, index) => {
    Object.assign(p, positions[index]);
    // Entering a room reunites the party, revives fallen allies, and restores 3 HP.
    p.hp = p.abandoned ? 0 : Math.min(p.maxHp, Math.max(3, p.hp + 3));
    p.shield = 0;
    p.bonus = 0;
  });
  const spawnTiles: Position[] = [];
  const level = LEVELS[s.level];
  const tiles = level.tiles;
  for (let y = 1; y < level.height - 1; y++) {
    for (let x = 1; x < level.width - 1; x++) {
      if (
        tiles[y][x] === '.' &&
        (x > 2 || y > 2) &&
        !positions.some((p) => same(p, { x, y }))
      ) {
        spawnTiles.push({ x, y });
      }
    }
  }
  const available = shuffle(s, [...spawnTiles]);
  s.enemies = LEVELS[s.level].enemies.map((e, index) => ({
    ...e,
    ...(available[index] ?? { x: e.x, y: e.y }),
    id: `e${s.level}-${index}`,
    hp: ENEMIES[e.kind].hp,
    heading: Math.floor(random(s) * 4),
    intent: { attack: [] },
  }));
  for (let i = 1; i < s.players.length; i++) {
    const position = available[LEVELS[s.level].enemies.length + i - 1] ??
      spawnTiles[i % spawnTiles.length] ?? {
        x: Math.min(8, level.width - 2),
        y: Math.min(3, level.height - 2),
      };
    s.enemies.push({
      ...position,
      id: `e${s.level}-extra${i}`,
      kind: i % 2 ? 'chaser' : 'patroller',
      hp: 2,
      heading: 1,
      intent: { attack: [] },
    });
  }
  s.active = Math.max(
    0,
    s.players.findIndex((p) => p.hp > 0),
  );
  s.plays = 2;
  s.players.forEach((p) => draw(s, p));
  planEnemies(s);
  note(s, `Entered ${LEVELS[s.level].name}. Clear the room to open the exit.`);
}
export function createGame(
  mode: Mode,
  names: { id: string; name: string }[],
  seed = 42,
  turnOrder: TurnOrder = 'alternating',
): GameState {
  if (
    names.length < 1 ||
    names.length > 4 ||
    new Set(names.map((p) => p.id)).size !== names.length
  )
    throw new Error('A party needs 1–4 unique explorers.');
  if ((mode === 'solo' || mode === 'daily') && names.length !== 1)
    throw new Error('This mode is single player.');
  if (mode === 'duo' && names.length !== 2)
    throw new Error('Duo needs two explorers.');
  const state: GameState = {
    mode,
    turnOrder,
    seed: seed >>> 0,
    rng: seed >>> 0,
    level: 0,
    round: 1,
    turns: 1,
    active: 0,
    plays: 2,
    phase: 'playing',
    visitedRooms: [],
    roomChoices: [],
    players: [],
    enemies: [],
    log: [],
    revision: 0,
  };
  state.players = names.map((p) => ({
    ...p,
    x: 1,
    y: 1,
    hp: 12,
    maxHp: 12,
    shield: 0,
    hand: [],
    discard: [],
    bonus: 0,
    deck: shuffle(state, [
      'step1',
      'step2',
      'step2',
      'dash',
      'dash',
      'swap',
      'strike',
      'strike',
      'strike',
      'arrow',
      'arrow',
      'shield',
      'shield',
      'redraw',
      ...(names.length > 1 ? (['boost', 'taunt'] as CardId[]) : []),
    ] as CardId[]),
  }));
  loadLevel(state);
  return state;
}
function straightPath(from: Position, to: Position): Position[] {
  if (from.x !== to.x && from.y !== to.y)
    throw new Error('Choose a tile in a straight line.');
  const count = distance(from, to);
  return Array.from({ length: count }, (_, i) => ({
    x: from.x + Math.sign(to.x - from.x) * (i + 1),
    y: from.y + Math.sign(to.y - from.y) * (i + 1),
  }));
}
function play(s: GameState, index: number, target?: Position) {
  const p = activePlayer(s);
  if (!Number.isInteger(index) || !p.hand[index])
    throw new Error('Choose a card from your hand.');
  if (s.plays < 1) throw new Error('No plays left. End your turn.');
  const id = p.hand[index];
  const card = CARDS[id];
  const t =
    target ??
    (id === 'shield' || id === 'redraw' ? { x: p.x, y: p.y } : undefined);
  if (
    !t ||
    !Number.isInteger(t.x) ||
    !Number.isInteger(t.y) ||
    tileAt(s, t) === '#'
  )
    throw new Error('Choose a floor tile.');
  const enemy = enemyAt(s, t);
  const ally = livingAt(s, t);
  if (id === 'step1' || id === 'step2' || id === 'dash') {
    const path = straightPath(p, t);
    if (!path.length || path.length > card.range)
      throw new Error(`Move 1–${card.range} tiles.`);
    if (
      enemy ||
      ally ||
      path.some(
        (v) =>
          tileAt(s, v) === '#' ||
          (id !== 'dash' && (enemyAt(s, v) || livingAt(s, v))),
      )
    )
      throw new Error('That path is blocked.');
    for (const position of path) {
      Object.assign(p, position);
      if (id !== 'dash' || same(position, t)) hazard(s, p);
      if (p.hp === 0) break;
    }
  } else if (id === 'swap') {
    if (same(p, t) || (!(ally && ally.id !== p.id) && distance(p, t) !== 1))
      throw new Error('Choose an adjacent tile or a living ally.');
    const origin = { x: p.x, y: p.y };
    Object.assign(p, t);
    if (ally) {
      Object.assign(ally, origin);
      hazard(s, ally);
    }
    if (enemy) Object.assign(enemy, origin);
    hazard(s, p);
  } else if (id === 'strike' || id === 'arrow') {
    const path = straightPath(p, t);
    if (
      !enemy ||
      !path.length ||
      path.length > card.range ||
      path
        .slice(0, -1)
        .some((v) => tileAt(s, v) === '#' || enemyAt(s, v) || livingAt(s, v))
    )
      throw new Error('Choose an enemy in clear range.');
    enemy.hp -= 2;
    s.enemies = s.enemies.filter((e) => e.hp > 0);
  } else if (id === 'shield') {
    if (!ally) throw new Error('Choose yourself or a living ally.');
    if (ally.shield >= 1)
      throw new Error('That explorer already has a shield.');
    ally.shield = 1;
  } else if (id === 'boost') {
    if (!ally || ally.id === p.id) throw new Error('Choose a living ally.');
    ally.bonus = Math.min(2, ally.bonus + 1);
  } else if (id === 'taunt') {
    if (!enemy) throw new Error('Choose an enemy to challenge.');
    enemy.intent.attack = [{ x: p.x, y: p.y }];
  }
  p.hand.splice(index, 1);
  p.discard.push(id);
  if (id === 'redraw') draw(s, p);
  else s.plays--;
  note(s, `${p.name} played ${card.name}.`);
}
function enemyTurn(s: GameState) {
  for (const e of s.enemies) {
    // Resolve the exact displayed coordinates, never recalculate an attack mid-round.
    for (const p of s.players.filter((v) => v.hp > 0))
      if (e.intent.attack.some((v) => same(v, p)))
        hit(s, p, ENEMIES[e.kind].damage);
  }
  for (const e of s.enemies) {
    const next = e.intent.move;
    if (next && !livingAt(s, next) && !enemyAt(s, next)) {
      if (e.kind === 'patroller') e.heading = next.x > e.x ? 1 : 0;
      Object.assign(e, next);
    }
    if (e.kind === 'turret') e.heading = (e.heading + 1) % 4;
  }
  s.round++;
  planEnemies(s);
}
function advance(s: GameState) {
  let next = s.players.findIndex((p, i) => i > s.active && p.hp > 0);
  if (next < 0) {
    enemyTurn(s);
    next = s.players.findIndex((p) => p.hp > 0);
  }
  if (next < 0) {
    s.phase = 'lost';
    note(s, 'The hourglass runs empty. Try a new path.');
    return;
  }
  s.active = next;
  s.turns++;
  const p = activePlayer(s);
  s.plays = 2 + p.bonus;
  p.bonus = 0;
  draw(s, p);
}
function checkOutcome(s: GameState) {
  if (s.players.every((p) => p.hp <= 0)) {
    s.phase = 'lost';
    return;
  }
  if (
    s.enemies.length === 0 &&
    s.players.some((p) => p.hp > 0 && tileAt(s, p) === 'E')
  ) {
    const choices = nextRoomIds(s);
    if (choices.length === 0) {
      s.phase = 'won';
      note(s, 'You escaped the cycle.');
    } else {
      if (choices.length > 1) {
        s.phase = 'choosing';
        s.roomChoices = choices;
        note(s, `${activePlayer(s).name} chooses the party's next path.`);
      } else {
        s.level = levelIndex(choices[0]);
        loadLevel(s);
      }
    }
  }
}
export function applyAction(
  state: GameState,
  playerId: string,
  action: GameAction,
): GameState {
  if (state.phase === 'won' || state.phase === 'lost') throw new Error('This expedition has ended.');
  if (activePlayer(state).id !== playerId)
    throw new Error('Wait for your turn.');
  const s = structuredClone(state);
  if (s.phase === 'choosing') {
    if (action.type !== 'choose-room' || !s.roomChoices.includes(action.roomId)) throw new Error('Choose one of the offered paths.');
    s.level = levelIndex(action.roomId);
    loadLevel(s);
    s.revision++;
    return s;
  }
  if (action.type === 'play') play(s, action.card, action.target);
  else if (action.type === 'end') advance(s);
  else throw new Error('Unknown action.');
  checkOutcome(s);
  if (s.phase === 'playing' && activePlayer(s).hp <= 0) advance(s);
  s.revision++;
  return s;
}
export function resolveSimultaneousRound(
  state: GameState,
  actions: { playerId: string; action: GameAction }[],
): GameState {
  if (state.phase !== 'playing') throw new Error('This expedition has ended.');
  const s = structuredClone(state);
  for (const { playerId, action } of actions) {
    const index = s.players.findIndex((p) => p.id === playerId);
    if (index < 0 || s.players[index].hp <= 0) continue;
    s.active = index;
    if (action.type === 'play') {
      try {
        play(s, action.card, action.target);
      } catch {
        /* Illegal simultaneous candidate skipped gracefully */
      }
    }
  }
  enemyTurn(s);
  s.players.forEach((p) => {
    if (p.hp > 0) {
      p.bonus = 0;
      draw(s, p);
    }
  });
  s.active = Math.max(
    0,
    s.players.findIndex((p) => p.hp > 0),
  );
  s.plays = 2 + (s.players[s.active]?.bonus ?? 0);
  s.turns++;
  checkOutcome(s);
  s.revision++;
  return s;
}
export function abandonPlayer(state: GameState, playerId: string): GameState {
  const s = structuredClone(state);
  const p = s.players.find((v) => v.id === playerId);
  if (!p || s.phase === 'won' || s.phase === 'lost') return s;
  p.hp = 0;
  p.abandoned = true;
  note(s, `${p.name} left the expedition.`);
  if (s.players.every((v) => v.hp <= 0)) s.phase = 'lost';
  else if (activePlayer(s).id === playerId) {
    if (s.phase === 'choosing') s.active = s.players.findIndex(p => p.hp > 0);
    else advance(s);
  }
  s.revision++;
  return s;
}
export function legalTargets(s: GameState, card: number): Position[] {
  if (s.phase !== 'playing' || s.plays < 1) return [];
  const level = LEVELS[s.level];
  const targets: Position[] = [];
  for (let y = 0; y < level.height; y++)
    for (let x = 0; x < level.width; x++) {
      try {
        play(structuredClone(s), card, { x, y });
        targets.push({ x, y });
      } catch {
        /* Illegal previews are intentionally omitted. */
      }
    }
  return targets;
}
export function dailySeed(date: string): number {
  return [...`chrono-card:${date}`].reduce(
    (hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  );
}
