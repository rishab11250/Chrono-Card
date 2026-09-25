import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistence } from '../packages/server/src/persistence';
import { createApp } from '../packages/server/src/app';
import { io, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import type { ClientEvents, RoomView, ServerEvents } from '@chrono/shared';

it('persists leaderboard entries across database restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chrono-scores-'));
  try {
    const database = join(directory, 'scores.sqlite');
    const first = await persistence({ database });
    first.score('run1', '2026-09-24', 'Ada', 40, 120);
    first.score('run2', '2026-09-24', 'Bram', 35, 200);
    first.score('run3', '2026-09-24', 'Cy', 35, 150);
    await first.close();
    const second = await persistence({ database });
    try {
      expect(second.leaderboard('2026-09-24').map((row) => row.name)).toEqual([
        'Cy',
        'Bram',
        'Ada',
      ]);
      expect(second.leaderboard('2026-09-25')).toEqual([]);
    } finally {
      await second.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.skipIf(!process.env.TEST_REDIS_URL)(
  'recovers authoritative rooms and private sessions after a server restart using Redis',
  async () => {
    const options = {
      database: ':memory:',
      redisUrl: process.env.TEST_REDIS_URL,
      graceMs: 5000,
    };
    let server = await createApp(options);
    const sockets: Socket<ServerEvents, ClientEvents>[] = [];
    async function listen() {
      await new Promise<void>((resolve) =>
        server.http.listen(0, '127.0.0.1', resolve),
      );
      return `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
    }
    async function connect(url: string) {
      const socket: Socket<ServerEvents, ClientEvents> = io(url, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      return socket;
    }
    try {
      const url = await listen();
      const host = await connect(url);
      const guest = await connect(url);
      const created = await host.emitWithAck('room:create', {
        name: 'Persistent host',
        mode: 'duo',
      });
      if (!created.ok) throw new Error(created.error);
      const joined = await guest.emitWithAck('room:join', {
        name: 'Persistent guest',
        code: created.data.code,
      });
      if (!joined.ok) throw new Error(joined.error);
      await host.emitWithAck('room:start');
      await host.emitWithAck('game:action', {
        revision: 0,
        action: { type: 'end' },
      });
      const before = structuredClone(server.rooms.get(created.data.code)!.game);
      await server.close();
      server = await createApp(options);
      const restartedUrl = await listen();
      const resumedHost = await connect(restartedUrl);
      const resumedGuest = await connect(restartedUrl);
      let state: RoomView | undefined;
      resumedHost.on('room:state', (room) => {
        state = room;
      });
      expect(
        (await resumedHost.emitWithAck('room:resume', created.data)).ok,
      ).toBe(true);
      expect(
        (await resumedGuest.emitWithAck('room:resume', joined.data)).ok,
      ).toBe(true);
      await expect.poll(() => state?.paused).toBe(false);
      expect(state?.game).toEqual(before);
      expect(
        (
          await resumedGuest.emitWithAck('game:action', {
            revision: 1,
            action: { type: 'end' },
          })
        ).ok,
      ).toBe(true);
      // Expire only the test's own room snapshot; never flush a shared database.
      const { createClient } = await import('redis');
      const redis = createClient({ url: options.redisUrl });
      await redis.connect();
      sockets.forEach((socket) => socket.disconnect());
      await server.close();
      await redis.expire(`chrono:room:${created.data.code}`, 1);
      await redis.quit();
      return;
    } catch (error) {
      sockets.forEach((socket) => socket.disconnect());
      await server.close();
      throw error;
    }
  },
  15_000,
);
