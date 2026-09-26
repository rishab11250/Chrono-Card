import express from 'express';
import { createServer } from 'node:http';
import {
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import {
  abandonPlayer,
  activePlayer,
  applyAction,
  createGame,
  dailySeed,
  CARDS,
  type CardId,
  resolveSimultaneousRound,
  previewSimultaneousTurn,
  type ClientEvents,
  type GameAction,
  type GameState,
  type Member,
  type Mode,
  type Reply,
  type RoomView,
  type ServerEvents,
  type TurnOrder,
  type UserProfile,
} from '@chrono/shared';
import { persistence, type StoredUser } from './persistence';
import { createAuth, hashPassword, verifyPassword } from './auth';

type StoredMember = Member & {
  token: string;
  disconnectedAt: number | null;
  forfeited: boolean;
};
type Room = {
  code: string;
  mode: Mode;
  turnOrder: TurnOrder;
  pendingActions: Map<string, GameAction>;
  host: string;
  members: StoredMember[];
  game: GameState | null;
  startedAt: number;
  date: string;
  touchedAt: number;
  runId: string;
};
type SocketData = {
  code?: string;
  playerId?: string;
  spectator?: boolean;
  requests?: { time: number; count: number };
};
type GameSocket = Socket<
  ClientEvents,
  ServerEvents,
  Record<string, never>,
  SocketData
>;
type Ack = (result: Reply<unknown>) => void;
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(
    /^[\p{L}\p{N} _.-]+$/u,
    'Use letters, numbers, spaces, dots, or dashes.',
  );
const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-9]{6}$/);
const actionSchema = z
  .object({
    revision: z.number().int().min(0),
    action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('end') }).strict(),
      z
        .object({
          type: z.literal('submit-turn'),
          actions: z
            .array(
              z
                .object({
                  type: z.literal('play'),
                  card: z.number().int().min(0).max(6),
                  target: z
                    .object({
                      x: z.number().int().min(0).max(30),
                      y: z.number().int().min(0).max(30),
                    })
                    .strict()
                    .optional(),
                })
                .strict(),
            )
            .max(32),
        })
        .strict(),
      z
        .object({
          type: z.literal('choose-room'),
          roomId: z.string().min(1).max(60),
        })
        .strict(),
      z
        .object({
          type: z.literal('draft-card'),
          cardId: z.enum(Object.keys(CARDS) as [CardId, ...CardId[]]),
        })
        .strict(),
      z
        .object({
          type: z.literal('pick-relic'),
          relicId: z.enum([
            'iron_heart',
            'swift_boots',
            'ember_shield',
            'sharp_edge',
            'deep_pockets',
          ]),
        })
        .strict(),
      z
        .object({
          type: z.literal('play'),
          card: z.number().int().min(0).max(6),
          target: z
            .object({
              x: z.number().int().min(0).max(30),
              y: z.number().int().min(0).max(30),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ]),
  })
  .strict();
const emoteSchema = z
  .object({
    emote: z.string().min(1).max(50),
  })
  .strict();
const registerSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters.')
      .max(20, 'Username must be at most 20 characters.')
      .regex(
        /^[a-zA-Z0-9_]+$/,
        'Username must only contain letters, numbers, and underscores.',
      ),
    password: z
      .string()
      .min(6, 'Password must be at least 6 characters.')
      .max(100),
    avatar: z.string().trim().max(30).optional(),
  })
  .strict();
const loginSchema = z
  .object({
    username: z.string().trim().min(1).max(20),
    password: z.string().min(1).max(100),
  })
  .strict();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () =>
  Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(
    '',
  );
const utcDate = () => new Date().toISOString().slice(0, 10);

export async function createApp(
  options: {
    database?: string;
    redisUrl?: string;
    graceMs?: number;
    clientOrigin?: string;
    eventLimit?: number;
    authLimit?: number;
  } = {},
) {
  const app = express();
  const { createToken, verifyToken } = createAuth();
  const httpLimits = new Map<string, { time: number; count: number }>();
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10)
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  app.set('trust proxy', proxyHops);
  app.disable('x-powered-by');
  const http = createServer(app);
  const origins = (
    options.clientOrigin ??
    process.env.CLIENT_ORIGIN ??
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001'
  )
    .split(',')
    .map((s) => s.trim());
  const allowed = (origin: string | undefined) => {
    if (!origin) return true;
    if (origins.includes(origin)) return true;
    if (
      process.env.RENDER_EXTERNAL_URL &&
      origin === process.env.RENDER_EXTERNAL_URL
    )
      return true;
    try {
      const url = new URL(origin);
      if (
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname.endsWith('.onrender.com') ||
        url.hostname.endsWith('.vercel.app')
      ) {
        return true;
      }
    } catch {
      /* Invalid origin string */
    }
    return false;
  };
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    );
    if (req.path.startsWith('/api/')) {
      if (req.path.startsWith('/api/auth'))
        res.setHeader('Cache-Control', 'no-store');
      if (!allowed(origin)) {
        res.status(403).json({ error: 'Origin not allowed.' });
        return;
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization',
        );
        res.sendStatus(204);
        return;
      }
      if (req.method === 'POST') {
        const authAttempt =
          req.path === '/api/auth/login' || req.path === '/api/auth/register';
        const key = `${authAttempt ? 'auth' : 'write'}:${req.ip ?? req.socket.remoteAddress}`;
        const now = Date.now(),
          previous = httpLimits.get(key);
        const entry =
          previous && now - previous.time < 60_000
            ? previous
            : { time: now, count: 0 };
        if (entry.count++ >= (authAttempt ? (options.authLimit ?? 20) : 60)) {
          res.setHeader(
            'Retry-After',
            String(Math.max(1, Math.ceil((60_000 - now + entry.time) / 1000))),
          );
          res
            .status(429)
            .json({ error: 'Too many requests. Try again in a minute.' });
          return;
        }
        if (httpLimits.size >= 10_000 && !httpLimits.has(key)) {
          res.status(503).json({ error: 'Server is busy. Try again shortly.' });
          return;
        }
        httpLimits.set(key, entry);
      } else if (
        req.method === 'GET' &&
        (req.path.startsWith('/api/users') ||
          /^\/api\/rooms\/[A-Z2-9]{6}$/.test(req.path))
      ) {
        const key = `read:${req.ip ?? req.socket.remoteAddress}`;
        const now = Date.now(),
          previous = httpLimits.get(key);
        const entry =
          previous && now - previous.time < 60_000
            ? previous
            : { time: now, count: 0 };
        if (entry.count++ >= 120) {
          res.setHeader(
            'Retry-After',
            String(Math.max(1, Math.ceil((60_000 - now + entry.time) / 1000))),
          );
          res
            .status(429)
            .json({ error: 'Too many requests. Try again in a minute.' });
          return;
        }
        httpLimits.set(key, entry);
      }
    }
    next();
  });
  const io = new Server<
    ClientEvents,
    ServerEvents,
    Record<string, never>,
    SocketData
  >(http, {
    cors: {
      origin: (origin, callback) => callback(null, allowed(origin)),
    },
    allowRequest: (req, cb) => cb(null, allowed(req.headers.origin)),
    maxHttpBufferSize: 8192,
  });
  const storage = await persistence({
    database: options.database,
    redisUrl: options.redisUrl ?? process.env.REDIS_URL,
  });
  const rooms = new Map<string, Room>();
  const pendingLoads = new Map<string, Promise<Room>>();
  const reservedCodes = new Set<string>();
  const graceMs = options.graceMs ?? 90_000;
  const maxRooms = 500;
  let houseTimer: ReturnType<typeof setTimeout> | undefined;
  async function getRoom(code: string): Promise<Room> {
    const current = rooms.get(code);
    if (current) return current;
    const pending = pendingLoads.get(code);
    if (pending) return pending;
    const task = (async () => {
      const saved = await storage.load(code);
      if (!saved)
        throw new Error(
          'Room not found. Check the code or create a new expedition.',
        );
      if (rooms.size >= maxRooms)
        throw new Error('The server is full. Try again shortly.');
      const room = JSON.parse(saved) as Room & {
        pendingPlans?: [string, GameAction][];
      };
      room.turnOrder = room.turnOrder ?? 'alternating';
      room.pendingActions = new Map(room.pendingPlans ?? []);
      delete room.pendingPlans;
      if (Date.now() - room.touchedAt > 7_200_000)
        throw new Error('This room has expired.');
      room.members.forEach((m) => {
        m.connected = false;
        m.disconnectedAt = Date.now();
      });
      rooms.set(code, room);
      return room;
    })();
    pendingLoads.set(code, task);
    try {
      return await task;
    } finally {
      pendingLoads.delete(code);
    }
  }
  function paused(room: Room) {
    if (!room.game || room.game.phase === 'won' || room.game.phase === 'lost')
      return false;
    // Simultaneous rounds resolve on their own once every connected member has
    // submitted; only a still-claimed alternating turn should hold everyone.
    if (room.turnOrder === 'simultaneous') return false;
    const current = room.members.find(
      (m) => m.id === activePlayer(room.game!).id,
    );
    return Boolean(current && !current.connected && !current.forfeited);
  }
  function view(room: Room): RoomView {
    const sockets = io.sockets.adapter.rooms.get(room.code);
    return {
      code: room.code,
      mode: room.mode,
      turnOrder: room.turnOrder,
      host: room.host,
      members: room.members.map(({ id, name, connected, cosmetic }) => ({
        id,
        name,
        connected,
        cosmetic,
      })),
      game: room.game,
      paused: paused(room),
      graceSeconds: Math.ceil(graceMs / 1000),
      submittedPlayers: [...room.pendingActions.keys()],
      spectators: [...(sockets ?? [])].filter(
        (id) => io.sockets.sockets.get(id)?.data.spectator,
      ).length,
    };
  }
  function publish(room: Room) {
    room.touchedAt = Date.now();
    storage.save(room.code, {
      ...room,
      pendingActions: undefined,
      pendingPlans: [...room.pendingActions],
    });
    io.to(room.code).emit('room:state', view(room));
    nudgeHousekeeping();
  }
  function nudgeHousekeeping() {
    // Reschedule the next wake-up so a single resolved action triggers
    // any newly-due deadlines without polling.
    scheduleNextTick();
  }

  function resolvePlans(room: Room) {
    if (
      room.turnOrder !== 'simultaneous' ||
      room.game?.phase !== 'playing' ||
      paused(room)
    )
      return;
    const living = room.game.players.filter((p) => p.hp > 0 && !p.abandoned);
    if (!living.length) return;
    // Disconnected-but-not-forfeited explorers get an implicit empty plan so
    // a flaky network doesn't freeze the round; connected/forfeited members
    // keep their placeholder until they (or the grace path) submit explicitly.
    for (const p of living) {
      const member = room.members.find((m) => m.id === p.id);
      if (!member) continue;
      if (member.connected || member.forfeited) continue;
      if (!room.pendingActions.has(p.id)) {
        room.pendingActions.set(p.id, {
          type: 'submit-turn',
          actions: [],
        });
      }
    }
    if (!living.every((p) => room.pendingActions.has(p.id))) return;
    room.game = resolveSimultaneousRound(
      room.game,
      living.map((p) => ({
        playerId: p.id,
        action: room.pendingActions.get(p.id)!,
      })),
    );
    room.pendingActions.clear();
    publish(room);
  }
  function unattached(socket: GameSocket) {
    if (socket.data.code) throw new Error('Leave your current room first.');
  }
  function attached(socket: GameSocket) {
    const room = rooms.get(socket.data.code ?? '');
    const member = room?.members.find((m) => m.id === socket.data.playerId);
    if (!room || !member || socket.data.spectator || member.forfeited)
      throw new Error('Join as an explorer to play.');
    return { room, member };
  }
  function attach(socket: GameSocket, room: Room, member: StoredMember) {
    socket.data.code = room.code;
    socket.data.playerId = member.id;
    socket.data.spectator = false;
    member.connected = true;
    member.disconnectedAt = null;
    socket.join(room.code);
    publish(room);
    return { code: room.code, playerId: member.id, token: member.token };
  }
  function makeMember(name: string, cosmetic?: string): StoredMember {
    return {
      id: randomUUID(),
      name,
      cosmetic,
      token: randomBytes(32).toString('hex'),
      connected: true,
      disconnectedAt: null,
      forfeited: false,
    };
  }
  async function makeRoom(
    name: string,
    mode: 'duo' | 'party' | 'daily',
    turnOrder: TurnOrder = 'alternating',
    cosmetic?: string,
  ) {
    if (mode === 'daily' && turnOrder !== 'alternating')
      throw new Error('Daily challenges use alternating turns.');
    if (rooms.size >= maxRooms)
      throw new Error('The server is full. Try again shortly.');
    let code = makeCode();
    while (true) {
      if (rooms.has(code) || reservedCodes.has(code)) {
        code = makeCode();
        continue;
      }
      reservedCodes.add(code);
      if (await storage.load(code)) {
        reservedCodes.delete(code);
        code = makeCode();
        continue;
      }
      break;
    }
    reservedCodes.delete(code);
    const member = makeMember(name, cosmetic);
    member.connected = false;
    member.disconnectedAt = Date.now();
    const room: Room = {
      code,
      mode,
      turnOrder,
      pendingActions: new Map(),
      host: member.id,
      members: [member],
      game: null,
      startedAt: 0,
      date: utcDate(),
      touchedAt: Date.now(),
      runId: randomUUID(),
    };
    rooms.set(code, room);
    scheduleNextTick();
    return { room, member };
  }
  function detach(socket: GameSocket, explicit: boolean) {
    const room = rooms.get(socket.data.code ?? '');
    if (!room) return;
    const member = room.members.find((m) => m.id === socket.data.playerId);
    if (member && !socket.data.spectator) {
      member.connected = false;
      member.disconnectedAt = Date.now();
      if (explicit) {
        member.forfeited = true;
        if (room.game) {
          room.game = abandonPlayer(room.game, member.id);
          room.pendingActions.delete(member.id);
          resolvePlans(room);
        } else room.members = room.members.filter((m) => m.id !== member.id);
        if (room.host === member.id)
          room.host = room.members.find((m) => !m.forfeited)?.id ?? '';
      }
    }
    socket.leave(room.code);
    socket.data.code = undefined;
    socket.data.playerId = undefined;
    socket.data.spectator = false;
    publish(room);
  }
  app.get(['/api/health', '/healthz'], (_req, res) =>
    res.status(storage.healthy ? 200 : 503).json({
      ok: storage.healthy,
      storage: storage.storage,
      rooms: rooms.size,
    }),
  );
  app.get('/api/daily', (_req, res) =>
    res.json({
      date: utcDate(),
      seed: dailySeed(utcDate()),
      leaderboard: storage.leaderboard(utcDate()),
    }),
  );
  app.get('/api/ghosts', (_req, res) =>
    res.json({
      ghosts: storage.getGhosts(),
    }),
  );
  app.post('/api/ghosts', express.json({ limit: '64kb' }), (req, res) => {
    try {
      const data = z
        .object({
          id: z.string().min(1).max(64),
          seed: z.number().int().min(0).max(0xffffffff),
          mode: z.literal('solo'),
          actionsJson: z.string().max(60_000),
          name: nameSchema,
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .strict()
        .parse(req.body);
      const actions = z
        .array(actionSchema.shape.action)
        .max(10_000)
        .parse(JSON.parse(data.actionsJson));
      if (actions.some((action) => action.type === 'submit-turn'))
        throw new Error('Ghosts are solo recordings.');
      storage.saveGhost(
        data.id,
        data.seed,
        data.mode,
        JSON.stringify(actions),
        data.name,
        data.date ?? utcDate(),
      );
      res.status(201).json({ ok: true });
    } catch (error) {
      res
        .status(
          error instanceof Error &&
            error.message.includes('UNIQUE constraint failed')
            ? 409
            : 400,
        )
        .json({ error: 'Invalid or duplicate ghost data.' });
    }
  });
  function authUser(req: express.Request): StoredUser | null {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    const payload = verifyToken(token);
    if (!payload) return null;
    return storage.getUserById(payload.id);
  }
  function formatProfile(
    u: StoredUser,
    achievements: { achievement_id: string; date: string }[],
  ): UserProfile {
    return {
      id: u.id,
      username: u.username,
      avatar: u.avatar,
      createdAt: u.created_at,
      stats: {
        runsPlayed: u.runs_played,
        runsWon: u.runs_won,
        dailyWins: u.daily_wins,
        bestTurns: u.best_turns,
      },
      achievements: achievements.map((a) => ({
        id: a.achievement_id,
        date: a.date,
      })),
    };
  }
  app.options(/^\/api\/auth/, (req, res) => {
    if (!allowed(req.headers.origin)) {
      res.sendStatus(403);
      return;
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    res.sendStatus(204);
  });
  app.post(
    '/api/auth/register',
    express.json({ limit: '8kb' }),
    async (req, res) => {
      try {
        const data = registerSchema.parse(req.body);
        const existing = await storage.getUserByUsername(data.username);
        if (existing) {
          res.status(409).json({ error: 'Username is already taken.' });
          return;
        }
        const { hash, salt } = await hashPassword(data.password);
        const user = storage.createUser({
          id: randomUUID(),
          username: data.username,
          password_hash: hash,
          salt,
          avatar: data.avatar ?? 'Explorer',
          created_at: new Date().toISOString(),
        });
        const token = createToken({ id: user.id, username: user.username });
        const achievements = storage.getAchievements(user.username);
        res.status(201).json({
          ok: true,
          token,
          user: formatProfile(user, achievements),
        });
      } catch (error) {
        res
          .status(
            error instanceof Error &&
              error.message.includes('UNIQUE constraint failed')
              ? 409
              : 400,
          )
          .json({
            error:
              error instanceof z.ZodError
                ? (error.issues[0]?.message ?? 'Invalid registration details.')
                : 'Unable to register.',
          });
      }
    },
  );
  app.post(
    '/api/auth/login',
    express.json({ limit: '8kb' }),
    async (req, res) => {
      try {
        const data = loginSchema.parse(req.body);
        const user = await storage.getUserByUsername(data.username);
        if (
          !user ||
          !(await verifyPassword(data.password, user.salt, user.password_hash))
        ) {
          res.status(401).json({ error: 'Incorrect username or password.' });
          return;
        }
        const token = createToken({ id: user.id, username: user.username });
        const achievements = storage.getAchievements(user.username);
        res.json({
          ok: true,
          token,
          user: formatProfile(user, achievements),
        });
      } catch {
        res.status(400).json({ error: 'Invalid login details.' });
      }
    },
  );
  app.get('/api/auth/me', (req, res) => {
    const user = authUser(req);
    if (!user) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    const achievements = storage.getAchievements(user.username);
    res.json({
      ok: true,
      user: formatProfile(user, achievements),
    });
  });
  app.post('/api/auth/avatar', express.json({ limit: '4kb' }), (req, res) => {
    const user = authUser(req);
    if (!user) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    const avatar = z.string().trim().min(1).max(30).parse(req.body?.avatar);
    storage.updateUserAvatar(user.id, avatar);
    res.json({ ok: true, avatar });
  });
  app.post(
    '/api/auth/record-run',
    express.json({ limit: '8kb' }),
    (req, res) => {
      const user = authUser(req);
      if (!user) {
        res.status(401).json({ error: 'Not authenticated.' });
        return;
      }
      const schema = z
        .object({
          runId: z.string().uuid(),
          won: z.boolean(),
          turns: z.number().int().min(1).max(1_000_000),
          daily: z.boolean().optional(),
          session: z
            .object({
              code: codeSchema,
              playerId: z.string().uuid(),
              token: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .optional(),
        })
        .strict();
      const data = schema.parse(req.body);
      let stats = { won: data.won, turns: data.turns, daily: false },
        runId = data.runId;
      if (data.session) {
        const room = rooms.get(data.session.code),
          member = room?.members.find((m) => m.id === data.session!.playerId);
        if (
          !room?.game ||
          !member ||
          member.forfeited ||
          !timingSafeEqual(
            Buffer.from(member.token),
            Buffer.from(data.session.token),
          ) ||
          !['won', 'lost'].includes(room.game.phase)
        ) {
          res.status(400).json({
            error:
              'A completed expedition and its private explorer session are required.',
          });
          return;
        }
        stats = {
          won: room.game.phase === 'won',
          turns: room.game.turns,
          daily: room.mode === 'daily',
        };
        runId = room.runId;
      } else if (data.daily) {
        res
          .status(400)
          .json({ error: 'Daily wins must be verified by the game server.' });
        return;
      }
      // Sanity check for non-session runs
      if (!data.session && data.won && data.turns < 15) {
        res.status(400).json({ error: 'Invalid run data.' });
        return;
      }
      const updated = storage.updateUserStats(user.id, stats, runId);
      const achievements = storage.getAchievements(user.username);
      res.json({
        ok: true,
        user: updated ? formatProfile(updated, achievements) : null,
      });
    },
  );
  app.get('/api/users/:username', async (req, res) => {
    try {
      const user = await storage.getUserByUsername(req.params.username);
      if (!user) {
        res.status(404).json({ error: 'Player not found.' });
        return;
      }
      const requester = authUser(req);
      const isSelf =
        !!requester &&
        requester.username.toLowerCase() === user.username.toLowerCase();
      const achievements = storage.getAchievements(user.username);
      const publicAchievements = achievements.length;
      const response: {
        ok: true;
        user: {
          username: string;
          avatar: string;
          createdAt: string;
          stats: { runsPlayed: number; runsWon: number };
          achievements: { id: string; date: string }[];
          dailyWins?: number;
          bestTurns?: number;
        };
      } = {
        ok: true,
        user: {
          username: user.username,
          avatar: user.avatar,
          createdAt: user.created_at,
          stats: {
            runsPlayed: user.runs_played,
            runsWon: user.runs_won,
          },
          achievements: isSelf
            ? achievements.map((a) => ({ id: a.achievement_id, date: a.date }))
            : publicAchievements
              ? [{ id: `__count_${publicAchievements}`, date: user.created_at }]
              : [],
        },
      };
      if (isSelf) {
        response.user.dailyWins = user.daily_wins;
        response.user.bestTurns = user.best_turns;
      }
      res.json(response);
    } catch {
      res.status(404).json({ error: 'Player not found.' });
    }
  });
  app.options('/api/rooms', (req, res) => {
    if (!allowed(req.headers.origin)) {
      res.sendStatus(403);
      return;
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
  });
  app.post('/api/rooms', express.json({ limit: '8kb' }), async (req, res) => {
    if (!allowed(req.headers.origin)) {
      res.status(403).json({ error: 'Origin not allowed.' });
      return;
    }
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const limit = httpLimits.get(key);
    const now = Date.now();
    if (limit && now - limit.time < 60_000 && limit.count >= 10) {
      res.status(429).json({ error: 'Too many rooms. Try again in a minute.' });
      return;
    }
    httpLimits.set(key, {
      time: limit && now - limit.time < 60_000 ? limit.time : now,
      count: limit && now - limit.time < 60_000 ? limit.count + 1 : 1,
    });
    try {
      const { name, mode, turnOrder, cosmetic } = z
        .object({
          name: nameSchema,
          mode: z.enum(['duo', 'party', 'daily']),
          turnOrder: z.enum(['alternating', 'simultaneous']).optional(),
          cosmetic: z.string().optional(),
        })
        .strict()
        .parse(req.body);
      const { room, member } = await makeRoom(
        name,
        mode,
        turnOrder ?? 'alternating',
        cosmetic,
      );
      publish(room);
      res
        .status(201)
        .json({ code: room.code, playerId: member.id, token: member.token });
    } catch (error) {
      res.status(error instanceof z.ZodError ? 400 : 503).json({
        error:
          error instanceof z.ZodError
            ? 'Check the player name and room mode.'
            : 'Room could not be created.',
      });
    }
  });
  app.get('/api/rooms/:code', async (req, res) => {
    try {
      const room = await getRoom(codeSchema.parse(req.params.code));
      res.json({
        code: room.code,
        mode: room.mode,
        players: room.members.length,
        started: Boolean(room.game),
      });
    } catch {
      res.status(404).json({ error: 'Room not found.' });
    }
  });
  const clientDist = fileURLToPath(
    new URL('../../client/dist/', import.meta.url),
  );
  app.use(express.static(clientDist));
  app.get('/', (_req, res) => res.sendFile(`${clientDist}/index.html`));
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: 'API route not found.' }),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        error instanceof z.ZodError
          ? 400
          : typeof error === 'object' &&
              error !== null &&
              'status' in error &&
              (error.status === 400 || error.status === 413)
            ? error.status
            : 500;
      res.status(status).json({
        error:
          status === 413
            ? 'Request body is too large.'
            : status === 400
              ? 'Invalid request data.'
              : 'Unable to complete the request.',
      });
    },
  );
  io.on('connection', (socket) => {
    // Bound event traffic and serialize each socket's asynchronous join/resume operations.
    let queue = Promise.resolve();
    function run(ack: unknown, fn: () => unknown | Promise<unknown>) {
      if (typeof ack !== 'function') return;
      const reply = ack as Ack;
      const now = Date.now();
      const requests = socket.data.requests;
      if (!requests || now - requests.time >= 10_000)
        socket.data.requests = { time: now, count: 1 };
      else if (++requests.count > (options.eventLimit ?? 60)) {
        reply({ ok: false, error: 'Too many requests. Wait a few seconds.' });
        return;
      }
      queue = queue.then(async () => {
        if (!socket.connected) return;
        try {
          reply({ ok: true, data: await fn() });
        } catch (error) {
          reply({
            ok: false,
            error:
              error instanceof z.ZodError
                ? error.issues[0].message + ' ' + error.issues[0].path.join('.')
                : error instanceof Error
                  ? error.message
                  : 'Unable to complete that action.',
          });
        }
      });
    }
    socket.on('room:create', (input, ack) =>
      run(ack, async () => {
        unattached(socket);
        const { name, mode, turnOrder, cosmetic } = z
          .object({
            name: nameSchema,
            mode: z.enum(['duo', 'party', 'daily']),
            turnOrder: z.enum(['alternating', 'simultaneous']).optional(),
            cosmetic: z.string().optional(),
          })
          .strict()
          .parse(input);
        const { room, member } = await makeRoom(
          name,
          mode,
          turnOrder ?? 'alternating',
          cosmetic,
        );
        if (!socket.connected) return;
        return attach(socket, room, member);
      }),
    );
    socket.on('room:join', (input, ack) =>
      run(ack, async () => {
        unattached(socket);
        const { name, code, cosmetic } = z
          .object({
            name: nameSchema,
            code: codeSchema,
            cosmetic: z.string().optional(),
          })
          .strict()
          .parse(input);
        const room = await getRoom(code);
        if (!socket.connected) return;
        if (room.game)
          throw new Error(
            'This expedition has started. You can still spectate.',
          );
        if (
          room.mode === 'daily' ||
          room.members.length >= (room.mode === 'duo' ? 2 : 4)
        )
          throw new Error('This room is full.');
        const member = makeMember(name, cosmetic);
        room.members.push(member);
        return attach(socket, room, member);
      }),
    );
    socket.on('room:resume', (input, ack) =>
      run(ack, async () => {
        unattached(socket);
        const data = z
          .object({
            code: codeSchema,
            playerId: z.string().uuid(),
            token: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .parse(input);
        const room = await getRoom(data.code);
        if (!socket.connected) return;
        const member = room.members.find((m) => m.id === data.playerId);
        if (
          !member ||
          !timingSafeEqual(Buffer.from(member.token), Buffer.from(data.token))
        )
          throw new Error('This session could not be restored.');
        if (
          member.forfeited ||
          (member.disconnectedAt &&
            Date.now() - member.disconnectedAt > graceMs)
        )
          throw new Error(
            'Your reconnect window has expired. You can still spectate.',
          );
        for (const other of io.sockets.sockets.values())
          if (
            other.id !== socket.id &&
            other.data.playerId === member.id &&
            other.data.code === room.code
          ) {
            other.data.playerId = undefined;
            other.data.code = undefined;
            other.leave(room.code);
            other.emit(
              'room:closed',
              'This explorer connected in another tab.',
            );
          }
        return attach(socket, room, member);
      }),
    );
    socket.on('room:watch', (input, ack) =>
      run(ack, async () => {
        unattached(socket);
        const { code } = z.object({ code: codeSchema }).strict().parse(input);
        const room = await getRoom(code);
        if (!socket.connected) return;
        if ((io.sockets.adapter.rooms.get(code)?.size ?? 0) >= 40)
          throw new Error('This room has reached its spectator limit.');
        socket.data.code = code;
        socket.data.spectator = true;
        socket.join(code);
        publish(room);
      }),
    );
    socket.on('room:start', (ack) =>
      run(ack, () => {
        const { room, member } = attached(socket);
        if (room.host !== member.id)
          throw new Error('Only the host can start the expedition.');
        if (room.game) throw new Error('This expedition has already started.');
        if (
          room.members.some((m) => !m.connected) ||
          (room.mode !== 'daily' && room.members.length < 2)
        )
          throw new Error('Wait for at least two connected explorers.');
        room.date = utcDate();
        room.startedAt = Date.now();
        room.game = createGame(
          room.mode,
          room.members.map(({ id, name }) => ({ id, name })),
          room.mode === 'daily' ? dailySeed(room.date) : randomInt(0x100000000),
          room.turnOrder,
        );
        publish(room);
      }),
    );
    socket.on('game:action', (input, ack) =>
      run(ack, () => {
        const { room, member } = attached(socket);
        const data = actionSchema.parse(input);
        if (!room.game) throw new Error('The expedition has not started.');
        if (paused(room))
          throw new Error('Waiting for your teammate to reconnect.');
        if (data.revision !== room.game.revision)
          throw new Error('The board changed. Try your action again.');

        if (
          room.turnOrder === 'simultaneous' &&
          room.game.phase === 'playing'
        ) {
          if (
            data.action.type === 'choose-room' ||
            data.action.type === 'draft-card' ||
            data.action.type === 'pick-relic'
          )
            throw new Error('No progression choice is pending.');
          if (room.pendingActions.has(member.id))
            throw new Error('Your turn is already submitted.');
          const plan =
            data.action.type === 'submit-turn'
              ? data.action.actions
              : data.action.type === 'play'
                ? [data.action]
                : [];
          previewSimultaneousTurn(room.game, member.id, plan);
          room.pendingActions.set(member.id, {
            type: 'submit-turn',
            actions: plan,
          });
          resolvePlans(room);
        } else {
          room.game = applyAction(room.game, member.id, data.action);
        }
        if (room.mode === 'daily' && room.game.phase === 'won') {
          storage.score(
            room.runId,
            room.date,
            member.name,
            room.game.turns,
            Math.round((Date.now() - room.startedAt) / 1000),
          );
          storage.unlockAchievement(member.name, 'daily_win', room.date);
        }
        publish(room);
      }),
    );
    socket.on('room:emote', (input, ack) =>
      run(ack, () => {
        const { room, member } = attached(socket);
        const data = emoteSchema.parse(input);
        io.to(room.code).emit('room:emote', {
          playerId: member.id,
          emote: data.emote,
        });
      }),
    );
    socket.on('room:leave', (ack) => run(ack, () => detach(socket, true)));
    socket.on('disconnect', () => detach(socket, false));
  });
  function tickHousekeeping() {
    for (const [key, limit] of httpLimits)
      if (Date.now() - limit.time >= 60_000) httpLimits.delete(key);
    for (const room of rooms.values()) {
      let changed = false;
      for (const m of [...room.members])
        if (
          !m.connected &&
          !m.forfeited &&
          m.disconnectedAt &&
          Date.now() - m.disconnectedAt >= graceMs
        ) {
          m.forfeited = true;
          changed = true;
          if (room.game) {
            room.game = abandonPlayer(room.game, m.id);
            room.pendingActions.delete(m.id);
            resolvePlans(room);
          } else room.members = room.members.filter((v) => v.id !== m.id);
          if (room.host === m.id)
            room.host = room.members.find((v) => !v.forfeited)?.id ?? '';
        }
      if (changed) publish(room);
      if (Date.now() - room.touchedAt > 7_200_000) {
        io.to(room.code).emit('room:closed', 'This room has expired.');
        for (const id of io.sockets.adapter.rooms.get(room.code) ?? []) {
          const socket = io.sockets.sockets.get(id);
          if (socket) {
            socket.data = {};
            socket.leave(room.code);
          }
        }
        rooms.delete(room.code);
      }
    }
    scheduleNextTick();
  }
  function scheduleNextTick() {
    if (houseTimer) clearTimeout(houseTimer);
    if (rooms.size === 0) {
      // No active rooms: idle until something happens again.
      return;
    }
    // Find the soonest deadline (forfeit or expiry) so the sweep runs only as
    // often as needed; cap at 1s for snappy UX.
    let nextDeadline = Date.now() + 1_000;
    for (const room of rooms.values()) {
      const expiry = room.touchedAt + 7_200_000;
      nextDeadline = Math.min(nextDeadline, expiry);
      for (const m of room.members) {
        if (!m.connected && !m.forfeited && m.disconnectedAt) {
          const forfeit = m.disconnectedAt + graceMs;
          nextDeadline = Math.min(nextDeadline, forfeit);
        }
      }
    }
    const wait = Math.max(250, nextDeadline - Date.now());
    houseTimer = setTimeout(tickHousekeeping, wait);
    if (houseTimer && typeof houseTimer.unref === 'function')
      houseTimer.unref();
  }
  scheduleNextTick();
  return {
    app,
    http,
    io,
    rooms,
    storage,
    async close() {
      if (houseTimer) clearTimeout(houseTimer);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await storage.close();
    },
  };
}
