import { it, expect, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn(),
  isReady: true,
  isOpen: true,
  get: vi.fn().mockResolvedValue(null),
  set: vi
    .fn()
    .mockRejectedValueOnce(new Error('simulated outage'))
    .mockResolvedValue('OK'),
}));
vi.mock('redis', () => ({ createClient: () => fake }));
import { persistence } from '../packages/server/src/persistence';
it('recovers the write queue after an account cache failure and preserves later room/account saves', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const storage = await persistence({
    database: ':memory:',
    redisUrl: 'redis://test',
  });
  const user = {
    id: 'a',
    username: 'Ada',
    password_hash: 'hash',
    salt: 'salt',
    avatar: 'Explorer',
    created_at: '2026-09-26',
  };
  storage.createUser(user);
  storage.save('ABC234', { phase: 'drafting' });
  storage.updateUserAvatar('a', 'Chrono Phantom');
  await storage.close();
  expect(fake.set).toHaveBeenCalledTimes(3);
  expect(fake.set.mock.calls[1][0]).toBe('chrono:room:ABC234');
  expect(log).toHaveBeenCalledOnce();
  log.mockRestore();
});
it('enforces case-insensitive username uniqueness in SQLite', async () => {
  const storage = await persistence({ database: ':memory:' });
  try {
    const user = {
      id: 'a',
      username: 'Ada',
      password_hash: 'hash',
      salt: 'salt',
      avatar: 'Explorer',
      created_at: '2026-09-26',
    };
    storage.createUser(user);
    expect(() =>
      storage.createUser({ ...user, id: 'b', username: 'aDA' }),
    ).toThrow('UNIQUE');
    expect((await storage.getUserByUsername('ADA'))?.id).toBe('a');
  } finally {
    await storage.close();
  }
});
