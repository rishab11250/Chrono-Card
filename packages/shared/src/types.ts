export type StatusType = 'poison' | 'stun';
export type StatusEffect = { type: StatusType; rounds: number };
export type Position = { x: number; y: number };
export type CardId =
  | 'shockwave'
  | 'chain_spark'
  | 'snare'
  | 'step1'
  | 'step2'
  | 'dash'
  | 'swap'
  | 'strike'
  | 'arrow'
  | 'arrow_plus'
  | 'shield'
  | 'shield_plus'
  | 'redraw'
  | 'boost'
  | 'taunt'
  | 'blink'
  | 'cleave'
  | 'quickshot'
  | 'mend'
  | 'forge'
  | 'strike_plus'
  | 'step3'
  | 'pierce'
  | 'time_rewind'
  | 'decoy';
export type Card = {
  id: CardId;
  name: string;
  category: 'move' | 'attack' | 'support';
  icon: string;
  description: string;
  range: number;
  coop?: boolean;
  draft?: boolean;
  cost?: number;
  cooldown?: number;
};
export type EnemyKind =
  | 'turret'
  | 'patroller'
  | 'chaser'
  | 'warden_elite'
  | 'bomber'
  | 'chaser_elite'
  | 'healer'
  | 'shield_bearer'
  | 'teleporter'
  | 'summoner';
export type EnemyIntent = {
  attack: Position[];
  move?: Position;
  hazard?: Position[];
  charging?: boolean;
  heal?: Position;
  shield?: Position[];
  summon?: Position;
};
export type TemporaryHazard = Position & { expiresRound: number };
export type Enemy = Position & {
  id: string;
  kind: EnemyKind;
  hp: number;
  heading: number;
  intent: EnemyIntent;
  statuses?: StatusEffect[];
  shield?: number;
};
export type Level = {
  actId: string;
  next: string[];
  choiceDescription: string;
  id: string;
  name: string;
  subtitle: string;
  tiles: string[];
  width: number;
  height: number;
};
export type Act = {
  id: string;
  name: string;
  entry: string;
  difficulty: {
    baseThreat: number;
    threatPerDepth: number;
    threatPerAlly: number;
    pool: EnemyKind[];
    boss: EnemyKind;
  };
  rooms: Omit<Level, 'width' | 'height' | 'actId'>[];
};
export type RelicId =
  'iron_heart' | 'swift_boots' | 'ember_shield' | 'sharp_edge' | 'deep_pockets';
export type Relic = {
  id: RelicId;
  name: string;
  icon: string;
  description: string;
};
export type Player = Position & {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  shield: number;
  hand: CardId[];
  deck: CardId[];
  discard: CardId[];
  bonus: number;
  cooldowns?: Partial<Record<CardId, number>>;
  abandoned?: boolean;
  relics?: RelicId[];
  statuses?: StatusEffect[];
  lastCardCategory?: 'move' | 'attack' | 'support';
};
export type Decoy = Position & {
  id: string;
  kind?: 'decoy';
  hp: number;
  maxHp: number;
};
export type TurnOrder = 'alternating' | 'simultaneous';
export type Mode = 'solo' | 'duo' | 'party' | 'daily';
export type GameState = {
  mode: Mode;
  turnOrder?: TurnOrder;
  seed: number;
  rng: number;
  level: number;
  round: number;
  turns: number;
  active: number;
  plays: number;
  phase: 'playing' | 'choosing' | 'drafting' | 'won' | 'lost';
  draftChoices: Record<string, CardId[]>;
  relicChoices?: Record<string, RelicId[]>;
  visitedRooms: string[];
  roomChoices: string[];
  hazards: TemporaryHazard[];
  decoys?: Decoy[];
  players: Player[];
  enemies: Enemy[];
  log: string[];
  revision: number;
  tiles?: string[];
};
export type PlayAction = { type: 'play'; card: number; target?: Position };
export type GameAction =
  | PlayAction
  | { type: 'submit-turn'; actions: PlayAction[] }
  | { type: 'end' }
  | { type: 'choose-room'; roomId: string }
  | { type: 'draft-card'; cardId: CardId }
  | { type: 'pick-relic'; relicId: RelicId };
export type Member = {
  id: string;
  name: string;
  connected: boolean;
  cosmetic?: string;
};
export type RoomView = {
  code: string;
  mode: Mode;
  turnOrder?: TurnOrder;
  host: string;
  members: Member[];
  game: GameState | null;
  spectators: number;
  paused: boolean;
  graceSeconds: number;
  submittedPlayers?: string[];
};
export type Session = { code: string; token: string; playerId: string };
export type Reply<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string };
export type LeaderboardEntry = {
  name: string;
  turns: number;
  seconds: number;
  date: string;
};
export interface ClientEvents {
  'room:create': (
    input: {
      name: string;
      mode: 'duo' | 'party' | 'daily';
      turnOrder?: TurnOrder;
      cosmetic?: string;
    },
    ack: (result: Reply<Session>) => void,
  ) => void;
  'room:join': (
    input: { name: string; code: string; cosmetic?: string },
    ack: (result: Reply<Session>) => void,
  ) => void;
  'room:resume': (
    input: Session,
    ack: (result: Reply<Session>) => void,
  ) => void;
  'room:watch': (input: { code: string }, ack: (result: Reply) => void) => void;
  'room:start': (ack: (result: Reply) => void) => void;
  'room:leave': (ack: (result: Reply) => void) => void;
  'game:action': (
    input: { action: GameAction; revision: number },
    ack: (result: Reply) => void,
  ) => void;
  'room:emote': (
    input: { emote: string },
    ack: (result: Reply) => void,
  ) => void;
}
export interface ServerEvents {
  'room:state': (room: RoomView) => void;
  'room:closed': (reason: string) => void;
  'room:emote': (data: { playerId: string; emote: string }) => void;
}

export type UserStats = {
  runsPlayed: number;
  runsWon: number;
  dailyWins: number;
  bestTurns: number;
};

export type UserProfile = {
  id: string;
  username: string;
  avatar: string;
  createdAt: string;
  stats: UserStats;
  achievements?: { id: string; date: string }[];
};

export type AuthResponse = {
  token: string;
  user: UserProfile;
};

export type EventId = 'shrine_of_vitality' | 'time_forge' | 'curious_merchant';

export type EventDefinition = {
  id: EventId;
  name: string;
  description: string;
  effect: 'heal_3' | 'upgrade_card' | 'trade_hp_for_relic' | string;
};

export type MutatorId = 'dense_fog' | 'unstable_ground' | 'temporal_surge';

export type MutatorDefinition = {
  id: MutatorId;
  name: string;
  description: string;
};

export type ScoreDetails = {
  roomsCleared?: number;
  turns?: number;
  noDamageRooms?: number;
  relicsCount?: number;
  multiplier?: number;
};
