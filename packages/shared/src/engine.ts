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
  EnemyKind,
  PlayAction,
} from './types';

export const CARDS = Object.fromEntries(
  cardData.map((card) => [card.id, card]),
) as Record<CardId, Card>;
export const ENEMIES = enemyData;
export const ACTS = levelData.acts as Act[];
export const LEVELS: Level[] = ACTS.flatMap((act) =>
  act.rooms.map((lvl) => ({
    ...lvl,
    actId: act.id,
    width: lvl.tiles[0]?.length ?? 10,
    height: lvl.tiles.length,
  })),
);
export const levelIndex = (id: string) =>
  LEVELS.findIndex((level) => level.id === id);
/** Difficulty follows graph depth, never the room's position in the flat UI adapter. */
export function roomThreatBudget(level: Level, partySize: number): number {
  const act = ACTS.find((act) => act.id === level.actId)!;
  const depths = new Map<string, number>();
  const visit = (id: string, depth: number, path: Set<string>) => {
    if (path.has(id)) throw new Error('Act room graphs must be acyclic.');
    if ((depths.get(id) ?? -1) >= depth) return;
    depths.set(id, depth);
    const room = act.rooms.find((room) => room.id === id);
    if (!room) throw new Error('Room graph references an unknown room.');
    room.next.forEach((next) => visit(next, depth + 1, new Set([...path, id])));
  };
  visit(act.entry, 0, new Set());
  if (!depths.has(level.id))
    throw new Error('Room must be reachable from its Act entry.');
  const budget = act.difficulty;
  return (
    budget.baseThreat +
    depths.get(level.id)! * budget.threatPerDepth +
    Math.max(0, partySize - 1) * budget.threatPerAlly
  );
}
function encounter(s: GameState): EnemyKind[] {
  const level = LEVELS[s.level],
    act = ACTS.find((act) => act.id === level.actId)!;
  let remaining = roomThreatBudget(
    level,
    s.players.filter((p) => !p.abandoned).length,
  );
  const roster: EnemyKind[] = [];
  if (!level.next.length) {
    roster.push(act.difficulty.boss);
    remaining -= ENEMIES[act.difficulty.boss].threat;
  }
  while (remaining > 0) {
    const pool = act.difficulty.pool.filter(
      (kind) => ENEMIES[kind].threat <= remaining,
    );
    if (!pool.length)
      throw new Error('Enemy pool cannot fill the Act threat budget.');
    const kind = pool[Math.floor(random(s) * pool.length)];
    roster.push(kind);
    remaining -= ENEMIES[kind].threat;
  }
  return roster;
}
export function nextRoomIds(s: GameState): string[] {
  const level = LEVELS[s.level];
  if (level.next.length) return [...level.next];
  const act = ACTS.findIndex((act) => act.id === level.actId);
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
  (s.hazards ?? []).some(
    (hazard) => same(hazard, p) && hazard.expiresRound > s.round,
  )
    ? '~'
    : (LEVELS[s.level].tiles[p.y]?.[p.x] ?? '#');
const livingAt = (s: GameState, p: Position) =>
  s.players.find((v) => v.hp > 0 && same(v, p));
const enemyAt = (s: GameState, p: Position) =>
  s.enemies.find((v) => same(v, p));
function nearestLiving(living: Player[], pos: Position): Player | undefined {
  if (!living.length) return undefined;
  return living.reduce((a, b) => (distance(pos, a) <= distance(pos, b) ? a : b));
}
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
    if (e.intent.charging) {
      // Keep exactly the same coordinates for the second announced round.
      e.intent.charging = false;
      continue;
    }
    e.intent = { attack: [] };
    if (e.kind === 'bomber') {
      const nearest = nearestLiving(living, e);
      if (nearest && LEVELS[s.level].tiles[nearest.y][nearest.x] !== 'E')
        e.intent.hazard = [{ x: nearest.x, y: nearest.y }];
    } else if (e.kind === 'turret') {
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
      const nearest = nearestLiving(living, e);
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
        const nearest = nearestLiving(living, e);
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
    if (e.kind === 'chaser_elite' || e.kind === 'warden_elite')
      e.intent.charging = true;
  }
}
function loadLevel(s: GameState) {
  s.hazards = [];
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
  const roster = encounter(s);
  if (roster.length > available.length)
    throw new Error('Room has insufficient floor space for its threat budget.');
  s.enemies = roster.map((kind, index) => ({
    kind,
    ...available[index],
    id: `e${s.level}-${index}`,
    hp: ENEMIES[kind].hp,
    heading: Math.floor(random(s) * 4),
    intent: { attack: [] },
  }));
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
    draftChoices: {},
    hazards: [],
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
  const id = p.hand[index];
  const card = CARDS[id];
  if (s.plays < (card.cost ?? 1))
    throw new Error('No plays left. End your turn.');
  if ((p.cooldowns?.[id] ?? 0) > s.round)
    throw new Error('This card is recharging.');
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
  if (id === 'blink') {
    if (same(p, t) || distance(p, t) > card.range || enemy || ally)
      throw new Error('Choose an empty tile within 2 steps.');
    Object.assign(p, t);
    hazard(s, p);
  } else if (id === 'cleave') {
    if (!same(p, t) || !s.enemies.some((e) => distance(p, e) === 1))
      throw new Error('Stand beside an enemy and target yourself.');
    s.enemies.forEach((e) => {
      if (distance(p, e) === 1) e.hp -= 2;
    });
    s.enemies = s.enemies.filter((e) => e.hp > 0);
  } else if (id === 'forge') {
    const pile = [p.hand, p.deck, p.discard].find((pile) =>
      pile.includes('strike'),
    );
    if (!same(p, t) || !pile)
      throw new Error('Target yourself with an Iron edge still in your deck.');
    pile[pile.indexOf('strike')] = 'strike_plus';
  } else if (id === 'mend') {
    if (!ally || ally.hp >= ally.maxHp)
      throw new Error('Choose an injured living explorer.');
    ally.hp = Math.min(ally.maxHp, ally.hp + 3);
  } else if (id === 'step1' || id === 'step2' || id === 'dash') {
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
    if (enemy) {
      Object.assign(enemy, origin);
      if (tileAt(s, origin) === '~') {
        enemy.hp -= 1;
        note(s, `${ENEMIES[enemy.kind].name} takes hazard damage.`);
        s.enemies = s.enemies.filter((e) => e.hp > 0);
      }
    }
    hazard(s, p);
  } else if (
    id === 'strike' ||
    id === 'arrow' ||
    id === 'strike_plus' ||
    id === 'quickshot'
  ) {
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
    enemy.hp -= id === 'strike_plus' ? 3 : id === 'quickshot' ? 1 : 2;
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
    if (enemy.kind === 'bomber') enemy.intent.hazard = [{ x: p.x, y: p.y }];
    else enemy.intent.attack = [{ x: p.x, y: p.y }];
  }
  p.hand.splice(index, 1);
  p.discard.push(id);
  if (id === 'redraw') draw(s, p);
  else s.plays -= card.cost ?? 1;
  if (card.cooldown) (p.cooldowns ??= {})[id] = s.round + card.cooldown;
  note(s, `${p.name} played ${card.name}.`);
}
function enemyTurn(s: GameState) {
  s.hazards = (s.hazards ?? []).filter(
    (hazard) => hazard.expiresRound > s.round + 1,
  );
  for (const e of s.enemies) {
    if (e.intent.charging) continue;
    for (const target of e.intent.hazard ?? []) {
      if (
        LEVELS[s.level].tiles[target.y]?.[target.x] !== '.' &&
        LEVELS[s.level].tiles[target.y]?.[target.x] !== '~'
      )
        continue;
      const existing = s.hazards.find((hazard) => same(hazard, target));
      if (existing) existing.expiresRound = s.round + 4;
      else s.hazards.push({ ...target, expiresRound: s.round + 4 });
    }
    // Resolve the exact displayed coordinates, never recalculate an attack mid-round.
    for (const p of s.players.filter((v) => v.hp > 0))
      if (e.intent.attack.some((v) => same(v, p)))
        hit(s, p, ENEMIES[e.kind].damage);
  }
  for (const e of s.enemies) {
    if (e.intent.charging) continue;
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
function finishDraft(s: GameState) {
  const next = s.players.findIndex(
    (p) => !p.abandoned && s.draftChoices[p.id]?.length,
  );
  if (next >= 0) {
    s.active = next;
    return;
  }
  s.draftChoices = {};
  const choices = nextRoomIds(s);
  if (choices.length > 1) {
    s.phase = 'choosing';
    s.roomChoices = choices;
    s.active = s.players.findIndex((p) => p.hp > 0);
  } else {
    s.level = levelIndex(choices[0]);
    loadLevel(s);
  }
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
      s.phase = 'drafting';
      const pool = Object.values(CARDS)
        .filter((card) => card.draft)
        .map((card) => card.id);
      s.draftChoices = Object.fromEntries(
        s.players
          .filter((p) => !p.abandoned)
          .map((p) => [p.id, shuffle(s, [...pool]).slice(0, 3)]),
      );
      finishDraft(s);
      note(s, 'Room cleared. Each explorer may keep one new card.');
    }
  }
}
export function applyAction(
  state: GameState,
  playerId: string,
  action: GameAction,
): GameState {
  if (state.phase === 'won' || state.phase === 'lost')
    throw new Error('This expedition has ended.');
  if (activePlayer(state).id !== playerId)
    throw new Error('Wait for your turn.');
  const s = structuredClone(state);
  if (s.phase === 'drafting') {
    const p = activePlayer(s);
    if (
      action.type !== 'draft-card' ||
      !s.draftChoices[p.id]?.includes(action.cardId)
    )
      throw new Error('Choose one of your offered cards.');
    p.discard.push(action.cardId);
    delete s.draftChoices[p.id];
    note(s, `${p.name} drafted ${CARDS[action.cardId].name}.`);
    finishDraft(s);
    s.revision++;
    return s;
  }
  if (s.phase === 'choosing') {
    if (action.type !== 'choose-room' || !s.roomChoices.includes(action.roomId))
      throw new Error('Choose one of the offered paths.');
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
/** Preview a whole plan without advancing enemies, room progression, or the shared revision. */
export function previewSimultaneousTurn(
  state: GameState,
  playerId: string,
  actions: PlayAction[],
): GameState {
  if (state.phase !== 'playing' || state.turnOrder !== 'simultaneous')
    throw new Error('No simultaneous turn is pending.');
  const s = structuredClone(state),
    index = s.players.findIndex(
      (p) => p.id === playerId && p.hp > 0 && !p.abandoned,
    );
  if (index < 0) throw new Error('Only living explorers can submit a turn.');
  if (actions.length > 32)
    throw new Error('A plan may contain at most 32 card plays.');
  s.active = index;
  s.plays = 2 + s.players[index].bonus;
  s.players[index].bonus = 0;
  s.rng = (state.rng ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  const planned = actions.map(a => ({ cardId: s.players[index].hand[a.card], target: a.target }));
  for (const action of planned) {
    if (activePlayer(s).hp <= 0) throw new Error('This explorer has fallen.');
    const idx = activePlayer(s).hand.indexOf(action.cardId);
    if (idx >= 0) play(s, idx, action.target);
  }
  return s;
}
export function resolveSimultaneousRound(
  state: GameState,
  actions: { playerId: string; action: GameAction }[],
): GameState {
  if (state.phase !== 'playing') throw new Error('This expedition has ended.');
  let s = structuredClone(state);
  const budgets = s.players.map((p) => 2 + p.bonus);
  s.players.forEach((p) => {
    p.bonus = 0;
  });
  // Resolve in party order, independently of packet arrival order.
  for (let index = 0; index < s.players.length; index++) {
    const player = s.players[index];
    if (player.hp <= 0 || player.abandoned) continue;
    const submitted = actions.find(
      (item) => item.playerId === player.id,
    )?.action;
    const plan =
      submitted?.type === 'submit-turn'
        ? submitted.actions
        : submitted?.type === 'play'
          ? [submitted]
          : [];
    s.active = index;
    s.plays = budgets[index];
    s.rng = (state.rng ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
    const planned = plan.slice(0, 32).map(a => ({ cardId: activePlayer(s).hand[a.card], target: a.target }));
    for (const action of planned) {
      if (activePlayer(s).hp <= 0) break;
      const idx = activePlayer(s).hand.indexOf(action.cardId);
      if (idx < 0) continue;
      try {
        const candidate = structuredClone(s);
        play(candidate, idx, action.target);
        s = candidate;
      } catch {
        // A collision spends/discards that card so later planned hand indices stay valid.
        const p = activePlayer(s),
          id = p.hand[idx];
        if (id) {
          p.hand.splice(idx, 1);
          p.discard.push(id);
          s.plays = Math.max(0, s.plays - (CARDS[id].cost ?? 1));
        }
        note(s, `${player.name}'s planned card no longer has a valid target.`);
      }
    }
  }
  checkOutcome(s);
  if (s.phase !== 'playing') {
    s.revision++;
    return s;
  }
  enemyTurn(s);
  s.players.forEach((p) => {
    if (p.hp > 0) {
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
    if (s.phase === 'drafting') finishDraft(s);
    else if (s.phase === 'choosing')
      s.active = s.players.findIndex((p) => p.hp > 0);
    else if (s.turnOrder === 'simultaneous')
      s.active = s.players.findIndex((p) => p.hp > 0);
    else advance(s);
  }
  s.revision++;
  return s;
}
export function legalTargets(s: GameState, card: number): Position[] {
  if (s.phase !== 'playing') return [];
  const level = LEVELS[s.level];
  const p = activePlayer(s);
  if (!Number.isInteger(card) || !p.hand[card]) return [];
  const id = p.hand[card];
  const c = CARDS[id];
  if (s.plays < (c.cost ?? 1)) return [];
  if ((p.cooldowns?.[id] ?? 0) > s.round) return [];
  const targets: Position[] = [];
  for (let y = 0; y < level.height; y++)
    for (let x = 0; x < level.width; x++) {
      const t = { x, y };
      // Skip walls early
      if (tileAt(s, t) === '#') continue;
      // Skip tiles out of card range (Manhattan distance)
      if (c.range > 0 && distance(p, t) > c.range) continue;
      try {
        play(structuredClone(s), card, t);
        targets.push(t);
      } catch {
        /* skip */
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
