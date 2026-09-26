import {
  CARDS,
  ENEMIES,
  LEVELS,
  nextRoomIds,
  type GameState,
  type GameAction,
} from '@chrono/shared';
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown, min = 0, max = 1_000_000_000): v is number =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const text = (v: unknown, max = 128): v is string =>
  typeof v === 'string' && v.length <= max;
const cards = (v: unknown, max: number) =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every((id) => typeof id === 'string' && Object.hasOwn(CARDS, id));
export function validAction(v: unknown): v is GameAction {
  if (!object(v)) return false;
  if (v.type === 'end') return true;
  if (v.type === 'play')
    return (
      integer(v.card, 0, 4) &&
      (v.target === undefined ||
        (object(v.target) &&
          integer(v.target.x, 0, 30) &&
          integer(v.target.y, 0, 30)))
    );
  if (v.type === 'choose-room') return LEVELS.some((l) => l.id === v.roomId);
  return (
    v.type === 'draft-card' &&
    typeof v.cardId === 'string' &&
    Object.hasOwn(CARDS, v.cardId)
  );
}
/** Browser data is untrusted and may be from an older release. Invalid saves fall back safely. */
export function restoreLocalGame(value: unknown): GameState | null {
  if (
    !object(value) ||
    !['solo', 'duo'].includes(String(value.mode)) ||
    !integer(value.level, 0, LEVELS.length - 1)
  )
    return null;
  const level = LEVELS[value.level];
  const pos = (p: unknown) =>
    object(p) &&
    integer(p.x, 0, level.width - 1) &&
    integer(p.y, 0, level.height - 1);
  const floor = (p: Record<string, unknown>) =>
    pos(p) && level.tiles[Number(p.y)][Number(p.x)] !== '#';
  if (
    !Array.isArray(value.players) ||
    value.players.length !== (value.mode === 'solo' ? 1 : 2) ||
    !integer(value.active, 0, value.players.length - 1)
  )
    return null;
  if (
    !value.players.every(
      (p) =>
        object(p) &&
        floor(p) &&
        text(p.id) &&
        p.id.length > 0 &&
        text(p.name) &&
        integer(p.hp, 0, 100) &&
        integer(p.maxHp, 1, 100) &&
        p.hp <= p.maxHp &&
        integer(p.shield, 0, 1) &&
        integer(p.bonus, 0, 2) &&
        cards(p.hand, 5) &&
        cards(p.deck, 256) &&
        cards(p.discard, 256) &&
        (p.cooldowns === undefined ||
          (object(p.cooldowns) &&
            Object.entries(p.cooldowns).every(
              ([id, round]) => Object.hasOwn(CARDS, id) && integer(round),
            ))),
    )
  )
    return null;
  if (new Set(value.players.map((p) => p.id)).size !== value.players.length)
    return null;
  if (
    !Array.isArray(value.enemies) ||
    value.enemies.length > 100 ||
    !value.enemies.every(
      (e) =>
        object(e) &&
        floor(e) &&
        text(e.id) &&
        typeof e.kind === 'string' &&
        Object.hasOwn(ENEMIES, e.kind) &&
        integer(e.hp, 1, 100) &&
        integer(e.heading, 0, 3) &&
        object(e.intent) &&
        Array.isArray(e.intent.attack) &&
        e.intent.attack.length <= 64 &&
        e.intent.attack.every(pos) &&
        (e.intent.move === undefined || pos(e.intent.move)) &&
        (e.intent.hazard === undefined ||
          (Array.isArray(e.intent.hazard) &&
            e.intent.hazard.length <= 64 &&
            e.intent.hazard.every(pos))) &&
        (e.intent.charging === undefined ||
          typeof e.intent.charging === 'boolean'),
    )
  )
    return null;
  if (
    !integer(value.seed, 0, 0xffffffff) ||
    !integer(value.rng, 0, 0xffffffff) ||
    !integer(value.round, 1) ||
    !integer(value.turns, 1) ||
    !integer(value.revision) ||
    !integer(value.plays, 0, 4) ||
    !['playing', 'drafting', 'choosing', 'won', 'lost'].includes(
      String(value.phase),
    )
  )
    return null;
  if (
    !Array.isArray(value.log) ||
    value.log.length > 50 ||
    !value.log.every((line) => text(line, 1000))
  )
    return null;
  const s = structuredClone({
    ...value,
    hazards: value.hazards ?? [],
    visitedRooms: value.visitedRooms ?? [],
    roomChoices: value.roomChoices ?? [],
    draftChoices: value.draftChoices ?? {},
  }) as GameState;
  if (
    !Array.isArray(s.hazards) ||
    s.hazards.length > level.width * level.height ||
    !s.hazards.every((h) => pos(h) && integer(h.expiresRound))
  )
    return null;
  if (
    !Array.isArray(s.visitedRooms) ||
    !s.visitedRooms.every((id) => LEVELS.some((l) => l.id === id))
  )
    return null;
  if (
    !Array.isArray(s.roomChoices) ||
    !s.roomChoices.every((id) => LEVELS.some((l) => l.id === id))
  )
    return null;
  if (
    !object(s.draftChoices) ||
    !Object.entries(s.draftChoices).every(
      ([id, offers]) => s.players.some((p) => p.id === id) && cards(offers, 3),
    )
  )
    return null;
  if (s.phase === 'drafting' && !s.draftChoices[s.players[s.active].id]?.length)
    return null;
  if (
    s.phase === 'choosing' &&
    (!s.roomChoices.length ||
      s.roomChoices.some((id) => !nextRoomIds(s).includes(id)))
  )
    return null;
  return s;
}
