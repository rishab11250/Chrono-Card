import eventsData from './events.json';
import mutatorsData from './mutators.json';
import relicsData from './relics.json';
import levelData from './levels.json';
import type {
  Act,
  EventDefinition,
  EventId,
  GameState,
  Level,
  MutatorDefinition,
  MutatorId,
  Position,
  RelicId,
  ScoreDetails,
} from './types';

const ACTS = levelData.acts as Act[];
const LEVELS: Level[] = ACTS.flatMap((act) =>
  act.rooms.map((lvl) => ({
    ...lvl,
    actId: act.id,
    width: lvl.tiles[0]?.length ?? 10,
    height: lvl.tiles.length,
  })),
);

export const EVENT_DEFINITIONS = eventsData as Record<EventId, EventDefinition>;
export const MUTATORS = mutatorsData as Record<MutatorId, MutatorDefinition>;

export const CARDINAL_DIRECTIONS: Position[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/**
 * Calculates the run score based on rooms cleared, turns taken,
 * no-damage rooms, and relics collected, with an optional multiplier.
 * baseScore = (roomsCleared * 1000) - (turns * 10) + (noDamageRooms * 250) + (relicsCount * 100)
 */
export function calculateScore(
  state?: GameState | null,
  details?: ScoreDetails,
): number {
  const roomsCleared =
    details?.roomsCleared ??
    (state?.visitedRooms ? state.visitedRooms.length : 0);
  const turns = details?.turns ?? state?.turns ?? 0;
  const noDamageRooms = details?.noDamageRooms ?? 0;
  const relicsCount =
    details?.relicsCount ??
    (state?.players ?? []).reduce(
      (sum, p) => sum + (p.relics ? p.relics.length : 0),
      0,
    );
  const multiplier = details?.multiplier ?? 1;

  const baseScore =
    roomsCleared * 1000 - turns * 10 + noDamageRooms * 250 + relicsCount * 100;

  return Math.round(baseScore * multiplier);
}

/**
 * Breaks a breakable wall tile 'B' at pos or adjacent to pos into floor '.'.
 * Returns true if at least one breakable wall was broken.
 */
export function handleBreakableWall(state: GameState, pos: Position): boolean {
  if (!state.tiles && state.level !== undefined && LEVELS[state.level]) {
    state.tiles = [...LEVELS[state.level].tiles];
  }
  if (!state.tiles) return false;

  let broken = false;
  const breakTile = (p: Position) => {
    if (state.tiles && state.tiles[p.y]?.[p.x] === 'B') {
      const row = state.tiles[p.y];
      state.tiles[p.y] = row.substring(0, p.x) + '.' + row.substring(p.x + 1);
      broken = true;
    }
  };

  breakTile(pos);
  for (const d of CARDINAL_DIRECTIONS) {
    breakTile({ x: pos.x + d.x, y: pos.y + d.y });
  }

  return broken;
}

/**
 * Applies the effect of a random event to the active player or specified player.
 */
export function applyEventEffect(
  state: GameState,
  eventId: EventId,
  playerId?: string,
): { ok: boolean; message: string } {
  const p = playerId
    ? state.players.find((player) => player.id === playerId)
    : (state.players[state.active] ??
      state.players.find((player) => player.hp > 0));

  if (!p) return { ok: false, message: 'No living explorer found.' };

  const event = EVENT_DEFINITIONS[eventId];
  if (!event) return { ok: false, message: `Unknown event: ${eventId}` };

  if (event.effect === 'heal_3') {
    const prev = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + 3);
    return {
      ok: true,
      message: `${p.name} healed from ${prev} to ${p.hp} HP.`,
    };
  }

  if (event.effect === 'upgrade_card') {
    const pile = [p.hand, p.deck, p.discard].find((cards) =>
      cards.includes('strike'),
    );
    if (pile) {
      const idx = pile.indexOf('strike');
      pile[idx] = 'strike_plus';
      return {
        ok: true,
        message: `${p.name} upgraded Iron edge to Iron edge+.`,
      };
    }
    return { ok: false, message: 'No upgradeable card found in deck.' };
  }

  if (event.effect === 'trade_hp_for_relic') {
    if (p.hp <= 3) {
      return {
        ok: false,
        message: `${p.name} does not have enough HP to trade.`,
      };
    }
    p.hp -= 3;
    const owned = p.relics ?? [];
    const available = (relicsData as { id: RelicId }[])
      .map((r) => r.id)
      .filter((id) => !owned.includes(id));
    if (available.length > 0) {
      const relic = available[0];
      p.relics = [...owned, relic];
      return { ok: true, message: `${p.name} traded 3 HP for ${relic}.` };
    }
    return { ok: true, message: `${p.name} traded 3 HP.` };
  }

  return { ok: false, message: `Unknown effect: ${event.effect}` };
}

/**
 * Calculates modified projectile range under mutators like dense_fog.
 */
export function applyFogRange(
  range: number,
  activeMutators: MutatorId[] = [],
): number {
  if (activeMutators.includes('dense_fog') && range > 0) {
    return Math.max(1, range - 1);
  }
  return range;
}

/**
 * Calculates hazard damage under mutators like unstable_ground.
 */
export function getHazardDamage(activeMutators: MutatorId[] = []): number {
  return activeMutators.includes('unstable_ground') ? 2 : 1;
}

/**
 * Calculates starting plays on round 1 of each room under mutators like temporal_surge.
 */
export function getStartingPlays(
  round: number,
  activeMutators: MutatorId[] = [],
): number {
  if (round === 1 && activeMutators.includes('temporal_surge')) {
    return 3;
  }
  return 2;
}
