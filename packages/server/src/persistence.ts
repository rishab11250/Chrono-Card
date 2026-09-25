import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from 'redis';
import type { LeaderboardEntry } from '@chrono/shared';

export async function persistence(
  options: { redisUrl?: string; database?: string } = {},
) {
  const path =
    options.database ??
    resolve(process.env.DATA_DIR ?? 'data', 'chrono.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS scores (run TEXT PRIMARY KEY, date TEXT NOT NULL, name TEXT NOT NULL, turns INTEGER NOT NULL, seconds INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS scores_date ON scores(date, turns, seconds); CREATE TABLE IF NOT EXISTS achievements (player_name TEXT NOT NULL, achievement_id TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY (player_name, achievement_id)); CREATE TABLE IF NOT EXISTS ghosts (id TEXT PRIMARY KEY, seed INTEGER NOT NULL, mode TEXT NOT NULL, actions_json TEXT NOT NULL, name TEXT NOT NULL, date TEXT NOT NULL);',
  );
  const redis = options.redisUrl
    ? createClient({
        url: options.redisUrl,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => Math.min(retries * 200, 3000),
        },
      })
    : null;
  redis?.on('error', (err: Error) =>
    console.error('Redis connection error:', err.message),
  );
  if (redis) await redis.connect();
  let writes: Promise<unknown> = Promise.resolve();
  let writeFailed = false;
  return {
    get storage() {
      return redis ? 'redis' : 'memory';
    },
    get healthy() {
      return !redis || (redis.isReady && !writeFailed);
    },
    async load(code: string) {
      return redis ? await redis.get(`chrono:room:${code}`) : null;
    },
    save(code: string, value: unknown) {
      if (!redis) return;
      const json = JSON.stringify(value);
      writes = writes
        .then(() => redis.set(`chrono:room:${code}`, json, { EX: 7200 }))
        .then(() => {
          writeFailed = false;
        })
        .catch((err: Error) => {
          writeFailed = true;
          console.error('Room persistence failed:', err.message);
        });
    },
    score(
      run: string,
      date: string,
      name: string,
      turns: number,
      seconds: number,
    ) {
      db.prepare(
        'INSERT OR IGNORE INTO scores (run,date,name,turns,seconds) VALUES (?,?,?,?,?)',
      ).run(run, date, name, turns, seconds);
    },
    unlockAchievement(playerName: string, achievementId: string, date: string) {
      db.prepare(
        'INSERT OR IGNORE INTO achievements (player_name, achievement_id, date) VALUES (?,?,?)',
      ).run(playerName, achievementId, date);
    },
    getAchievements(playerName: string) {
      return db
        .prepare(
          'SELECT achievement_id, date FROM achievements WHERE player_name = ?',
        )
        .all(playerName) as { achievement_id: string; date: string }[];
    },
    saveGhost(
      id: string,
      seed: number,
      mode: string,
      actionsJson: string,
      name: string,
      date: string,
    ) {
      db.prepare(
        'INSERT OR REPLACE INTO ghosts (id, seed, mode, actions_json, name, date) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, seed, mode, actionsJson, name, date);
    },
    getGhosts() {
      return db
        .prepare(
          'SELECT id, seed, mode, actions_json, name, date FROM ghosts ORDER BY date DESC LIMIT 20',
        )
        .all() as {
        id: string;
        seed: number;
        mode: string;
        actions_json: string;
        name: string;
        date: string;
      }[];
    },
    leaderboard(date: string) {
      return db
        .prepare(
          'SELECT name, turns, seconds, date FROM scores WHERE date = ? ORDER BY turns ASC, seconds ASC LIMIT 20',
        )
        .all(date) as LeaderboardEntry[];
    },
    async close() {
      await writes;
      if (redis) await redis.quit();
      db.close();
    },
  };
}
