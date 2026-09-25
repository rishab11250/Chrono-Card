import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from 'redis';
import type { LeaderboardEntry } from '@chrono/shared';

export type StoredUser = {
  id: string;
  username: string;
  password_hash: string;
  salt: string;
  avatar: string;
  created_at: string;
  runs_played: number;
  runs_won: number;
  daily_wins: number;
  best_turns: number;
};

export async function persistence(
  options: { redisUrl?: string; database?: string } = {},
) {
  const path =
    options.database ??
    resolve(process.env.DATA_DIR ?? 'data', 'chrono.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    'PRAGMA journal_mode = WAL; ' +
      'CREATE TABLE IF NOT EXISTS scores (run TEXT PRIMARY KEY, date TEXT NOT NULL, name TEXT NOT NULL, turns INTEGER NOT NULL, seconds INTEGER NOT NULL); ' +
      'CREATE INDEX IF NOT EXISTS scores_date ON scores(date, turns, seconds); ' +
      'CREATE TABLE IF NOT EXISTS achievements (player_name TEXT NOT NULL, achievement_id TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY (player_name, achievement_id)); ' +
      'CREATE TABLE IF NOT EXISTS ghosts (id TEXT PRIMARY KEY, seed INTEGER NOT NULL, mode TEXT NOT NULL, actions_json TEXT NOT NULL, name TEXT NOT NULL, date TEXT NOT NULL); ' +
      'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, avatar TEXT NOT NULL, created_at TEXT NOT NULL, runs_played INTEGER DEFAULT 0, runs_won INTEGER DEFAULT 0, daily_wins INTEGER DEFAULT 0, best_turns INTEGER DEFAULT 999999); ' +
      'CREATE INDEX IF NOT EXISTS users_username ON users(username COLLATE NOCASE);',
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
    createUser(user: {
      id: string;
      username: string;
      password_hash: string;
      salt: string;
      avatar: string;
      created_at: string;
    }): StoredUser {
      const record: StoredUser = {
        ...user,
        runs_played: 0,
        runs_won: 0,
        daily_wins: 0,
        best_turns: 999999,
      };
      db.prepare(
        'INSERT INTO users (id, username, password_hash, salt, avatar, created_at, runs_played, runs_won, daily_wins, best_turns) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 999999)',
      ).run(
        user.id,
        user.username,
        user.password_hash,
        user.salt,
        user.avatar,
        user.created_at,
      );
      if (redis) {
        writes = writes.then(() =>
          redis.set(
            `chrono:user:${user.username.toLowerCase()}`,
            JSON.stringify(record),
          ),
        );
      }
      return record;
    },
    async getUserByUsername(username: string): Promise<StoredUser | null> {
      const row = db
        .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
        .get(username) as StoredUser | undefined;
      if (row) return row;
      if (redis) {
        try {
          const cached = await redis.get(
            `chrono:user:${username.toLowerCase()}`,
          );
          if (cached) {
            const user = JSON.parse(cached) as StoredUser;
            db.prepare(
              'INSERT OR REPLACE INTO users (id, username, password_hash, salt, avatar, created_at, runs_played, runs_won, daily_wins, best_turns) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ).run(
              user.id,
              user.username,
              user.password_hash,
              user.salt,
              user.avatar,
              user.created_at,
              user.runs_played,
              user.runs_won,
              user.daily_wins,
              user.best_turns,
            );
            return user;
          }
        } catch {
          // ignore cache error
        }
      }
      return null;
    },
    getUserById(id: string): StoredUser | null {
      const row = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(id) as StoredUser | undefined;
      return row ?? null;
    },
    updateUserAvatar(id: string, avatar: string) {
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, id);
      const user = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(id) as StoredUser | undefined;
      if (user && redis) {
        writes = writes.then(() =>
          redis.set(
            `chrono:user:${user.username.toLowerCase()}`,
            JSON.stringify(user),
          ),
        );
      }
    },
    updateUserStats(
      id: string,
      update: { won?: boolean; turns?: number; daily?: boolean },
    ): StoredUser | null {
      const user = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(id) as StoredUser | undefined;
      if (!user) return null;
      const runs_played = user.runs_played + 1;
      const runs_won = update.won ? user.runs_won + 1 : user.runs_won;
      const daily_wins =
        update.daily && update.won ? user.daily_wins + 1 : user.daily_wins;
      const best_turns =
        update.won && update.turns
          ? Math.min(user.best_turns, update.turns)
          : user.best_turns;
      db.prepare(
        'UPDATE users SET runs_played = ?, runs_won = ?, daily_wins = ?, best_turns = ? WHERE id = ?',
      ).run(runs_played, runs_won, daily_wins, best_turns, id);
      const updated: StoredUser = {
        ...user,
        runs_played,
        runs_won,
        daily_wins,
        best_turns,
      };
      if (redis) {
        writes = writes.then(() =>
          redis.set(
            `chrono:user:${user.username.toLowerCase()}`,
            JSON.stringify(updated),
          ),
        );
      }
      return updated;
    },
    async close() {
      await writes;
      if (redis) await redis.quit();
      db.close();
    },
  };
}
