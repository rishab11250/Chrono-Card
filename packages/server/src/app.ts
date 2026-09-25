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
  type ClientEvents,
  type GameState,
  type Member,
  type Mode,
  type Reply,
  type RoomView,
  type ServerEvents,
} from '@chrono/shared';
import { persistence } from './persistence';

type StoredMember = Member & {
  token: string;
  disconnectedAt: number | null;
  forfeited: boolean;
};
type Room = {
  code: string;
  mode: Mode;
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
          type: z.literal('play'),
          card: z.number().int().min(0).max(4),
          target: z
            .object({
              x: z.number().int().min(0).max(9),
              y: z.number().int().min(0).max(9),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ]),
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
  } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  const http = createServer(app);
  const origins = (
    options.clientOrigin ??
    process.env.CLIENT_ORIGIN ??
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001'
  )
    .split(',')
    .map((s) => s.trim());
  const allowed = (origin: string | undefined) =>
    !origin || origins.includes(origin);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  const io = new Server<
    ClientEvents,
    ServerEvents,
    Record<string, never>,
    SocketData
  >(http, {
    cors: { origin: origins },
    allowRequest: (req, cb) => cb(null, allowed(req.headers.origin)),
    maxHttpBufferSize: 8192,
  });
  const storage = await persistence({
    database: options.database,
    redisUrl: options.redisUrl ?? process.env.REDIS_URL,
  });
  const rooms = new Map<string, Room>();
  const pendingLoads = new Map<string, Promise<Room>>();
  const graceMs = options.graceMs ?? 90_000;
  const maxRooms = 500;
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
      const room = JSON.parse(saved) as Room;
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
    if (!room.game || room.game.phase !== 'playing') return false;
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
      host: room.host,
      members: room.members.map(({ id, name, connected }) => ({
        id,
        name,
        connected,
      })),
      game: room.game,
      paused: paused(room),
      graceSeconds: Math.ceil(graceMs / 1000),
      spectators: [...(sockets ?? [])].filter(
        (id) => io.sockets.sockets.get(id)?.data.spectator,
      ).length,
    };
  }
  function publish(room: Room) {
    room.touchedAt = Date.now();
    storage.save(room.code, room);
    io.to(room.code).emit('room:state', view(room));
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
  function makeMember(name: string): StoredMember {
    return {
      id: randomUUID(),
      name,
      token: randomBytes(32).toString('hex'),
      connected: true,
      disconnectedAt: null,
      forfeited: false,
    };
  }
  async function makeRoom(name: string, mode: 'duo' | 'party' | 'daily') {
    if (rooms.size >= maxRooms)
      throw new Error('The server is full. Try again shortly.');
    let code = makeCode();
    while (rooms.has(code) || (await storage.load(code))) code = makeCode();
    const member = makeMember(name);
    member.connected = false;
    member.disconnectedAt = Date.now();
    const room: Room = {
      code,
      mode,
      host: member.id,
      members: [member],
      game: null,
      startedAt: 0,
      date: utcDate(),
      touchedAt: Date.now(),
      runId: randomUUID(),
    };
    rooms.set(code, room);
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
        if (room.game) room.game = abandonPlayer(room.game, member.id);
        else room.members = room.members.filter((m) => m.id !== member.id);
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
  app.get('/api/health', (_req, res) =>
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
  const httpLimits = new Map<string, { time: number; count: number }>();
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
    const key = req.socket.remoteAddress ?? 'unknown';
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
      const { name, mode } = z
        .object({ name: nameSchema, mode: z.enum(['duo', 'party', 'daily']) })
        .strict()
        .parse(req.body);
      const { room, member } = await makeRoom(name, mode);
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
                ? 'Please check the name, code, or action.'
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
        const { name, mode } = z
          .object({ name: nameSchema, mode: z.enum(['duo', 'party', 'daily']) })
          .strict()
          .parse(input);
        const { room, member } = await makeRoom(name, mode);
        if (!socket.connected) return;
        return attach(socket, room, member);
      }),
    );
    socket.on('room:join', (input, ack) =>
      run(ack, async () => {
        unattached(socket);
        const { name, code } = z
          .object({ name: nameSchema, code: codeSchema })
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
        const member = makeMember(name);
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
        room.game = applyAction(room.game, member.id, data.action);
        if (room.mode === 'daily' && room.game.phase === 'won')
          storage.score(
            room.runId,
            room.date,
            member.name,
            room.game.turns,
            Math.round((Date.now() - room.startedAt) / 1000),
          );
        publish(room);
      }),
    );
    socket.on('room:leave', (ack) => run(ack, () => detach(socket, true)));
    socket.on('disconnect', () => detach(socket, false));
  });
  const timer = setInterval(
    () => {
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
            if (room.game) room.game = abandonPlayer(room.game, m.id);
            else room.members = room.members.filter((v) => v.id !== m.id);
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
    },
    Math.min(1000, graceMs),
  );
  timer.unref();
  return {
    app,
    http,
    io,
    rooms,
    storage,
    async close() {
      clearInterval(timer);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await storage.close();
    },
  };
}
