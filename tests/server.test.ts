import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import {
  activePlayer,
  LEVELS,
  type ClientEvents,
  type RoomView,
  type ServerEvents,
  type Session,
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
      if (state.phase !== 'playing') break;
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
      if (state.phase !== 'playing') break;
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
});
