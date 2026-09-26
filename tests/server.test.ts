import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import {
  activePlayer,
  LEVELS,
  type ClientEvents,
  type RoomView,
  type ServerEvents,
  type Session,
  type AuthResponse,
  type UserProfile,
} from '@chrono/shared';
import { createApp } from '../packages/server/src/app';
import { chooseAction } from './bot';
import type { AddressInfo } from 'node:net';

type Client = Socket<ServerEvents, ClientEvents>;
let app: Awaited<ReturnType<typeof createApp>>;
let url: string;
let clients: Client[];
const states = new Map<Client, RoomView>();
async function client() {
  const socket: Client = io(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  clients.push(socket);
  socket.on('room:state', (state) => states.set(socket, state));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
async function create(
  socket: Client,
  mode: 'party' | 'duo' | 'daily' = 'party',
): Promise<Session> {
  const result = await socket.emitWithAck('room:create', {
    name: 'Host',
    mode,
  });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
async function join(
  socket: Client,
  code: string,
  name = 'Guest',
): Promise<Session> {
  const result = await socket.emitWithAck('room:join', { name, code });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
beforeEach(async () => {
  clients = [];
  states.clear();
  app = await createApp({
    database: ':memory:',
    graceMs: 200,
    eventLimit: 20_000,
  });
  await new Promise<void>((resolve) =>
    app.http.listen(0, '127.0.0.1', resolve),
  );
  url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
});
afterEach(async () => {
  clients.forEach((socket) => socket.disconnect());
  await app.close();
});

describe('authoritative rooms', () => {
  it('accepts independent simultaneous plans, prevents replacements, and continues after a missing planner leaves', async () => {
    const host = await client(),
      guest = await client(),
      third = await client();
    const created = await host.emitWithAck('room:create', {
      name: 'Host',
      mode: 'party',
      turnOrder: 'simultaneous',
    });
    if (!created.ok) throw new Error(created.error);
    const session = created.data,
      other = await join(guest, session.code);
    await join(third, session.code, 'Third');
    await host.emitWithAck('room:start');
    const turn = {
      revision: 0,
      action: { type: 'submit-turn' as const, actions: [] },
    };
    expect((await guest.emitWithAck('game:action', turn)).ok).toBe(true);
    expect(states.get(guest)?.submittedPlayers).toEqual([other.playerId]);
    expect(states.get(guest)?.game?.round).toBe(1);
    expect((await guest.emitWithAck('game:action', turn)).ok).toBe(false);
    expect((await host.emitWithAck('game:action', turn)).ok).toBe(true);
    expect((await third.emitWithAck('room:leave')).ok).toBe(true);
    await expect.poll(() => states.get(host)?.game?.round).toBe(2);
    expect(states.get(host)?.submittedPlayers).toEqual([]);
    const authoritative = app.rooms.get(session.code)!.game!;
    authoritative.players[1].hp = 0;
    expect(
      (
        await guest.emitWithAck('game:action', {
          revision: authoritative.revision,
          action: { type: 'submit-turn', actions: [] },
        })
      ).ok,
    ).toBe(false);
  });
  it('creates a room through HTTP and attaches its private session over a socket', async () => {
    const response = await fetch(`${url}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'HTTP host', mode: 'party' }),
    });
    expect(response.status).toBe(201);
    const session = (await response.json()) as Session;
    const socket = await client();
    expect((await socket.emitWithAck('room:resume', session)).ok).toBe(true);
    expect(states.get(socket)?.members[0].name).toBe('HTTP host');
    const invalid = await fetch(`${url}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '<script>', mode: 'party' }),
    });
    expect(invalid.status).toBe(400);
  });
  it('exposes health and daily leaderboards without private session data', async () => {
    expect(await (await fetch(`${url}/api/health`)).json()).toMatchObject({
      ok: true,
      storage: 'memory',
    });
    expect(await (await fetch(`${url}/api/daily`)).json()).toMatchObject({
      leaderboard: [],
    });
    const host = await client();
    const session = await create(host);
    expect(JSON.stringify(states.get(host))).not.toContain(session.token);
    expect(
      await (await fetch(`${url}/api/rooms/${session.code}`)).json(),
    ).toMatchObject({ code: session.code, players: 1, started: false });
  });
  it('validates names and codes, enforces capacity and host-only start', async () => {
    const host = await client();
    const guest = await client();
    const third = await client();
    expect(
      (
        await host.emitWithAck('room:create', {
          name: '<script>',
          mode: 'party',
        })
      ).ok,
    ).toBe(false);
    const session = await create(host, 'duo');
    expect((await host.emitWithAck('room:start')).ok).toBe(false);
    expect(
      (await guest.emitWithAck('room:join', { code: 'INVALID', name: 'Guest' }))
        .ok,
    ).toBe(false);
    await join(guest, session.code);
    expect((await guest.emitWithAck('room:start')).ok).toBe(false);
    expect(
      (
        await third.emitWithAck('room:join', {
          code: session.code,
          name: 'Third',
        })
      ).ok,
    ).toBe(false);
    expect((await host.emitWithAck('room:start')).ok).toBe(true);
    expect(states.get(host)?.game?.players).toHaveLength(2);
  });
  it('rejects out-of-turn, forged, repeated, and spectator actions', async () => {
    const host = await client();
    const guest = await client();
    const spectator = await client();
    const session = await create(host);
    await join(guest, session.code);
    await spectator.emitWithAck('room:watch', { code: session.code });
    await host.emitWithAck('room:start');
    expect(
      (
        await guest.emitWithAck('game:action', {
          revision: 0,
          action: { type: 'end' },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await spectator.emitWithAck('game:action', {
          revision: 0,
          action: { type: 'end' },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await host.emitWithAck('game:action', {
          revision: 0,
          action: { type: 'play', card: 20 },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await host.emitWithAck('game:action', {
          revision: 0,
          action: { type: 'end' },
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await guest.emitWithAck('game:action', {
          revision: 0,
          action: { type: 'end' },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await guest.emitWithAck('game:action', {
          revision: 1,
          action: { type: 'end' },
        })
      ).ok,
    ).toBe(true);
    await expect.poll(() => states.get(spectator)?.game?.revision).toBe(2);
    expect(states.get(spectator)?.game).toEqual(states.get(host)?.game);
  });
  it('holds disconnected turns, rejects stolen tokens, and resumes the same state', async () => {
    const host = await client();
    const guest = await client();
    const session = await create(host);
    await join(guest, session.code);
    await host.emitWithAck('room:start');
    host.disconnect();
    await expect
      .poll(() => states.get(guest)?.paused, { interval: 10 })
      .toBe(true);
    const returning = await client();
    expect(
      (
        await returning.emitWithAck('room:resume', {
          ...session,
          token: '0'.repeat(64),
        })
      ).ok,
    ).toBe(false);
    expect((await returning.emitWithAck('room:resume', session)).ok).toBe(true);
    expect(states.get(returning)?.game?.revision).toBe(0);
    expect(states.get(returning)?.paused).toBe(false);
    expect(
      (
        await returning.emitWithAck('game:action', {
          revision: 0,
          action: { type: 'end' },
        })
      ).ok,
    ).toBe(true);
  });
  it('expires a disconnected player and lets the party continue', async () => {
    const host = await client();
    const guest = await client();
    const session = await create(host);
    await join(guest, session.code);
    await host.emitWithAck('room:start');
    host.disconnect();
    await expect
      .poll(() => states.get(guest)?.game?.active, { interval: 20 })
      .toBe(1);
    expect(states.get(guest)?.game?.players[0]).toMatchObject({
      hp: 0,
      abandoned: true,
    });
    expect(states.get(guest)?.paused).toBe(false);
    const returning = await client();
    expect((await returning.emitWithAck('room:resume', session)).ok).toBe(
      false,
    );
  });
  it('transfers lobby ownership when its host leaves', async () => {
    const host = await client();
    const guest = await client();
    const session = await create(host);
    const member = await join(guest, session.code);
    await host.emitWithAck('room:leave');
    await expect.poll(() => states.get(guest)?.host).toBe(member.playerId);
    expect(states.get(guest)?.members).toHaveLength(1);
  });
  it('finishes a four-player networked run with a live spectator', async () => {
    const host = await client();
    const session = await create(host);
    const players = new Map([[session.playerId, host]]);
    for (let i = 0; i < 3; i++) {
      const guest = await client();
      const member = await join(guest, session.code, `Guest ${i}`);
      players.set(member.playerId, guest);
    }
    const spectator = await client();
    await spectator.emitWithAck('room:watch', { code: session.code });
    // The server chooses the seed. All gameplay travels over real sockets.
    const originalStart = app.rooms.get(session.code)!;
    expect(originalStart.game).toBeNull();
    await host.emitWithAck('room:start');
    let actions = 0;
    while (actions < 4000) {
      const state = app.rooms.get(session.code)!.game!;
      if (state.phase === 'won' || state.phase === 'lost') break;
      const socket = players.get(activePlayer(state).id)!;
      const result = await socket.emitWithAck('game:action', {
        revision: state.revision,
        action: chooseAction(state),
      });
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
      actions++;
    }
    const state = app.rooms.get(session.code)!.game!;
    expect({
      phase: state.phase,
      level: state.level,
      turns: state.turns,
    }).toMatchObject({ phase: 'won', level: LEVELS.length - 1 });
    await expect.poll(() => states.get(spectator)?.game?.phase).toBe('won');
    for (const socket of players.values())
      expect(states.get(socket)?.game).toEqual(state);
  }, 120_000);
  it('records daily wins once and ranks by turns, then time', async () => {
    const host = await client();
    const session = await create(host, 'daily');
    await host.emitWithAck('room:start');
    let actions = 0;
    while (actions < 4000) {
      const state = app.rooms.get(session.code)!.game!;
      if (state.phase === 'won' || state.phase === 'lost') break;
      const result = await host.emitWithAck('game:action', {
        revision: state.revision,
        action: chooseAction(state),
      });
      expect(result.ok).toBe(true);
      actions++;
    }
    const state = app.rooms.get(session.code)!.game!;
    expect(state.phase).toBe('won');
    const data = await (await fetch(`${url}/api/daily`)).json();
    expect(data.leaderboard).toHaveLength(1);
    expect(data.leaderboard[0]).toMatchObject({
      name: 'Host',
      turns: state.turns,
    });
    expect(
      (
        await host.emitWithAck('game:action', {
          revision: state.revision,
          action: { type: 'end' },
        })
      ).ok,
    ).toBe(false);
    const room = app.rooms.get(session.code)!;
    app.storage.score(room.runId, room.date, 'Duplicate', 1, 1);
    expect(app.storage.leaderboard(room.date)).toHaveLength(1);
    app.storage.score('other', room.date, 'Fast', 1, 10);
    expect(app.storage.leaderboard(room.date)[0].name).toBe('Fast');
  }, 120_000);
  it('registers, logs in, and retrieves user profile with stats', async () => {
    const regRes = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'TestExplorer',
        password: 'password123',
        avatar: 'Solar Warden',
      }),
    });
    expect(regRes.status).toBe(201);
    const regData = (await regRes.json()) as AuthResponse & { ok: boolean };
    expect(regData.ok).toBe(true);
    expect(regData.token).toBeTruthy();
    expect(regData.user.username).toBe('TestExplorer');
    expect(regData.user.avatar).toBe('Solar Warden');
    expect(regData.user.stats.runsPlayed).toBe(0);

    const dupRes = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testexplorer',
        password: 'password456',
      }),
    });
    expect(dupRes.status).toBe(409);

    const loginRes = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'TestExplorer',
        password: 'password123',
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = (await loginRes.json()) as AuthResponse & {
      ok: boolean;
    };
    expect(loginData.ok).toBe(true);
    const token = loginData.token;

    const meRes = await fetch(`${url}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.status).toBe(200);
    const meData = (await meRes.json()) as { ok: boolean; user: UserProfile };
    expect(meData.user.username).toBe('TestExplorer');

    const avatarRes = await fetch(`${url}/api/auth/avatar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ avatar: 'Chrono Phantom' }),
    });
    expect(avatarRes.status).toBe(200);

    const dailyClient = await client();
    const proof = await create(dailyClient, 'daily');
    await dailyClient.emitWithAck('room:start');
    const completed = app.rooms.get(proof.code)!.game!;
    completed.phase = 'won';
    completed.turns = 14;
    const report = {
      runId: crypto.randomUUID(),
      won: false,
      turns: 99,
      daily: true,
      session: proof,
    };
    const runRes = await fetch(`${url}/api/auth/record-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(report),
    });
    expect(runRes.status).toBe(200);
    const runData = (await runRes.json()) as {
      ok: boolean;
      user: UserProfile;
    };
    expect(runData.user.stats.runsPlayed).toBe(1);
    expect(runData.user.stats.runsWon).toBe(1);
    expect(runData.user.stats.dailyWins).toBe(1);
    expect(runData.user.stats.bestTurns).toBe(14);
    const repeated = await fetch(`${url}/api/auth/record-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...report, runId: crypto.randomUUID() }),
    });
    expect(
      ((await repeated.json()) as { user: UserProfile }).user.stats.runsPlayed,
    ).toBe(1);
    const fabricated = await fetch(`${url}/api/auth/record-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        runId: crypto.randomUUID(),
        won: true,
        turns: 1,
        daily: true,
      }),
    });
    expect(fabricated.status).toBe(400);

    const pubRes = await fetch(`${url}/api/users/TestExplorer`);
    expect(pubRes.status).toBe(200);
    const pubData = (await pubRes.json()) as {
      ok: boolean;
      user: UserProfile;
    };
    expect(pubData.user.username).toBe('TestExplorer');
    expect(pubData.user.stats.runsWon).toBe(1);
  });
});
describe('HTTP audit regressions', () => {
  it('validates JSON errors, protects mutations by origin, and supports cross-origin ghost preflight', async () => {
    const preflight = await fetch(`${url}/api/ghosts`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain(
      'Content-Type',
    );
    const denied = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: {
        Origin: 'https://untrusted.invalid',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'Denied', password: '123456' }),
    });
    expect(denied.status).toBe(403);
    const malformed = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid request data.' });
    const registered = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'AuditUser',
        password: 'audit-password',
      }),
    });
    const { token } = (await registered.json()) as AuthResponse;
    const invalid = await fetch(`${url}/api/auth/avatar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ avatar: 123 }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'Invalid request data.' });
  });
  it('limits password attempts and atomically rejects usernames differing only by case', async () => {
    const register = (username: string) =>
      fetch(`${url}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'audit-password' }),
      });
    const responses = await Promise.all([
      register('RaceUser'),
      register('raceuser'),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    let last: Response | undefined;
    for (let i = 0; i < 20; i++)
      last = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'missing', password: 'wrong' }),
      });
    expect(last!.status).toBe(429);
    expect(last!.headers.get('retry-after')).toBeTruthy();
  });
});
