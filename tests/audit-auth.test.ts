import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  createAuth,
  hashPassword,
  verifyPassword,
} from '../packages/server/src/auth';
describe('account signing and password boundaries', () => {
  beforeEach(() => vi.stubEnv('AUTH_SECRET', undefined));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('requires a configured production key and generates independent development keys', () => {
    expect(() => createAuth(undefined, true)).toThrow('AUTH_SECRET');
    expect(() => createAuth('short', true)).toThrow('32 bytes');
    const a = createAuth(undefined, false),
      b = createAuth(undefined, false),
      token = a.createToken({ id: 'a', username: 'Ada' });
    expect(a.verifyToken(token)).toEqual({ id: 'a', username: 'Ada' });
    expect(b.verifyToken(token)).toBeNull();
  });
  it('rejects the old public key, absent expiry, invalid claims, and expired tokens', () => {
    const secret = 'x'.repeat(64),
      auth = createAuth(secret, true);
    const signed = (payload: unknown, key = secret) => {
      const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${data}.${createHmac('sha256', key).update(data).digest('base64url')}`;
    };
    for (const payload of [
      { id: 'a', username: 'Ada' },
      { id: {}, username: 'Ada', exp: Date.now() + 1000 },
      { id: 'a', username: 'Ada', exp: Date.now() - 1 },
      null,
    ])
      expect(auth.verifyToken(signed(payload))).toBeNull();
    expect(
      auth.verifyToken(
        signed(
          { id: 'a', username: 'Ada', exp: Date.now() + 1000 },
          'chrono-card-auth-secret-key-super-secure-production-2026',
        ),
      ),
    ).toBeNull();
    const token = auth.createToken({ id: 'a', username: 'Ada' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 86_400_000);
    expect(auth.verifyToken(token)).toBeNull();
    vi.restoreAllMocks();
  });
  it('hashes off the event loop and verifies existing scrypt records', async () => {
    const first = await hashPassword('correct horse battery staple');
    expect(
      await verifyPassword(
        'correct horse battery staple',
        first.salt,
        first.hash,
      ),
    ).toBe(true);
    expect(await verifyPassword('wrong', first.salt, first.hash)).toBe(false);
    expect(await verifyPassword('wrong', first.salt, 'invalid')).toBe(false);
  });
});
