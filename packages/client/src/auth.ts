import type { UserProfile, Session } from '@chrono/shared';
import { API_URL } from './net';

const TOKEN_KEY = 'chrono-auth-token';
const USER_KEY = 'chrono-auth-user';

export class ClientAuth {
  private token: string | null = null;
  private user: UserProfile | null = null;
  public onChange: (user: UserProfile | null) => void = () => {};

  constructor() {
    try {
      this.token = localStorage.getItem(TOKEN_KEY);
      const cached = localStorage.getItem(USER_KEY);
      if (cached) {
        const user = JSON.parse(cached);
        if (
          user &&
          typeof user.id === 'string' &&
          typeof user.username === 'string' &&
          typeof user.avatar === 'string' &&
          typeof user.createdAt === 'string' &&
          user.stats &&
          ['runsPlayed', 'runsWon', 'dailyWins', 'bestTurns'].every(
            (key) =>
              Number.isSafeInteger(user.stats[key]) && user.stats[key] >= 0,
          ) &&
          (user.achievements === undefined || Array.isArray(user.achievements))
        )
          this.user = user;
      }
    } catch {
      this.token = null;
      this.user = null;
    }
  }

  getUser(): UserProfile | null {
    return this.user;
  }

  getToken(): string | null {
    return this.token;
  }

  isLoggedIn(): boolean {
    return Boolean(this.token && this.user);
  }

  async init(): Promise<UserProfile | null> {
    if (!this.token) return null;
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) {
        if (res.status === 401) this.logout();
        return null;
      }
      const data = await res.json();
      if (data.ok && data.user) {
        this.setUser(data.user);
        return this.user;
      }
    } catch {
      // offline or server error, retain cached user
    }
    return this.user;
  }

  async login(username: string, password: string): Promise<UserProfile> {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Login failed.');
    }
    this.token = data.token;
    try {
      localStorage.setItem(TOKEN_KEY, data.token);
    } catch {
      /* Retain the live session even if storage is full. */
    }
    this.setUser(data.user);
    return data.user;
  }

  async register(
    username: string,
    password: string,
    avatar?: string,
  ): Promise<UserProfile> {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, avatar }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Registration failed.');
    }
    this.token = data.token;
    try {
      localStorage.setItem(TOKEN_KEY, data.token);
    } catch {
      /* Retain the live session even if storage is full. */
    }
    this.setUser(data.user);
    return data.user;
  }

  async updateAvatar(avatar: string): Promise<void> {
    if (!this.token || !this.user) return;
    try {
      const res = await fetch(`${API_URL}/api/auth/avatar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ avatar }),
      });
      if (res.ok) {
        this.setUser({ ...this.user, avatar });
      }
    } catch {
      // ignore network errors
    }
  }

  async recordRun(stats: {
    runId: string;
    session?: Session;
    won?: boolean;
    turns?: number;
    daily?: boolean;
  }): Promise<UserProfile | null> {
    if (!this.token || !this.user) return null;
    try {
      const res = await fetch(`${API_URL}/api/auth/record-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(stats),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.user) {
          this.setUser(data.user);
          return data.user;
        }
      }
    } catch {
      // ignore network errors
    }
    return null;
  }

  logout(): void {
    this.token = null;
    this.user = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      // ignore
    }
    this.onChange(null);
  }

  private setUser(user: UserProfile) {
    this.user = user;
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      // ignore
    }
    this.onChange(this.user);
  }
}

export const auth = new ClientAuth();
