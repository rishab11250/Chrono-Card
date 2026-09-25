import { io, type Socket } from 'socket.io-client';
import type {
  ClientEvents,
  GameAction,
  Reply,
  RoomView,
  ServerEvents,
  Session,
} from '@chrono/shared';

export const API_URL = import.meta.env.VITE_SERVER_URL || '';
const SESSION_KEY = 'chrono-session-v1';
export class Network {
  socket: Socket<ServerEvents, ClientEvents>;
  session: Session | null = null;
  watchCode: string | null = null;
  onRoom: (room: RoomView) => void = () => {};
  onStatus: (status: string) => void = () => {};
  onError: (error: string) => void = () => {};
  constructor() {
    try {
      this.session = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
      this.watchCode = sessionStorage.getItem('chrono-watch');
    } catch {
      this.session = null;
    }
    this.socket = io(API_URL || undefined, {
      autoConnect: false,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000,
    });
    this.socket.on('room:state', (room) => this.onRoom(room));
    this.socket.on('room:closed', (error) => {
      this.clear();
      this.onError(error);
      this.onStatus('Session ended');
    });
    this.socket.on('disconnect', () =>
      this.onStatus(
        this.session || this.watchCode ? 'Reconnecting…' : 'Offline',
      ),
    );
    this.socket.on('connect_error', () =>
      this.onStatus('Server unavailable — retrying…'),
    );
    this.socket.on('connect', async () => {
      this.onStatus('Connected');
      try {
        if (this.session)
          this.save(
            this.unwrap(
              await this.socket
                .timeout(8000)
                .emitWithAck('room:resume', this.session),
            ),
          );
        else if (this.watchCode)
          this.unwrap(
            await this.socket
              .timeout(8000)
              .emitWithAck('room:watch', { code: this.watchCode }),
          );
      } catch (error) {
        this.clear();
        this.onError(
          error instanceof Error
            ? error.message
            : 'Unable to restore the session.',
        );
      }
    });
  }
  unwrap<T>(result: Reply<T>): T {
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }
  save(session: Session) {
    this.session = session;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  clear() {
    this.session = null;
    this.watchCode = null;
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('chrono-watch');
  }
  async connect() {
    if (this.socket.connected) return;
    this.onStatus('Connecting…');
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(
          new Error(
            'Cannot reach the game server. Solo and couch co-op are still available.',
          ),
        );
      }, 9000);
      const connected = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off('connect', connected);
      };
      this.socket.once('connect', connected);
      this.socket.connect();
    });
  }
  async create(name: string, mode: 'duo' | 'party' | 'daily') {
    await this.connect();
    this.save(
      this.unwrap(
        await this.socket
          .timeout(8000)
          .emitWithAck('room:create', { name, mode }),
      ),
    );
  }
  async join(name: string, code: string) {
    await this.connect();
    this.save(
      this.unwrap(
        await this.socket
          .timeout(8000)
          .emitWithAck('room:join', { name, code }),
      ),
    );
  }
  async watch(code: string) {
    await this.connect();
    this.unwrap(
      await this.socket.timeout(8000).emitWithAck('room:watch', { code }),
    );
    this.watchCode = code;
    sessionStorage.setItem('chrono-watch', code);
  }
  async start() {
    this.unwrap(await this.socket.timeout(8000).emitWithAck('room:start'));
  }
  async action(action: GameAction, revision: number) {
    this.unwrap(
      await this.socket
        .timeout(8000)
        .emitWithAck('game:action', { action, revision }),
    );
  }
  async leave() {
    if (this.socket.connected && (this.session || this.watchCode))
      this.unwrap(await this.socket.timeout(8000).emitWithAck('room:leave'));
    this.clear();
    this.socket.disconnect();
  }
}
